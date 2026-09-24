/** DingTalk times are Asia/Shanghai wall-clock. */
const TIME_ZONE = 'Asia/Shanghai';

const epochFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: TIME_ZONE,
  year: 'numeric',
});

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/;

/**
 * `2026-09-21 09:30` from epoch milliseconds or a dws time string
 * (`YYYY-MM-DD HH:mm:ss` / ISO). Zero and unreadable values show nothing.
 */
export const formatDateTime = (value?: number | string | null): string | undefined => {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return epochFormatter.format(new Date(value)).replace(', ', ' ');
  }

  if (typeof value !== 'string') return undefined;

  const match = WALL_CLOCK.exec(value.trim());
  if (match) return `${match[1]} ${match[2]}`;

  return value.trim() || undefined;
};

/** `2026-09-21 09:30 – 10:30`, collapsing the date when both ends share it. */
export const formatTimeRange = (
  start?: number | string | null,
  end?: number | string | null,
): string | undefined => {
  const from = formatDateTime(start);
  const to = formatDateTime(end);

  if (!from) return to;
  if (!to) return from;

  const [fromDate, fromTime] = from.split(' ');
  const [toDate, toTime] = to.split(' ');

  return fromDate === toDate && fromTime && toTime ? `${from} – ${toTime}` : `${from} – ${to}`;
};

/** `91.2 KB` style size; negative or missing sizes show nothing. */
export const formatFileSize = (bytes?: number | null): string | undefined => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** An open todo whose due time has passed. */
export const isOverdue = (dueTime: unknown, now = Date.now()): boolean =>
  typeof dueTime === 'number' && Number.isFinite(dueTime) && dueTime > 0 && dueTime < now;

const PRIORITY_LEVELS = { 10: 'low', 20: 'normal', 30: 'high', 40: 'urgent' } as const;

export type PriorityLevel = (typeof PRIORITY_LEVELS)[keyof typeof PRIORITY_LEVELS];

export const toPriorityLevel = (priority: unknown): PriorityLevel | undefined =>
  priority === 10 || priority === 20 || priority === 30 || priority === 40
    ? PRIORITY_LEVELS[priority]
    : undefined;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Object rows only: history may hold anything, and a null row must not crash the card. */
export const asRows = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value.filter(isRecord) as T[]) : [];

/** Trimmed text, or undefined for anything empty or not a string. */
export const asText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const text = value.trim();
  return text || undefined;
};

export const asNames = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText).filter((name): name is string => !!name) : [];
