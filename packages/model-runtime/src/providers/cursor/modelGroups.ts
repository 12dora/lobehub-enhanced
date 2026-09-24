import type { EffortLevel } from '../../utils/effortControlRegistry';
import { EFFORT_CONTROL_REGISTRY } from '../../utils/effortControlRegistry';

/**
 * Cursor effort tokens, longest first so `extra-high` / `xhigh` are not read as `high`.
 * `extra-high` is the CLI spelling of `xhigh`.
 */
const EFFORT_SUFFIXES = [
  ['extra-high', 'xhigh'],
  ['minimal', 'minimal'],
  ['medium', 'medium'],
  ['xhigh', 'xhigh'],
  ['none', 'none'],
  ['high', 'high'],
  ['low', 'low'],
  ['max', 'max'],
] as const satisfies ReadonlyArray<readonly [string, EffortLevel]>;

const CURSOR_LEVELS = EFFORT_CONTROL_REGISTRY.cursorReasoningEffort.levels;

/** CLI display names. "Extra High" before "High". Thinking / Fast are not effort words. */
const EFFORT_WORD = /\b(?:extra[\s-]+high|minimal|medium|xhigh|none|high|low|max)\b/i;

export interface CursorModelGroup {
  baseId: string;
  defaultLevel: EffortLevel;
  displayName: string;
  fast: boolean;
  levels: EffortLevel[];
  /** Level → concrete CLI id. */
  members: Record<string, string>;
}

export interface CursorListedModel {
  id: string;
  name?: string;
}

const sanitize = (value: string): string =>
  value
    .replaceAll(/[\u200B-\u200D\uFEFF]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

const hasEffortWord = (name: string): boolean => EFFORT_WORD.test(sanitize(name));

const stripEffortWords = (name: string): string =>
  sanitize(
    sanitize(name).replaceAll(
      /\b(?:extra[\s-]+high|minimal|medium|xhigh|none|high|low|max)\b/gi,
      ' ',
    ),
  );

const levelRank = (level: string): number => (CURSOR_LEVELS as readonly string[]).indexOf(level);

const sortLevels = (levels: readonly EffortLevel[]): EffortLevel[] =>
  [...levels].sort((left, right) => levelRank(left) - levelRank(right));

const splitEffort = (id: string): { base: string; effort: EffortLevel | null } => {
  for (const [token, level] of EFFORT_SUFFIXES) {
    const marker = `-${token}-thinking`;
    if (id.endsWith(marker) && id.length > marker.length) {
      return { base: `${id.slice(0, -marker.length)}-thinking`, effort: level };
    }
  }
  for (const [token, level] of EFFORT_SUFFIXES) {
    const marker = `-${token}`;
    if (id.endsWith(marker) && id.length > marker.length) {
      return { base: id.slice(0, -marker.length), effort: level };
    }
  }
  return { base: id, effort: null };
};

/**
 * Split a Cursor CLI id into its collapsed base, effort token, and fast tier.
 * `fast` is only a trailing `-fast`. Effort is a trailing token, or the token
 * directly before a trailing `-thinking` (`claude-4.6-opus-high-thinking`).
 */
export const parseCursorModelId = (
  id: string,
): { baseId: string; effort: EffortLevel | null; fast: boolean } => {
  let fast = false;
  let rest = id;
  if (rest.endsWith('-fast') && rest.length > '-fast'.length) {
    fast = true;
    rest = rest.slice(0, -'-fast'.length);
  }
  const parsed = splitEffort(rest);
  return {
    baseId: fast ? `${parsed.base}-fast` : parsed.base,
    effort: parsed.effort,
    fast,
  };
};

interface ParsedRow {
  effort: EffortLevel | null;
  fast: boolean;
  id: string;
  name?: string;
}

const toListed = (row: ParsedRow): CursorListedModel =>
  row.name === undefined ? { id: row.id } : { id: row.id, name: row.name };

const pickDefaultLevel = (
  levels: readonly EffortLevel[],
  rows: readonly ParsedRow[],
): EffortLevel => {
  const unmarked = rows.find((row) => {
    const name = row.name ? sanitize(row.name) : '';
    return name.length > 0 && !hasEffortWord(name);
  });
  if (unmarked?.effort) return unmarked.effort;
  if (levels.includes('high')) return 'high';
  if (levels.includes('medium')) return 'medium';
  return levels[Math.floor(levels.length / 2)] ?? 'high';
};

const buildGroup = (baseId: string, rows: readonly ParsedRow[]): CursorModelGroup | undefined => {
  const explicit = rows.filter((row) => row.effort);
  if (explicit.length === 0) return undefined;

  const members: Record<string, string> = {};
  const memberRows: ParsedRow[] = [];
  for (const row of explicit) {
    const level = row.effort;
    if (!level || members[level]) continue;
    members[level] = row.id;
    memberRows.push(row);
  }

  const implicit = rows.find((row) => !row.effort);
  if (!members.medium && implicit) {
    const bare = implicit;
    members.medium = bare.id;
    memberRows.push({ ...bare, effort: 'medium' });
  }

  const levels = sortLevels(Object.keys(members) as EffortLevel[]);
  if (levels.length < 2) return undefined;

  const defaultLevel = pickDefaultLevel(levels, memberRows);
  const source = memberRows.find((row) => row.effort === defaultLevel);
  return {
    baseId,
    defaultLevel,
    displayName: (source?.name && stripEffortWords(source.name)) || baseId,
    fast: rows[0]?.fast ?? baseId.endsWith('-fast'),
    levels,
    members,
  };
};

/**
 * Collapse a live Cursor list. A base with two or more distinct levels becomes
 * one group; everything else stays a single concrete id. `-fast` bases are
 * separate. Levels follow `cursorReasoningEffort` order.
 *
 * The default level is the member whose CLI name has no effort word
 * (Low / Medium / High / Extra High / Max / None / Minimal), else `high`,
 * else `medium`, else the middle level. A bare id listed next to effort
 * variants is `medium` when that level is not already present.
 */
export const groupCursorModels = (
  list: readonly CursorListedModel[],
): { groups: CursorModelGroup[]; singles: CursorListedModel[] } => {
  const buckets = new Map<string, ParsedRow[]>();
  const order: string[] = [];

  for (const item of list) {
    if (!item.id) continue;
    const parsed = parseCursorModelId(item.id);
    const row: ParsedRow = {
      effort: parsed.effort,
      fast: parsed.fast,
      id: item.id,
      name: item.name,
    };
    const existing = buckets.get(parsed.baseId);
    if (existing) existing.push(row);
    else {
      buckets.set(parsed.baseId, [row]);
      order.push(parsed.baseId);
    }
  }

  const groups: CursorModelGroup[] = [];
  const singles: CursorListedModel[] = [];
  for (const baseId of order) {
    const rows = buckets.get(baseId) ?? [];
    const group = buildGroup(baseId, rows);
    if (group) groups.push(group);
    else singles.push(...rows.map(toListed));
  }
  return { groups, singles };
};

const asListed = (
  liveIds: readonly string[] | readonly (string | CursorListedModel)[],
): CursorListedModel[] => {
  const listed: CursorListedModel[] = [];
  const rows = liveIds as readonly (string | CursorListedModel)[];
  for (const item of rows) {
    if (typeof item === 'string') {
      if (item) listed.push({ id: item });
      continue;
    }
    if (item.id) listed.push(item);
  }
  return listed;
};

/**
 * Resolve the CLI id for a chat request.
 *
 * - Group base id → the member for `effort` (exact, else nearest by registry
 *   rank, ties → stronger). No effort → that group's default member.
 * - Any other id that is not a group base (legacy concrete ids, one-level
 *   ids, unknown ids) is returned unchanged.
 *
 * Pass `{ id, name }` rows when the caller has CLI names. A bare string list
 * has no names, so the no-effort default falls back to high, else medium,
 * else the middle level instead of the name-based default.
 */
export const resolveCursorModelId = (
  liveIds: readonly string[] | readonly (string | CursorListedModel)[],
  model: string,
  effort?: string | null,
): string => {
  const { groups } = groupCursorModels(asListed(liveIds));
  const group = groups.find((item) => item.baseId === model);
  if (!group) return model;

  const fallback = group.members[group.defaultLevel] ?? model;
  if (!effort) return fallback;
  const exact = group.members[effort];
  if (exact) return exact;

  const requestedRank = levelRank(effort);
  if (requestedRank < 0) return fallback;

  let best: EffortLevel | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestRank = -1;
  for (const level of group.levels) {
    const rank = levelRank(level);
    if (rank < 0) continue;
    const distance = Math.abs(rank - requestedRank);
    if (distance < bestDistance || (distance === bestDistance && rank > bestRank)) {
      best = level;
      bestDistance = distance;
      bestRank = rank;
    }
  }
  return (best && group.members[best]) || fallback;
};
