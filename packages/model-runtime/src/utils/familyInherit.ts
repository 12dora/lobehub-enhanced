import type { AiModelSettings, ModelAbilities } from 'model-bank';

/**
 * Which ability and settings keys were filled from a donor.
 *
 * An enumerable symbol survives object spread (`postProcessModelList` and
 * provider clones). `JSON.stringify` and `Object.keys` both omit symbols, so
 * the mark never lands in a JSON column. Sync reads the same
 * `Symbol.for('lobe.familyInheritedKeys')`.
 */
export const FAMILY_INHERITED_KEYS = Symbol.for('lobe.familyInheritedKeys');

export interface FamilyInheritedKeys {
  abilities: readonly string[];
  settings: readonly string[];
}

/** Known catalog row the inheritor may copy abilities and settings from. */
export interface FamilyKnownCard {
  abilities?: ModelAbilities;
  id: string;
  releasedAt?: string;
  settings?: AiModelSettings;
  /** Bank `type`. Chat donors never fill image, video, or embedding ids. */
  type?: string;
}

/** Abilities and the two settings keys a donor is allowed to give an unknown id. */
export interface InheritedFamilyCard {
  abilities?: ModelAbilities;
  settings?: AiModelSettings;
}

export interface FamilyCardPools {
  /** Every other bank, used only when the provider bank has no card of this stem. */
  globalCards: readonly FamilyKnownCard[];
  /** Same-provider bank. Wins over `globalCards` when it contains the family stem. */
  providerCards: readonly FamilyKnownCard[];
}

export interface InheritFamilyOptions {
  /**
   * Copy `settings.extendParams`. Cursor bakes effort into the id, so it passes
   * false. Defaults to true.
   */
  extendParams?: boolean;
  /**
   * Upstream model type. When omitted, image / video / embedding are inferred
   * from variant words and everything else is `chat`.
   */
  type?: string;
}

interface ModelVersion {
  major: number;
  /** Integer minor; `minorDigits` is the scale, so 4.20 compares equal to 4.2. */
  minor: number;
  minorDigits: number;
}

interface ParsedIdentity {
  stem: string;
  variants: string;
  version: ModelVersion;
}

interface PreparedDonor {
  abilities?: ModelAbilities;
  releasedAt: string;
  settings?: AiModelSettings;
  version: ModelVersion;
}

interface DonorIndex {
  /** `${stem}|${variants}|${type}` → donors, highest version first, then latest releasedAt. */
  byKey: Map<string, PreparedDonor[]>;
  stems: Set<string>;
}

const EFFORT_TOKENS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
/**
 * `fast` is a speed tier, not a product variant. Cursor ids use `-fast` for the
 * same model ("Grok 4.7 High Fast"), and `grok-4.6-fast` is the same generation
 * as `grok-4.6`. `thinking` is a mode suffix, same as the effort words.
 * Product variants that must match exactly stay in the id: codex, pro, flash,
 * lite, mini, nano, non-reasoning, vision, image, video, embedding, and any
 * other leftover word.
 */
const STRIPPED_TOKENS = new Set(['fast', 'thinking']);
const REVISION_WORDS = new Set(['preview', 'latest', 'exp']);
const SIZE_SUFFIX = new Set(['k', 'm', 'b']);
const TYPE_FROM_VARIANT = new Set(['image', 'video', 'embedding']);
/** A family word sitting directly after the version is stem, same as before it. */
const FAMILY_TOKENS = new Set(['haiku', 'sonnet', 'opus']);
const DATE_8 = /^(?:19|20)\d{6}$/;
const DATE_4 = /^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/;
const PURE_INT = /^\d+$/;
const DOTTED_VERSION = /^(\d+)\.(\d+)/;
const LETTER_PREFIX = /^([a-z]+)(\d+(?:\.\d+)?)$/;
const LETTER_SUFFIX = /^(\d+(?:\.\d+)?)([a-z])$/;

const ABILITY_KEYS = [
  'files',
  'functionCall',
  'imageOutput',
  'reasoning',
  'search',
  'structuredOutput',
  'video',
  'vision',
] as const satisfies readonly (keyof ModelAbilities)[];

const indexCache = new WeakMap<readonly FamilyKnownCard[], DonorIndex>();

const isDateToken = (token: string): boolean => DATE_8.test(token) || DATE_4.test(token);

/** 3+ digit bare numbers are revisions (`001`, `0309`), not a version minor. */
const isRevisionNumber = (token: string): boolean => PURE_INT.test(token) && token.length >= 3;

const stripIsoDates = (value: string): string =>
  value.replaceAll(
    /-(\d{4})-(\d{2})-(\d{2})(?=-|$)/g,
    (full, _year: string, month: string, day: string) => {
      const monthNumber = Number(month);
      const dayNumber = Number(day);
      if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return full;
      return '';
    },
  );

/**
 * Lowercase, drop invisible characters, and remove vendor prefixes plus date
 * suffixes so `cursor-grok-4.7-high` and `grok-4.6` share a family stem.
 */
const normalizeId = (id: string): string => {
  let value = stripIsoDates(
    id
      .trim()
      .toLowerCase()
      .replaceAll(/[\u200B-\u200D\uFEFF]/g, ''),
  );
  if (value.startsWith('cursor-')) value = value.slice('cursor-'.length);
  else if (value.startsWith('x-ai/')) value = value.slice('x-ai/'.length);
  else if (value.startsWith('xai/')) value = value.slice('xai/'.length);
  // Keep this compound together: splitting it would look like the `reasoning` variant.
  return value.replaceAll('non-reasoning', 'non_reasoning');
};

const versionFromParts = (majorText: string, minorText: string | undefined): ModelVersion => {
  const major = Number(majorText);
  if (!minorText) return { major, minor: 0, minorDigits: 1 };
  return { major, minor: Number(minorText), minorDigits: minorText.length };
};

const versionFromNumeric = (numeric: string): ModelVersion | undefined => {
  const dotted = DOTTED_VERSION.exec(numeric);
  if (dotted?.[1]) return versionFromParts(dotted[1], dotted[2]);
  if (PURE_INT.test(numeric) && numeric.length < 3) return versionFromParts(numeric, undefined);
  return undefined;
};

const isSkippable = (token: string): boolean =>
  EFFORT_TOKENS.has(token) ||
  STRIPPED_TOKENS.has(token) ||
  REVISION_WORDS.has(token) ||
  isDateToken(token);

/**
 * Version is the dotted or hyphenated numeric run directly after the family
 * words (`4.6`, `4-6`, `3-5`, `2.0`, `4.20`). A letter glued to that number
 * stays on the stem (`o4` → `o`, `gpt-4o` → `gpt-o`, `kimi-k3` → `kimi-k`).
 * Later bare numbers and `-preview` / `-latest` / `-exp` / `-001` are revisions.
 */
const parseIdentity = (id: string): ParsedIdentity | undefined => {
  const tokens = normalizeId(id)
    .split(/[-/]/)
    .filter((token) => token.length > 0);

  const stemParts: string[] = [];
  const variantParts: string[] = [];
  let version: ModelVersion | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (isSkippable(token)) continue;

    if (!version) {
      const prefixed = LETTER_PREFIX.exec(token);
      if (prefixed?.[1] && prefixed[2]) {
        const parsed = versionFromNumeric(prefixed[2]);
        if (parsed) {
          stemParts.push(prefixed[1]);
          version = parsed;
          continue;
        }
      }
      const suffixed = LETTER_SUFFIX.exec(token);
      if (suffixed?.[1] && suffixed[2] && !SIZE_SUFFIX.has(suffixed[2])) {
        const parsed = versionFromNumeric(suffixed[1]);
        if (parsed) {
          version = parsed;
          stemParts.push(suffixed[2]);
          continue;
        }
      }
      if (DOTTED_VERSION.test(token)) {
        const parsed = versionFromNumeric(token);
        if (parsed) {
          version = parsed;
          continue;
        }
      }
      if (PURE_INT.test(token) && token.length < 3) {
        const next = tokens[index + 1];
        // `4-6` and `4-20` are one version. `4-0613` / `4-001` leave a revision.
        if (next && PURE_INT.test(next) && next.length <= 2 && !isDateToken(next)) {
          version = versionFromParts(token, next);
          index += 1;
          continue;
        }
        version = versionFromParts(token, undefined);
        continue;
      }
      if (isRevisionNumber(token)) continue;
      stemParts.push(token);
      continue;
    }

    if (isRevisionNumber(token) || PURE_INT.test(token)) continue;
    // `claude-3-5-haiku` and `claude-haiku-4-5` share the stem `claude-haiku`.
    if (variantParts.length === 0 && FAMILY_TOKENS.has(token)) {
      stemParts.push(token);
      continue;
    }
    variantParts.push(token === 'non_reasoning' ? 'non-reasoning' : token);
  }

  if (!version) return undefined;
  const stem = stemParts.join('-');
  if (!stem) return undefined;
  return { stem, variants: variantParts.join('|'), version };
};

/** major + decimal minor: 4.20 = 4.2 < 4.3 < 4.6 < 4.7. */
const compareVersion = (left: ModelVersion, right: ModelVersion): number => {
  if (left.major !== right.major) return left.major - right.major;
  const digits = Math.max(left.minorDigits, right.minorDigits);
  const leftMinor = left.minor * 10 ** (digits - left.minorDigits);
  const rightMinor = right.minor * 10 ** (digits - right.minorDigits);
  return leftMinor - rightMinor;
};

const versionNotAbove = (donor: ModelVersion, unknown: ModelVersion): boolean =>
  compareVersion(donor, unknown) <= 0;

const inferTypeFromVariants = (variants: string): string | undefined => {
  for (const variant of variants.split('|')) {
    if (TYPE_FROM_VARIANT.has(variant)) return variant;
  }
  return undefined;
};

const resolveType = (explicit: string | undefined, variants: string): string => {
  if (explicit) return explicit;
  return inferTypeFromVariants(variants) ?? 'chat';
};

const indexKey = (stem: string, variants: string, type: string): string =>
  `${stem}|${variants}|${type}`;

/** Latest `releasedAt` first. A missing date loses to any real date. */
const compareReleasedAt = (left: PreparedDonor, right: PreparedDonor): number => {
  if (left.releasedAt === right.releasedAt) return 0;
  if (!left.releasedAt) return 1;
  if (!right.releasedAt) return -1;
  return right.releasedAt.localeCompare(left.releasedAt);
};

const buildDonorIndex = (cards: readonly FamilyKnownCard[]): DonorIndex => {
  const byKey = new Map<string, PreparedDonor[]>();
  const stems = new Set<string>();
  for (const card of cards) {
    const identity = parseIdentity(card.id);
    if (!identity) continue;
    const type = resolveType(card.type, identity.variants);
    const key = indexKey(identity.stem, identity.variants, type);
    const donor: PreparedDonor = {
      abilities: card.abilities,
      releasedAt: typeof card.releasedAt === 'string' ? card.releasedAt : '',
      settings: card.settings,
      version: identity.version,
    };
    const bucket = byKey.get(key);
    if (bucket) bucket.push(donor);
    else byKey.set(key, [donor]);
    stems.add(identity.stem);
  }
  for (const bucket of byKey.values()) {
    bucket.sort((left, right) => {
      const versionOrder = compareVersion(right.version, left.version);
      if (versionOrder !== 0) return versionOrder;
      return compareReleasedAt(left, right);
    });
  }
  return { byKey, stems };
};

/** One parse per card array. `processModelList` reuses the same arrays per id. */
const donorIndexFor = (cards: readonly FamilyKnownCard[]): DonorIndex => {
  const cached = indexCache.get(cards);
  if (cached) return cached;
  const built = buildDonorIndex(cards);
  indexCache.set(cards, built);
  return built;
};

const pickDonor = (
  unknown: ParsedIdentity,
  bucket: readonly PreparedDonor[],
): PreparedDonor | undefined => {
  const notHigher = bucket.find((donor) => versionNotAbove(donor.version, unknown.version));
  // Buckets are highest-version first, so [0] is the best `<=` hit.
  // A bucket of only newer cards donates nothing.
  return notHigher;
};

const isNonReasoningId = (id: string): boolean => id.toLowerCase().includes('non-reasoning');

const copyAbilities = (
  abilities: ModelAbilities | undefined,
  modelId: string,
): ModelAbilities | undefined => {
  const nonReasoning = isNonReasoningId(modelId);
  const next: ModelAbilities = {};
  if (abilities) {
    for (const key of ABILITY_KEYS) {
      if (nonReasoning && key === 'reasoning') continue;
      // A donor `reasoning: false` / `vision: false` must not land on the new id.
      if (abilities[key] === true) next[key] = true;
    }
  }
  // Never copy a reasoning donor onto an id that says it does not reason.
  if (nonReasoning) next.reasoning = false;
  return Object.keys(next).length > 0 ? next : undefined;
};

const copySettings = (
  settings: AiModelSettings | undefined,
  modelId: string,
  allowExtendParams: boolean,
): AiModelSettings | undefined => {
  if (!settings) return undefined;
  const next: AiModelSettings = {};
  const extendParams = settings.extendParams;
  if (
    allowExtendParams &&
    !isNonReasoningId(modelId) &&
    Array.isArray(extendParams) &&
    extendParams.length > 0
  ) {
    next.extendParams = [...extendParams];
  }
  if (settings.searchImpl) next.searchImpl = settings.searchImpl;
  return Object.keys(next).length > 0 ? next : undefined;
};

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const readFamilyInheritedKeys = (target: object): FamilyInheritedKeys | undefined => {
  const value = Reflect.get(target, FAMILY_INHERITED_KEYS);
  if (!value || typeof value !== 'object') return undefined;
  const abilities = Reflect.get(value, 'abilities');
  const settings = Reflect.get(value, 'settings');
  return {
    abilities: isStringList(abilities) ? abilities : [],
    settings: isStringList(settings) ? settings : [],
  };
};

/** Symbol mark. `JSON.stringify` and `Object.keys` skip it; object spread keeps it. */
export const stampFamilyInheritedKeys = (target: object, keys: FamilyInheritedKeys): void => {
  const abilities = [...keys.abilities];
  const settings = [...keys.settings];
  if (abilities.length === 0 && settings.length === 0) {
    Reflect.deleteProperty(target, FAMILY_INHERITED_KEYS);
    return;
  }
  Object.defineProperty(target, FAMILY_INHERITED_KEYS, {
    configurable: true,
    enumerable: true,
    value: { abilities, settings },
    writable: true,
  });
};

/**
 * Object spread drops non-enumerable marks. Copy the donor-key mark onto a
 * cloned card, optionally forgetting settings keys the caller just replaced
 * with live upstream data (Grok's effort list replaces `extendParams`).
 */
export const copyFamilyInheritedKeys = (
  from: object,
  to: object,
  dropSettings: readonly string[] = [],
): void => {
  const current = readFamilyInheritedKeys(from);
  if (!current) return;
  const drop = new Set(dropSettings);
  stampFamilyInheritedKeys(to, {
    abilities: current.abilities,
    settings: current.settings.filter((key) => !drop.has(key)),
  });
};

/**
 * When an unknown id misses the exact catalog row, copy abilities and
 * `extendParams` / `searchImpl` from the closest same-family card.
 *
 * The version is the full dotted or hyphenated run (`4.6`, `4-6`, `3-5`) and
 * compares as major + decimal minor, so 4.20 = 4.2 < 4.3 < 4.6 < 4.7. Variant
 * words and model type must match. `fast` is stripped, not matched. Prefer the
 * highest version that is still `<=` the unknown version. When every donor is
 * newer, return undefined. Equal versions use the latest `releasedAt`.
 *
 * A provider stem with no card in the exact variant bucket falls through to
 * the global bank's same bucket. Variant words stay strict. Only truthy
 * abilities are copied; `reasoning: false` is written only for a
 * `non-reasoning` id.
 *
 * Returns undefined when no card shares the family stem and variant (or every
 * same-bucket donor is newer), so keyword inference stays as it is today.
 */
export const inheritFamilyCard = (
  modelId: string,
  pools: FamilyCardPools,
  options?: InheritFamilyOptions,
): InheritedFamilyCard | undefined => {
  const unknown = parseIdentity(modelId);
  if (!unknown) return undefined;

  const unknownType = resolveType(options?.type, unknown.variants);
  const providerIndex = donorIndexFor(pools.providerCards);
  const globalIndex = donorIndexFor(pools.globalCards);
  const key = indexKey(unknown.stem, unknown.variants, unknownType);
  const providerBucket = providerIndex.stems.has(unknown.stem)
    ? (providerIndex.byKey.get(key) ?? [])
    : [];
  // Empty provider bucket (missing variant, or no stem) tries the global bank.
  const bucket = providerBucket.length > 0 ? providerBucket : (globalIndex.byKey.get(key) ?? []);
  const donor = pickDonor(unknown, bucket);
  if (!donor) return undefined;

  const abilities = copyAbilities(donor.abilities, modelId);
  const settings = copySettings(donor.settings, modelId, options?.extendParams !== false);
  if (!abilities && !settings) return undefined;
  return {
    ...(abilities ? { abilities } : {}),
    ...(settings ? { settings } : {}),
  };
};
