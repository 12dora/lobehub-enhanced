/**
 * Pure helpers that turn a tool result into dense list rows. The runtime owns
 * the exact `pluginState` shape, so we read a small set of well-known keys and
 * degrade to nothing rather than guessing.
 *
 * Names and free text go through `maskIdentifiers` on the way out, so a row whose
 * only "title" is a `processCode` reports no title and the card shows a neutral noun
 * in its place. The mask is narrow by design: a form value that merely looks like a
 * long serial is the user's own data and is passed through untouched.
 */
import type { MaskIdentifiersOptions } from '../components/displayText';
import { maskIdentifiers } from '../components/displayText';

export type ResultRowTag = 'disabled' | 'done' | 'enabled' | 'pending';

export interface ResultRowData {
  key: string;
  meta?: string;
  tag?: ResultRowTag;
  /** Absent when the payload carried no readable name — never an id. */
  title?: string;
}

export interface ResultRowList {
  rows: ResultRowData[];
  total: number;
  truncated: boolean;
}

/** Where a list result keeps its rows, in priority order. */
const ROW_PATHS = [
  'items',
  'rows',
  'tasks',
  'instances',
  'applications',
  'templates',
  'rules',
  'runs',
  'results',
  'hits.users',
  'hits.departments',
  'users',
  'departments',
] as const;

const TITLE_FIELDS = [
  'title',
  'instanceTitle',
  'name',
  'subject',
  'summary',
  'displayName',
  'processName',
] as const;

const META_FIELDS = [
  'processName',
  'originatorName',
  'statusText',
  'status',
  'actionLabel',
  'deptPath',
  'leafDeptName',
  'createdAt',
  'dueTime',
  'expiresAt',
  'location',
] as const;

const MAX_META_PARTS = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getByPath = (source: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => (isRecord(acc) ? acc[key] : undefined), source);

/** ISO timestamps read better as `YYYY-MM-DD HH:mm` in a dense row. */
export const formatDateTime = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(value);
  if (match) return `${match[1]} ${match[2]}`;

  return value.trim() || undefined;
};

const pickTitle = (
  row: Record<string, unknown>,
  options?: MaskIdentifiersOptions,
): { field?: string; title?: string } => {
  for (const field of TITLE_FIELDS) {
    const title = maskIdentifiers(row[field], options);
    if (title) return { field, title };
  }

  return {};
};

const pickMeta = (
  row: Record<string, unknown>,
  titleField?: string,
  options?: MaskIdentifiersOptions,
): string | undefined => {
  const parts: string[] = [];

  for (const field of META_FIELDS) {
    if (parts.length >= MAX_META_PARTS) break;
    if (field === titleField) continue;

    const raw = row[field];
    const value =
      field === 'createdAt' || field === 'dueTime' || field === 'expiresAt'
        ? formatDateTime(raw)
        : typeof raw === 'number'
          ? String(raw)
          : maskIdentifiers(raw, options);

    if (value) parts.push(value);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
};

const pickTag = (row: Record<string, unknown>): ResultRowTag | undefined => {
  if (row.enabled === false) return 'disabled';
  if (row.enabled === true) return 'enabled';
  if (row.done === true) return 'done';
  if (row.done === false) return 'pending';

  return undefined;
};

/** Find the row array of a list result, looking at the known state keys. */
export const pickRowArray = (state?: unknown): Record<string, unknown>[] => {
  if (Array.isArray(state)) return state.filter(isRecord);
  if (!isRecord(state)) return [];

  for (const path of ROW_PATHS) {
    const value = getByPath(state, path);
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [];
};

/**
 * Map a list result into dense rows plus its real total. A row with no readable
 * name keeps its place — the card names it with a neutral noun, because dropping
 * it silently would make the list disagree with the count next to it.
 */
export const toResultRowList = (
  state?: unknown,
  options?: MaskIdentifiersOptions,
): ResultRowList => {
  const source = pickRowArray(state);

  const rows = source.map((row, index) => {
    const { field, title } = pickTitle(row, options);

    return {
      key: String(row.id ?? row.taskId ?? row.processInstanceId ?? row.processCode ?? index),
      meta: pickMeta(row, field, options),
      tag: pickTag(row),
      title,
    } satisfies ResultRowData;
  });

  const stateRecord = isRecord(state) ? state : {};
  const declaredTotal = stateRecord.total ?? stateRecord.count;

  return {
    rows,
    total: typeof declaredTotal === 'number' ? declaredTotal : rows.length,
    truncated: stateRecord.truncated === true,
  };
};

export interface LabelValue {
  label: string;
  value: string;
}

/** Where a detail result keeps its human-readable label/value pairs. */
const PAIR_PATHS = ['lines', 'summary', 'formValues', 'values'] as const;

const toPairValue = (value: unknown, options?: MaskIdentifiersOptions): string | undefined => {
  if (typeof value === 'string') return maskIdentifiers(value, options);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => toPairValue(item, options)).filter(Boolean);
    return parts.length > 0 ? parts.join('、') : undefined;
  }

  return undefined;
};

/**
 * Read the label/value pairs of a detail result, ignoring unknown shapes. A form
 * value that was only an identifier — a person picker still holding `staff:<id>` —
 * is renamed rather than removed: the field was part of what the user submitted, so
 * the card keeps reporting that it exists.
 */
export const pickLabelValuePairs = (
  state?: unknown,
  options?: MaskIdentifiersOptions,
  unnamedValue?: string,
): LabelValue[] => {
  if (!isRecord(state)) return [];

  for (const path of PAIR_PATHS) {
    const value = state[path];
    if (!Array.isArray(value)) continue;

    const pairs = value.filter(isRecord).flatMap((row) => {
      const label = maskIdentifiers(row.label ?? row.name ?? row.key, options);
      const raw = row.value ?? row.text;
      // A field the payload never filled in stays out; a field whose value *was*
      // one of our identifiers is named instead.
      const pairValue =
        toPairValue(raw, options) ??
        (typeof raw === 'string' && raw.trim() ? unnamedValue : undefined);
      if (!label || !pairValue) return [];

      return [{ label, value: pairValue } satisfies LabelValue];
    });

    if (pairs.length > 0) return pairs;
  }

  return [];
};

/** Key facts of a write result, shown under the success line. */
export const toWriteFacts = (
  state?: unknown,
  options?: MaskIdentifiersOptions,
): { meta?: string; title?: string } => {
  if (!isRecord(state)) return {};

  const scope = isRecord(state.instance)
    ? state.instance
    : isRecord(state.rule)
      ? state.rule
      : isRecord(state.template)
        ? state.template
        : state;

  const { field, title } = pickTitle(scope, options);

  return { meta: pickMeta(scope, field, options), title };
};
