import type {
  CalendarEventView,
  DirectoryDepartmentHit,
  DirectoryUserHit,
  FreeBusyPerson,
  MeetingRoomView,
  TodoView,
} from '../../types';

/** DingTalk times are Asia/Shanghai wall-clock (shared contract §5). */
const TIME_ZONE = 'Asia/Shanghai';

const epochFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: TIME_ZONE,
  year: 'numeric',
});

const ISO_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/;

/** `2026-09-21 09:30` from an ISO string or an epoch-millisecond number. */
export const formatDateTime = (value?: number | string | null): string | undefined => {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return epochFormatter.format(new Date(value)).replace(', ', ' ');
  }

  const match = ISO_PATTERN.exec(value);
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

/** Drops the `staff:` prefix so a token never leaks into the UI as-is. */
export const readStaffLabel = (token?: string): string | undefined => {
  if (!token) return undefined;
  const label = token.startsWith('staff:') ? token.slice('staff:'.length) : token;

  return label.trim() || undefined;
};

export interface TodoRow {
  due?: string;
  isDone: boolean;
  key: string;
  priority?: number;
  subject: string;
}

export const toTodoRows = (items?: TodoView[]): TodoRow[] =>
  (items ?? [])
    .map((todo, index) => ({
      due: formatDateTime(todo.dueTime),
      isDone: todo.isDone === true,
      key: todo.taskId ?? String(index),
      priority: typeof todo.priority === 'number' ? todo.priority : undefined,
      subject: todo.subject?.trim() ?? '',
    }))
    .filter((row) => !!row.subject);

export interface EventRow {
  isAllDay: boolean;
  key: string;
  location?: string;
  summary: string;
  timeRange?: string;
}

export const toEventRows = (items?: CalendarEventView[]): EventRow[] =>
  (items ?? [])
    .map((event, index) => ({
      isAllDay: event.isAllDay === true,
      key: event.eventId ?? event.id ?? String(index),
      location: event.location?.trim() || undefined,
      summary: event.summary?.trim() ?? '',
      timeRange: event.isAllDay
        ? formatDateTime(event.start)?.split(' ')[0]
        : formatTimeRange(event.start, event.end),
    }))
    .filter((row) => !!row.summary);

export interface RoomRow {
  capacity?: number;
  key: string;
  name: string;
}

export const toRoomRows = (items?: MeetingRoomView[]): RoomRow[] =>
  (items ?? [])
    .map((room, index) => ({
      capacity: typeof room.roomCapacity === 'number' ? room.roomCapacity : undefined,
      key: room.roomId ?? String(index),
      name: room.roomName?.trim() ?? '',
    }))
    .filter((row) => !!row.name);

export interface FreeBusyRow {
  blockCount: number;
  key: string;
  name: string;
  ranges?: string;
}

/** Busy blocks only — titles and details of other people are never returned. */
export const toFreeBusyRows = (people?: FreeBusyPerson[]): FreeBusyRow[] =>
  (people ?? []).map((person, index) => {
    const blocks = person.blocks ?? [];

    return {
      blockCount: blocks.length,
      key: person.unionId ?? person.staffToken ?? String(index),
      // The service resolves「姓名 · 部门」server-side; the stripped token is only a
      // fallback, because a roster of opaque staff ids answers nobody's question.
      name: person.name?.trim() || readStaffLabel(person.staffToken) || '',
      ranges: blocks
        .slice(0, 2)
        .map((block) => formatTimeRange(block.start, block.end))
        .filter(Boolean)
        .join('、'),
    };
  });

export interface DirectoryRow {
  key: string;
  meta?: string;
  name: string;
}

export const toDirectoryRows = (hits?: {
  departments?: DirectoryDepartmentHit[];
  users?: DirectoryUserHit[];
}): DirectoryRow[] => [
  ...(hits?.users ?? []).map((user) => ({
    key: `user-${user.staffId}`,
    meta: user.deptPath || user.leafDeptName || undefined,
    name: user.name,
  })),
  ...(hits?.departments ?? []).map((dept) => ({
    key: `dept-${dept.deptId}`,
    meta: dept.pathNames || undefined,
    name: dept.name,
  })),
];
