import type { ChatModelCard } from 'model-bank';
import { applyChatGPTWebModelPolicy } from 'model-bank';

import type { AdminAiModelApplyImmediateInput, AiProviderDraft } from '../../contracts/aiCatalog';
import { mergeModelUpdateFields } from './modelBatchDml';

const MODEL_KEY_MAX = 150;
const DISPLAY_NAME_MAX = 200;
const DESCRIPTION_MAX = 4000;
/** `as const` so the guard below can return the literal union the batch item declares. */
const MODEL_TYPES = [
  'asr',
  'chat',
  'embedding',
  'image',
  'realtime',
  'text2music',
  'tts',
  'video',
] as const;
type ModelType = (typeof MODEL_TYPES)[number];
const MODEL_TYPE_SET: ReadonlySet<string> = new Set(MODEL_TYPES);
const ABILITY_KEYS = [
  'files',
  'functionCall',
  'imageOutput',
  'reasoning',
  'search',
  'structuredOutput',
  'video',
  'vision',
] as const;

/**
 * Which ability and settings keys were copied from a family donor.
 * Same symbol as `FAMILY_INHERITED_KEYS` in `familyInherit.ts`
 * (`Symbol.for('lobe.familyInheritedKeys')`). Object spread keeps it;
 * `JSON.stringify` omits it, so it never enters the batch patch.
 */
export const FAMILY_INHERITED_KEYS = Symbol.for('lobe.familyInheritedKeys');

const CHATGPTWEB_PROVIDER = 'chatgptweb';

type BatchUpdateItem = Extract<
  AdminAiModelApplyImmediateInput,
  { operation: 'batchUpdate' }
>['models'][number];

type DraftModel = AiProviderDraft['models'][number];

const clip = (value: string | undefined, max: number): string | undefined => {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

/**
 * Field ChatGPT (and any other hook that can still see the raw payload) stamps
 * after `processModelList`. That function materializes every capability as a
 * boolean, so without this the mapper cannot tell "upstream said false" from
 * "upstream said nothing".
 */
const UPSTREAM_REPORTED_ABILITIES = 'upstreamReportedAbilities';

const readUpstreamReportedAbilities = (
  card: ChatModelCard,
): Partial<Record<(typeof ABILITY_KEYS)[number], boolean>> | undefined => {
  const value = (card as unknown as Record<string, unknown>)[UPSTREAM_REPORTED_ABILITIES];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Partial<Record<(typeof ABILITY_KEYS)[number], boolean>>;
};

/**
 * Clear an ability only when the provider hook recorded that upstream actually
 * sent `false`. Cards that only went through `processModelList` have no
 * provenance — treat them as silent and leave stored abilities alone.
 */
const collectAbilities = (card: ChatModelCard): Record<string, boolean> | undefined => {
  const provenance = readUpstreamReportedAbilities(card);
  if (!provenance) return undefined;

  const abilities: Record<string, boolean> = {};
  let reported = false;
  for (const key of ABILITY_KEYS) {
    const value = provenance[key];
    if (typeof value !== 'boolean') continue;
    reported = true;
    if (value) abilities[key] = true;
  }
  return reported ? abilities : undefined;
};

const stableJson = (value: unknown): string => {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
};

const metadataChanged = (current: DraftModel, patch: BatchUpdateItem): boolean => {
  const merged = mergeModelUpdateFields(current as Parameters<typeof mergeModelUpdateFields>[0], {
    abilities: patch.abilities,
    config: patch.config,
    contextWindowTokens: patch.contextWindowTokens,
    description: patch.description,
    displayName: patch.displayName,
    parameters: patch.parameters,
    pricing: patch.pricing,
    settings: patch.settings,
    type: patch.type,
  });
  return (
    stableJson(current.abilities) !== stableJson(merged.abilities) ||
    current.contextWindowTokens !== merged.contextWindowTokens ||
    current.description !== merged.description ||
    current.displayName !== merged.displayName ||
    stableJson(current.settings) !== stableJson(merged.settings) ||
    current.type !== merged.type
  );
};

const optionalPositiveInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const optionalModelType = (value: unknown): ModelType | undefined =>
  typeof value === 'string' && MODEL_TYPE_SET.has(value) ? (value as ModelType) : undefined;

const isEmptyRecord = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).length === 0;
};

/** Both objects empty means the row was stored by a sync that had nothing to infer. */
const isUntouchedModel = (model: DraftModel): boolean =>
  isEmptyRecord(model.abilities) && isEmptyRecord(model.settings);

interface FamilyInheritedKeys {
  abilities: readonly string[];
  settings: readonly string[];
}

const readFamilyInheritedKeys = (card: ChatModelCard): FamilyInheritedKeys => {
  const value = Reflect.get(card, FAMILY_INHERITED_KEYS);
  if (!value || typeof value !== 'object') return { abilities: [], settings: [] };
  const abilities = Reflect.get(value, 'abilities');
  const settings = Reflect.get(value, 'settings');
  return {
    abilities: Array.isArray(abilities)
      ? abilities.filter((key): key is string => typeof key === 'string')
      : [],
    settings: Array.isArray(settings)
      ? settings.filter((key): key is string => typeof key === 'string')
      : [],
  };
};

/**
 * Keyword and family inference land as flat booleans. Only `true` is persisted,
 * plus explicit `reasoning: false` for ids that say they do not reason.
 */
const readFlatAbilities = (card: ChatModelCard): Record<string, boolean> | undefined => {
  const abilities: Record<string, boolean> = {};
  for (const key of ABILITY_KEYS) {
    if (Reflect.get(card, key) === true) abilities[key] = true;
  }
  if (card.id.toLowerCase().includes('non-reasoning')) abilities.reasoning = false;
  return Object.keys(abilities).length > 0 ? abilities : undefined;
};

const enumerableRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
};

const readBooleanRecord = (value: unknown): Record<string, boolean> => {
  const record = enumerableRecord(value);
  if (!record) return {};
  const next: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'boolean') next[key] = item;
  }
  return next;
};

const sameJson = (left: unknown, right: unknown): boolean => stableJson(left) === stableJson(right);

const omitKeys = (
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> | undefined => {
  if (!record) return undefined;
  if (keys.length === 0) return record;
  const next = { ...record };
  for (const key of keys) delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
};

const cardToBatchUpdateItem = (
  card: ChatModelCard,
  id: string,
  abilities: Record<string, boolean> | undefined,
  settings: Record<string, unknown> | undefined,
): BatchUpdateItem => {
  const displayName = clip(card.displayName, DISPLAY_NAME_MAX);
  const description = clip(card.description, DESCRIPTION_MAX);
  const contextWindowTokens = optionalPositiveInt(card.contextWindowTokens);
  const type = optionalModelType(card.type);
  return {
    id,
    ...(abilities !== undefined ? { abilities } : {}),
    ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(settings ? { settings } : {}),
    ...(type ? { type } : {}),
  };
};

export const mapCardsToBatchUpdate = (
  cards: ChatModelCard[],
  existing: readonly DraftModel[],
): { created: number; items: BatchUpdateItem[]; total: number; updated: number } => {
  const existingByKey = new Map(existing.map((model) => [model.modelKey, model]));
  const seen = new Set<string>();
  const items: BatchUpdateItem[] = [];
  let created = 0;
  let updated = 0;
  let total = 0;

  for (const card of cards) {
    const modelKey = clip(card.id, MODEL_KEY_MAX);
    if (!modelKey || seen.has(modelKey)) continue;
    seen.add(modelKey);
    total += 1;

    const current = existingByKey.get(modelKey);
    const provenance = readUpstreamReportedAbilities(card);
    const provenanceAbilities = collectAbilities(card);
    const untouched = !current || isUntouchedModel(current);
    const donor = readFamilyInheritedKeys(card);
    const donorAbilities = new Set(donor.abilities);
    // Provenance still wins on a new or empty row. Otherwise inferred booleans,
    // including reasoning:false for non-reasoning ids, fill only that row.
    // A touched row keeps stored keys and overlays live upstream keys. Donor
    // keys are never written, so a column replace cannot drop an admin key.
    let abilities: Record<string, boolean> | undefined;
    if (untouched) {
      abilities =
        provenanceAbilities !== undefined ? { ...provenanceAbilities } : readFlatAbilities(card);
    } else if (
      current &&
      provenance &&
      Object.values(provenance).some((value) => typeof value === 'boolean')
    ) {
      const storedAbilities = readBooleanRecord(current.abilities);
      const merged = { ...storedAbilities };
      for (const key of ABILITY_KEYS) {
        if (donorAbilities.has(key)) continue;
        const value = provenance[key];
        if (value === true) merged[key] = true;
        else if (value === false) delete merged[key];
      }
      abilities = sameJson(merged, storedAbilities) ? undefined : merged;
    }
    const rawSettings = enumerableRecord(card.settings);
    const storedSettings = current ? (enumerableRecord(current.settings) ?? {}) : {};
    const inheritanceMarked = donor.abilities.length > 0 || donor.settings.length > 0;
    let settings: Record<string, unknown> | undefined;
    if (untouched) {
      settings = rawSettings;
    } else if (inheritanceMarked && donor.settings.length === 0) {
      // Abilities were inherited and no settings key was listed. The settings
      // object on the card is the donor blob and must not replace the column.
      settings = undefined;
    } else {
      const liveSettings = omitKeys(rawSettings, donor.settings) ?? {};
      const merged = { ...storedSettings, ...liveSettings };
      settings = sameJson(merged, storedSettings) ? undefined : merged;
    }
    const item = cardToBatchUpdateItem(card, current?.id ?? modelKey, abilities, settings);

    if (!current) {
      // applyImmediate publishes site-wide — new remotes stay off until an admin enables them.
      items.push({ ...item, enabled: false, type: item.type ?? 'chat' });
      created += 1;
      continue;
    }

    if (metadataChanged(current, item)) {
      items.push(item);
      updated += 1;
    }
  }

  return { created, items, total, updated };
};

const readSettingsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

type MappedCards = ReturnType<typeof mapCardsToBatchUpdate>;

/**
 * One-shot chatgptweb catalog cleanup after the family-card revert.
 *
 * Live cards already carry the right `extendParams` from `models()`. This pass
 * walks every existing chatgptweb row (including SKUs the live list omitted)
 * and rewrites settings through `applyChatGPTWebModelPolicy`, which deletes
 * leftover `legacyAlias` stamps and normalises thinking / pro / none. Idempotent:
 * rows whose settings already match are skipped.
 */
export const applyChatGPTWebCatalogSyncPolicy = (
  existing: readonly DraftModel[],
  mapped: MappedCards,
): MappedCards => {
  const itemsById = new Map(mapped.items.map((item) => [item.id, { ...item }]));
  let { updated } = mapped;

  for (const row of existing) {
    const current = itemsById.get(row.id);
    const baseSettings = readSettingsRecord(current?.settings ?? row.settings);
    const policy = applyChatGPTWebModelPolicy({
      abilities: row.abilities,
      modelId: row.modelKey,
      providerId: CHATGPTWEB_PROVIDER,
      settings: baseSettings,
    });
    const nextSettings = (policy.settings ?? {}) as Record<string, unknown>;
    if (stableJson(baseSettings) === stableJson(nextSettings)) continue;

    const candidate: BatchUpdateItem = {
      ...(current ?? { id: row.id }),
      id: row.id,
      settings: nextSettings,
    };
    if (!current) updated += 1;
    itemsById.set(row.id, candidate);
  }

  return { created: mapped.created, items: [...itemsById.values()], total: mapped.total, updated };
};

export const applyProviderCatalogSyncPolicy = (
  providerKey: string,
  existing: readonly DraftModel[],
  mapped: MappedCards,
): MappedCards =>
  providerKey === CHATGPTWEB_PROVIDER ? applyChatGPTWebCatalogSyncPolicy(existing, mapped) : mapped;
