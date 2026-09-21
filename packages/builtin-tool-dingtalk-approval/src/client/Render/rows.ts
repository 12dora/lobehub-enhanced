/**
 * Pure helpers that turn a tool result into dense list rows. The runtime owns
 * the exact `pluginState` shape, so we read a small set of well-known keys and
 * degrade to nothing rather than guessing.
 */

export type ResultRowTag = 'disabled' | 'done' | 'enabled' | 'pending';

export interface ResultRowData {
  key: string;
  meta?: string;
  tag?: ResultRowTag;
  title: string;
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

const pickTitle = (row: Record<string, unknown>): string | undefined => {
  for (const field of TITLE_FIELDS) {
    const value = row[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
};

const pickMeta = (row: Record<string, unknown>, titleField?: string): string | undefined => {
  const parts: string[] = [];

  for (const field of META_FIELDS) {
    if (parts.length >= MAX_META_PARTS) break;
    if (field === titleField) continue;

    const raw = row[field];
    const value =
      field === 'createdAt' || field === 'dueTime' || field === 'expiresAt'
        ? formatDateTime(raw)
        : typeof raw === 'string' && raw.trim()
          ? raw.trim()
          : typeof raw === 'number'
            ? String(raw)
            : undefined;

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

/** Map a list result into dense rows plus its real total. */
export const toResultRowList = (state?: unknown): ResultRowList => {
  const source = pickRowArray(state);

  const rows = source.map((row, index) => {
    const title = pickTitle(row);
    const titleField = TITLE_FIELDS.find((field) => row[field] === title);

    return {
      key: String(row.id ?? row.taskId ?? row.processInstanceId ?? row.processCode ?? index),
      meta: pickMeta(row, titleField),
      tag: pickTag(row),
      title: title ?? '',
    } satisfies ResultRowData;
  });

  const stateRecord = isRecord(state) ? state : {};
  const declaredTotal = stateRecord.total ?? stateRecord.count;

  return {
    rows: rows.filter((row) => !!row.title),
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

const toPairValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(toPairValue).filter(Boolean);
    return parts.length > 0 ? parts.join('、') : undefined;
  }

  return undefined;
};

/** Read the label/value pairs of a detail result, ignoring unknown shapes. */
export const pickLabelValuePairs = (state?: unknown): LabelValue[] => {
  if (!isRecord(state)) return [];

  for (const path of PAIR_PATHS) {
    const value = state[path];
    if (!Array.isArray(value)) continue;

    const pairs = value.filter(isRecord).flatMap((row) => {
      const label = row.label ?? row.name ?? row.key;
      const pairValue = toPairValue(row.value ?? row.text);
      if (typeof label !== 'string' || !label.trim() || !pairValue) return [];

      return [{ label: label.trim(), value: pairValue } satisfies LabelValue];
    });

    if (pairs.length > 0) return pairs;
  }

  return [];
};

/** Key facts of a write result, shown under the success line. */
export const toWriteFacts = (state?: unknown): { meta?: string; title?: string } => {
  if (!isRecord(state)) return {};

  const scope = isRecord(state.instance)
    ? state.instance
    : isRecord(state.rule)
      ? state.rule
      : isRecord(state.template)
        ? state.template
        : state;

  const title = pickTitle(scope);
  const titleField = TITLE_FIELDS.find((field) => scope[field] === title);

  return { meta: pickMeta(scope, titleField), title };
};
