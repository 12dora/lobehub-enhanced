import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import type { LobeChatDatabase } from '@/database/type';
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from '@/server/enterprise/services/audit/auditActionCatalog';
import { assertDingtalkFeature } from '@/server/enterprise/services/dingtalkWorkspace/capabilities';
import { dingtalkWorkspaceRequest } from '@/server/enterprise/services/dingtalkWorkspace/client';
import { DingtalkWorkspaceError } from '@/server/enterprise/services/dingtalkWorkspace/errors';
import { requireVerifiedDingtalkIdentity } from '@/server/enterprise/services/dingtalkWorkspace/identity';
import { PlatformAuditService } from '@/server/enterprise/services/platformAudit';

import {
  actingAsFromIdentity,
  failWorkspace,
  formatStaffLabel,
  lookupStaffByUnionIds,
  resolveStaffTokens,
  toStaffToken,
} from '../todo/staffTokens';
import { parseMeetingRoomIssues } from './roomIssues';
import type {
  DingtalkCalendarCreateInput,
  DingtalkCalendarEvent,
  DingtalkCalendarIdentity,
  DingtalkCalendarIdInput,
  DingtalkCalendarListInput,
  DingtalkCalendarListResult,
  DingtalkCalendarRespondInput,
  DingtalkCalendarUpdateInput,
  DingtalkDateTime,
  DingtalkFreeBusyPerson,
  DingtalkMeetingRoom,
  DingtalkWorkspacePreview,
  DingtalkWorkspacePreviewLine,
} from './types';
import { isCalendarWriteApiName } from './types';

export type {
  CalendarWriteApiName,
  DingtalkCalendarCreateInput,
  DingtalkCalendarEvent,
  DingtalkCalendarIdInput,
  DingtalkCalendarListInput,
  DingtalkCalendarListResult,
  DingtalkCalendarRespondInput,
  DingtalkCalendarUpdateInput,
  DingtalkDateTime,
  DingtalkFreeBusyBlock,
  DingtalkFreeBusyPerson,
  DingtalkMeetingRoom,
  DingtalkWorkspacePreview,
} from './types';
export { CALENDAR_WRITE_API_NAMES, isCalendarWriteApiName } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Shanghai';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ATTENDEES = 500;
const MAX_FREE_BUSY = 20;
const MAX_ROOMS_PER_EVENT = 5;
const MAX_LIST_PAGES = 2;
const MAX_LIST_ITEMS = 100;
const MAX_ROOM_PAGES = 20;
const MAX_SPAN_MS = 366 * 24 * 60 * 60 * 1000;
const RESPONSE_STATUS = new Set(['needsAction', 'accepted', 'declined', 'tentative']);
export const CALENDAR_ROOM_LIST_CACHE_MS = 10 * 60 * 1000;

type CachedRoomList = { expiresAt: number; items: DingtalkMeetingRoom[] };
const roomListCache = new Map<string, CachedRoomList>();

export const resetCalendarRoomListCacheForTest = (): void => {
  roomListCache.clear();
};

const rethrowWithRoomIssues: (error: unknown, extras?: { timeApplied?: boolean }) => never = (
  error,
  extras,
) => {
  if (error instanceof DingtalkWorkspaceError && error.code === 'DINGTALK_ROOM_UNAVAILABLE') {
    const issues = parseMeetingRoomIssues(error.upstreamMessage);
    if (issues.length > 0) Object.assign(error, { roomIssues: issues });
    if (extras?.timeApplied) Object.assign(error, { timeApplied: true });
  }
  throw error;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
};

const calendarEventPath = (unionId: string, eventId?: string): string => {
  const base = `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/primary/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
};

const calendarEventsViewPath = (unionId: string): string =>
  `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/primary/eventsview`;

const requireText = (
  value: string | undefined,
  code: 'DINGTALK_INVALID' | 'DINGTALK_UNAVAILABLE' = 'DINGTALK_INVALID',
): string => {
  if (!value) return failWorkspace(code);
  return value;
};

const hasExplicitOffset = (value: string): boolean => /z|[+-]\d{2}:\d{2}$/i.test(value);

const parseWallClock = (value: string): dayjs.Dayjs => {
  const trimmed = value.trim();
  if (!trimmed) return failWorkspace('DINGTALK_INVALID');
  const parsed = hasExplicitOffset(trimmed)
    ? dayjs(trimmed).tz(TZ)
    : DATE_RE.test(trimmed)
      ? dayjs.tz(`${trimmed} 00:00:00`, TZ)
      : dayjs.tz(trimmed.replace('T', ' ').slice(0, 19), TZ);
  if (!parsed.isValid()) return failWorkspace('DINGTALK_INVALID');
  return parsed;
};

const toDateTimePayload = (value: string, isAllDay?: boolean): DingtalkDateTime => {
  const trimmed = value.trim();
  if (isAllDay || DATE_RE.test(trimmed)) {
    const date = trimmed.slice(0, 10);
    if (!DATE_RE.test(date)) return failWorkspace('DINGTALK_INVALID');
    return { date, timeZone: TZ };
  }
  const local = parseWallClock(trimmed);
  return { dateTime: local.format('YYYY-MM-DDTHH:mm:ssZ'), timeZone: TZ };
};

const toRangeInstant = (value: string): Date => parseWallClock(value).toDate();

const assertTimeRange = (from: string, to: string): void => {
  const start = toRangeInstant(from);
  const end = toRangeInstant(to);
  if (!(start.getTime() < end.getTime())) failWorkspace('DINGTALK_INVALID');
  if (end.getTime() - start.getTime() > MAX_SPAN_MS) failWorkspace('DINGTALK_INVALID');
};

const formatDateTime = (value: DingtalkDateTime): string => {
  if (value.date) return value.date;
  if (value.dateTime) return parseWallClock(value.dateTime).format('YYYY-MM-DD HH:mm');
  return '';
};

const eventPreviewHeadline = (event: DingtalkCalendarEvent): string => {
  const summary = event.summary.trim();
  if (summary) return summary;
  const start = formatDateTime(event.start);
  return start ? `(无主题) · ${start}` : '(无主题)';
};

const mapDateTime = (value: unknown): DingtalkDateTime => {
  const row = asRecord(value);
  const mapped: DingtalkDateTime = {};
  const date = asString(row.date);
  const dateTime = asString(row.dateTime);
  const timeZone = asString(row.timeZone);
  if (date) mapped.date = date;
  if (dateTime) mapped.dateTime = dateTime;
  if (timeZone) mapped.timeZone = timeZone;
  return mapped;
};

const mapMeetingRooms = (value: unknown): Array<{ displayName?: string; roomId: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const room = asRecord(item);
      const roomId = asString(room.roomId) ?? asString(room.id);
      if (!roomId) return null;
      return { displayName: asString(room.displayName) ?? asString(room.roomName), roomId };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
};

const mapEvent = (value: unknown): DingtalkCalendarEvent | null => {
  const row = asRecord(value);
  const id = asString(row.id);
  const summary = asString(row.summary) ?? '';
  if (!id) return null;
  const attendees = Array.isArray(row.attendees)
    ? row.attendees
        .map((item) => {
          const attendee = asRecord(item);
          const attendeeId = asString(attendee.id);
          const displayName = asString(attendee.displayName);
          if (!attendeeId && !displayName) return null;
          return {
            displayName,
            id: attendeeId,
            isOptional: asBoolean(attendee.isOptional),
            self: asBoolean(attendee.self),
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
    : [];
  const meetingRooms = mapMeetingRooms(row.meetingRooms);
  const reminders = Array.isArray(row.reminders)
    ? row.reminders
        .map((item) => {
          const reminder = asRecord(item);
          const minutes = asNumber(reminder.minutes);
          if (minutes === undefined) return null;
          return { method: asString(reminder.method), minutes };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
    : [];
  const organizer = asRecord(row.organizer);
  const location = asRecord(row.location);
  return {
    attendees,
    description: asString(row.description),
    end: mapDateTime(row.end),
    id,
    isAllDay: asBoolean(row.isAllDay),
    location: asString(location.displayName) ?? asString(row.location),
    meetingRooms,
    onlineMeeting: Boolean(asRecord(row.onlineMeetingInfo).type),
    organizer: {
      displayName: asString(organizer.displayName),
      id: asString(organizer.id),
      self: asBoolean(organizer.self),
    },
    reminders,
    start: mapDateTime(row.start),
    status: asString(row.status),
    summary,
  };
};

const isOrganizer = (event: DingtalkCalendarEvent, unionId: string): boolean =>
  event.organizer?.self === true || event.organizer?.id === unionId;

const parseReminders = (
  value: unknown,
): Array<{ method?: string; minutes: number }> | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return failWorkspace('DINGTALK_INVALID');
  const items: unknown[] = value;
  return items.map((item: unknown) => {
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || item < 0) return failWorkspace('DINGTALK_INVALID');
      return { method: 'dingtalk', minutes: item };
    }
    const row = asRecord(item);
    const minutes = asNumber(row.minutes);
    if (minutes === undefined || minutes < 0) return failWorkspace('DINGTALK_INVALID');
    const method = asString(row.method) ?? 'dingtalk';
    return { method, minutes };
  });
};

const reminderPayload = (value: unknown): Array<{ method: string; minutes: number }> | undefined =>
  parseReminders(value)?.map((item) => ({
    method: item.method ?? 'dingtalk',
    minutes: item.minutes,
  }));

const parseCreateInput = (args: Record<string, unknown>): DingtalkCalendarCreateInput => {
  const summary = requireText(asString(args.summary)?.trim());
  const start = requireText(asString(args.start));
  const end = requireText(asString(args.end));
  if (summary.length > 2048) return failWorkspace('DINGTALK_INVALID');
  const description = asString(args.description);
  if (description && description.length > 5000) return failWorkspace('DINGTALK_INVALID');
  const roomIds = asStringArray(args.roomIds);
  if (roomIds && roomIds.length > MAX_ROOMS_PER_EVENT) return failWorkspace('DINGTALK_INVALID');
  return {
    attendeeTokens: asStringArray(args.attendeeTokens),
    description,
    end,
    isAllDay: asBoolean(args.isAllDay),
    location: asString(args.location),
    onlineMeeting: asBoolean(args.onlineMeeting),
    reminders: parseReminders(args.reminders),
    roomIds,
    start,
    summary,
  };
};

const parseUpdateInput = (args: Record<string, unknown>): DingtalkCalendarUpdateInput => {
  const eventId = requireText(asString(args.eventId)?.trim());
  const summary = asString(args.summary)?.trim();
  if (args.summary !== undefined && !summary) return failWorkspace('DINGTALK_INVALID');
  if (summary && summary.length > 2048) return failWorkspace('DINGTALK_INVALID');
  const description = asString(args.description);
  if (description && description.length > 5000) return failWorkspace('DINGTALK_INVALID');
  const roomIds = asStringArray(args.roomIds);
  if (roomIds && roomIds.length > MAX_ROOMS_PER_EVENT) return failWorkspace('DINGTALK_INVALID');
  return {
    attendeeTokens: asStringArray(args.attendeeTokens),
    description,
    end: asString(args.end),
    eventId,
    isAllDay: asBoolean(args.isAllDay),
    location: asString(args.location),
    onlineMeeting: asBoolean(args.onlineMeeting),
    reminders: args.reminders === undefined ? undefined : parseReminders(args.reminders),
    roomIds,
    start: asString(args.start),
    summary,
  };
};

const allDayEndDate = (start: string, end: string): string => {
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return failWorkspace('DINGTALK_INVALID');
  if (endDate <= startDate) return dayjs.tz(startDate, TZ).add(1, 'day').format('YYYY-MM-DD');
  return endDate;
};

export class DingtalkCalendarService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  private async actor(): Promise<DingtalkCalendarIdentity> {
    await assertDingtalkFeature('calendar');
    const identity = await requireVerifiedDingtalkIdentity(this.db, this.userId);
    if (!identity.unionId) return failWorkspace('DINGTALK_IDENTITY_UNVERIFIED');
    return identity;
  }

  private async audit(
    action: 'create' | 'update' | 'delete' | 'respond',
    targetId: string,
    summary?: string,
  ) {
    const actions = {
      create: AUDIT_ACTION.DINGTALK_CALENDAR_CREATE,
      delete: AUDIT_ACTION.DINGTALK_CALENDAR_DELETE,
      respond: AUDIT_ACTION.DINGTALK_CALENDAR_RESPOND,
      update: AUDIT_ACTION.DINGTALK_CALENDAR_UPDATE,
    } as const;
    await new PlatformAuditService(this.db).append({
      action: actions[action],
      actorUserId: this.userId,
      afterDiff: summary ? { summary } : null,
      result: 'success',
      targetId,
      targetType: AUDIT_TARGET_TYPE.DINGTALK_CALENDAR,
    });
  }

  private async loadEvent(unionId: string, eventId: string): Promise<DingtalkCalendarEvent> {
    const raw = await dingtalkWorkspaceRequest<Record<string, unknown>>({
      api: 'v1',
      method: 'GET',
      path: calendarEventPath(unionId, eventId),
    });
    const event = mapEvent(raw);
    if (!event) return failWorkspace('DINGTALK_NOT_FOUND');
    return event;
  }

  private viewTimeBound(value: DingtalkDateTime, endOfDay: boolean): string {
    if (value.dateTime) return value.dateTime;
    if (value.date && DATE_RE.test(value.date)) {
      return endOfDay ? `${value.date}T23:59:59+08:00` : `${value.date}T00:00:00+08:00`;
    }
    return failWorkspace('DINGTALK_UNAVAILABLE');
  }

  /**
   * Booked rooms are documented on eventsview, not GET event. A missing
   * `meetingRooms` field is unknown — never treated as "none booked".
   */
  private async loadBookedRooms(
    unionId: string,
    eventId: string,
    event: DingtalkCalendarEvent,
  ): Promise<Array<{ displayName?: string; roomId: string }>> {
    const timeMin = this.viewTimeBound(event.start, false);
    const timeMax = this.viewTimeBound(event.end, true);
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const response = await dingtalkWorkspaceRequest<Record<string, unknown>>({
        api: 'v1',
        method: 'GET',
        path: calendarEventsViewPath(unionId),
        query: {
          maxResults: 100,
          nextToken,
          timeMax,
          timeMin,
        },
      });
      const events = Array.isArray(response.events) ? response.events : [];
      for (const raw of events) {
        const row = asRecord(raw);
        if (asString(row.id) !== eventId) continue;
        if (!Object.hasOwn(row, 'meetingRooms') || row.meetingRooms == null) {
          return failWorkspace('DINGTALK_UNAVAILABLE');
        }
        if (!Array.isArray(row.meetingRooms)) return failWorkspace('DINGTALK_UNAVAILABLE');
        return mapMeetingRooms(row.meetingRooms);
      }
      const token = asString(response.nextToken);
      if (!token) break;
      nextToken = token;
    }
    return failWorkspace('DINGTALK_UNAVAILABLE');
  }

  /**
   * After rooms are booked, reload via eventsview on `event`'s current window.
   * Fall back to the requested ids so a successful write never returns [].
   */
  private async reloadEventRooms(
    unionId: string,
    event: DingtalkCalendarEvent,
    requestedRoomIds: string[],
  ): Promise<Array<{ displayName?: string; roomId: string }>> {
    try {
      const rooms = await this.loadBookedRooms(unionId, event.id, event);
      if (rooms.length > 0 || requestedRoomIds.length === 0) return rooms;
    } catch {
      // Booking already succeeded; eventsview may lag or omit meetingRooms.
    }
    return requestedRoomIds.map((roomId) => ({ roomId }));
  }

  private async assertOrganizer(unionId: string, eventId: string): Promise<DingtalkCalendarEvent> {
    const event = await this.loadEvent(unionId, eventId);
    if (!isOrganizer(event, unionId)) return failWorkspace('DINGTALK_FORBIDDEN');
    return event;
  }

  private async addRooms(unionId: string, eventId: string, roomIds: string[]): Promise<void> {
    if (roomIds.length === 0) return;
    await dingtalkWorkspaceRequest({
      api: 'v1',
      body: { meetingRoomsToAdd: roomIds.map((roomId) => ({ roomId })) },
      method: 'POST',
      path: `${calendarEventPath(unionId, eventId)}/meetingRooms`,
    });
  }

  private async removeRooms(unionId: string, eventId: string, roomIds: string[]): Promise<void> {
    if (roomIds.length === 0) return;
    await dingtalkWorkspaceRequest({
      api: 'v1',
      body: { meetingRoomsToRemove: roomIds.map((roomId) => ({ roomId })) },
      method: 'POST',
      path: `${calendarEventPath(unionId, eventId)}/meetingRooms/batchRemove`,
    });
  }

  private async deleteCreatedEvent(unionId: string, eventId: string): Promise<void> {
    try {
      await dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'DELETE',
        path: calendarEventPath(unionId, eventId),
        query: { pushNotification: true },
      });
    } catch {
      // Best-effort compensating delete after a partial create.
    }
  }

  private async replaceRooms(
    unionId: string,
    eventId: string,
    current: Array<{ roomId: string }>,
    nextIds: string[],
  ): Promise<void> {
    if (nextIds.length > MAX_ROOMS_PER_EVENT) return failWorkspace('DINGTALK_INVALID');
    const currentIds = [...new Set(current.map((room) => room.roomId))];
    const nextUnique = [...new Set(nextIds)];
    const nextSet = new Set(nextUnique);
    const currentSet = new Set(currentIds);
    const toRemove = currentIds.filter((roomId) => !nextSet.has(roomId));
    const toAdd = nextUnique.filter((roomId) => !currentSet.has(roomId));
    if (toRemove.length === 0 && toAdd.length === 0) return;

    const projected = currentIds.length + toAdd.length;
    if (projected <= MAX_ROOMS_PER_EVENT) {
      await this.addRooms(unionId, eventId, toAdd);
      await this.removeRooms(unionId, eventId, toRemove);
      return;
    }

    const overflow = projected - MAX_ROOMS_PER_EVENT;
    const removeFirst = toRemove.slice(0, overflow);
    const removeAfter = toRemove.slice(overflow);
    await this.removeRooms(unionId, eventId, removeFirst);
    try {
      await this.addRooms(unionId, eventId, toAdd);
    } catch (error) {
      try {
        await this.addRooms(unionId, eventId, removeFirst);
      } catch {
        // Best-effort restore of rooms that had to be freed for the 5-room cap.
      }
      throw error;
    }
    await this.removeRooms(unionId, eventId, removeAfter);
  }

  private presentPerson(
    unionId: string | undefined,
    displayName: string | undefined,
    extra: { isOptional?: boolean; self?: boolean },
    byUnionId: Map<string, { name: string; staffId: string }>,
  ) {
    const person = unionId ? byUnionId.get(unionId) : undefined;
    if (person) {
      return {
        displayName: person.name || displayName,
        ...extra,
        staffToken: toStaffToken(person.staffId),
      };
    }
    return {
      displayName,
      ...extra,
      unresolved: true as const,
    };
  }

  private async presentEvents(events: DingtalkCalendarEvent[]): Promise<DingtalkCalendarEvent[]> {
    const unionIds = events.flatMap((event) => {
      const ids = event.attendees.map((attendee) => attendee.id).filter((id): id is string => !!id);
      if (event.organizer?.id) ids.push(event.organizer.id);
      return ids;
    });
    const byUnionId = await lookupStaffByUnionIds(this.db, unionIds);
    return events.map((event) => ({
      ...event,
      attendees: event.attendees.map((attendee) =>
        this.presentPerson(
          attendee.id,
          attendee.displayName,
          {
            isOptional: attendee.isOptional,
            self: attendee.self,
          },
          byUnionId,
        ),
      ),
      organizer: event.organizer
        ? this.presentPerson(
            event.organizer.id,
            event.organizer.displayName,
            {
              self: event.organizer.self,
            },
            byUnionId,
          )
        : undefined,
    }));
  }

  private async presentEvent(event: DingtalkCalendarEvent): Promise<DingtalkCalendarEvent> {
    const [presented] = await this.presentEvents([event]);
    return presented ?? event;
  }

  listEvents = async (input: DingtalkCalendarListInput): Promise<DingtalkCalendarListResult> => {
    const identity = await this.actor();
    assertTimeRange(input.from, input.to);
    const items: DingtalkCalendarEvent[] = [];
    let nextToken: string | undefined;
    let truncated = false;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const response = await dingtalkWorkspaceRequest<Record<string, unknown>>({
        api: 'v1',
        method: 'GET',
        path: calendarEventsViewPath(identity.unionId),
        query: {
          maxResults: 100,
          nextToken,
          timeMax: toDateTimePayload(input.to).dateTime ?? input.to,
          timeMin: toDateTimePayload(input.from).dateTime ?? input.from,
        },
      });
      const events = Array.isArray(response.events) ? response.events : [];
      for (const event of events) {
        const mapped = mapEvent(event);
        if (mapped) items.push(mapped);
        if (items.length >= MAX_LIST_ITEMS) break;
      }
      const token = asString(response.nextToken);
      if (items.length >= MAX_LIST_ITEMS) {
        truncated = items.length > MAX_LIST_ITEMS || Boolean(token);
        return {
          items: await this.presentEvents(items.slice(0, MAX_LIST_ITEMS)),
          truncated,
        };
      }
      if (!token) return { items: await this.presentEvents(items), truncated };
      nextToken = token;
    }
    truncated = true;
    return { items: await this.presentEvents(items), truncated };
  };

  getEvent = async (input: DingtalkCalendarIdInput): Promise<DingtalkCalendarEvent> => {
    const identity = await this.actor();
    if (!input.eventId.trim()) return failWorkspace('DINGTALK_INVALID');
    return this.presentEvent(await this.loadEvent(identity.unionId, input.eventId));
  };

  queryFreeBusy = async (input: {
    from: string;
    staffTokens: string[];
    to: string;
  }): Promise<{ people: DingtalkFreeBusyPerson[] }> => {
    const identity = await this.actor();
    assertTimeRange(input.from, input.to);
    const staff = await resolveStaffTokens(this.db, input.staffTokens, MAX_FREE_BUSY);
    if (staff.length === 0) return failWorkspace('DINGTALK_INVALID');
    const response = await dingtalkWorkspaceRequest<Record<string, unknown>>({
      api: 'v1',
      body: {
        endTime: toDateTimePayload(input.to).dateTime ?? input.to,
        startTime: toDateTimePayload(input.from).dateTime ?? input.from,
        userIds: staff.map((item) => item.unionId),
      },
      method: 'POST',
      path: `/v1.0/calendar/users/${encodeURIComponent(identity.unionId)}/querySchedule`,
    });
    const scheduleByUnionId = new Map<string, Record<string, unknown>>();
    const rows = Array.isArray(response.scheduleInformation) ? response.scheduleInformation : [];
    for (const row of rows) {
      const info = asRecord(row);
      const unionId = asString(info.userId);
      if (unionId) scheduleByUnionId.set(unionId, info);
    }
    const people: DingtalkFreeBusyPerson[] = staff.map((person) => {
      const info = scheduleByUnionId.get(person.unionId);
      if (!info) {
        return {
          blocks: [],
          error: 'DINGTALK_UNAVAILABLE',
          name: formatStaffLabel(person),
          staffToken: toStaffToken(person.staffId),
          status: 'unknown',
        };
      }
      const items = Array.isArray(info.scheduleItems) ? info.scheduleItems : [];
      const blocks = items.map((item) => {
        const block = asRecord(item);
        return {
          end: mapDateTime(block.end),
          start: mapDateTime(block.start),
          status: asString(block.status) ?? 'BUSY',
        };
      });
      const upstreamError = asString(info.error);
      return {
        blocks,
        error: upstreamError ? 'DINGTALK_UNAVAILABLE' : undefined,
        name: formatStaffLabel(person),
        staffToken: toStaffToken(person.staffId),
      };
    });
    return { people };
  };

  private async fetchMeetingRoomsUncached(unionId: string): Promise<DingtalkMeetingRoom[]> {
    const items: DingtalkMeetingRoom[] = [];
    let nextToken: string | number | undefined;
    for (let page = 0; page < MAX_ROOM_PAGES; page++) {
      const response = await dingtalkWorkspaceRequest<Record<string, unknown>>({
        api: 'v1',
        method: 'GET',
        path: '/v1.0/rooms/meetingRoomLists',
        query: {
          maxResults: 100,
          nextToken,
          unionId,
        },
      });
      const rooms = Array.isArray(response.result) ? response.result : [];
      for (const room of rooms) {
        const row = asRecord(room);
        const roomId = asString(row.roomId);
        const roomName = asString(row.roomName);
        if (!roomId || !roomName) continue;
        const location = asRecord(row.roomLocation);
        items.push({
          roomCapacity: asNumber(row.roomCapacity),
          roomId,
          roomLocation: asString(location.title) ?? asString(location.desc),
          roomName,
          roomStatus: asNumber(row.roomStatus),
        });
      }
      if (!response.hasMore) break;
      nextToken = (asString(response.nextToken) ?? asNumber(response.nextToken)) as
        string | number | undefined;
      if (nextToken === undefined) break;
    }
    return items;
  }

  private async loadCachedRooms(unionId: string): Promise<DingtalkMeetingRoom[]> {
    const cached = roomListCache.get(unionId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.items;
    const items = await this.fetchMeetingRoomsUncached(unionId);
    roomListCache.set(unionId, { expiresAt: now + CALENDAR_ROOM_LIST_CACHE_MS, items });
    return items;
  }

  private async previewRoomLine(
    unionId: string,
    roomIds: string[],
  ): Promise<{ value: string; warning?: string }> {
    if (roomIds.length === 0) return { value: '清除会议室' };
    const rooms = await this.loadCachedRooms(unionId).catch((): DingtalkMeetingRoom[] => []);
    const byId = new Map(rooms.map((room) => [room.roomId, room.roomName]));
    let unknown = false;
    const labels = roomIds.map((roomId) => {
      const name = byId.get(roomId);
      if (name) return name;
      unknown = true;
      return '未知会议室';
    });
    return {
      value: labels.join('、'),
      warning: unknown ? '有会议室无法识别，请先列出会议室后使用返回的 roomId' : undefined,
    };
  }

  listMeetingRooms = async (): Promise<{ items: DingtalkMeetingRoom[] }> => {
    const identity = await this.actor();
    const items = await this.fetchMeetingRoomsUncached(identity.unionId);
    roomListCache.set(identity.unionId, {
      expiresAt: Date.now() + CALENDAR_ROOM_LIST_CACHE_MS,
      items,
    });
    return { items };
  };

  createEvent = async (input: DingtalkCalendarCreateInput): Promise<DingtalkCalendarEvent> => {
    const identity = await this.actor();
    const attendees = await resolveStaffTokens(this.db, input.attendeeTokens, MAX_ATTENDEES);
    const start = toDateTimePayload(input.start, input.isAllDay);
    const end = input.isAllDay
      ? { date: allDayEndDate(input.start, input.end), timeZone: TZ }
      : toDateTimePayload(input.end, input.isAllDay);
    if (!input.isAllDay) assertTimeRange(input.start, input.end);
    const created = await dingtalkWorkspaceRequest<Record<string, unknown>>({
      api: 'v1',
      body: {
        attendees: attendees.map((item) => ({ id: item.unionId })),
        description: input.description,
        end,
        isAllDay: input.isAllDay,
        location: input.location ? { displayName: input.location } : undefined,
        onlineMeetingInfo: input.onlineMeeting ? { type: 'dingtalk' } : undefined,
        reminders: reminderPayload(input.reminders),
        start,
        summary: input.summary.trim(),
      },
      method: 'POST',
      path: calendarEventPath(identity.unionId),
    });
    const event = mapEvent(created);
    if (!event) return failWorkspace('DINGTALK_UNAVAILABLE');
    let meetingRooms = event.meetingRooms;
    if (input.roomIds?.length) {
      try {
        await this.addRooms(identity.unionId, event.id, input.roomIds);
      } catch (error) {
        await this.deleteCreatedEvent(identity.unionId, event.id);
        rethrowWithRoomIssues(error);
      }
      meetingRooms = await this.reloadEventRooms(
        identity.unionId,
        { ...event, end, start },
        input.roomIds,
      );
    }
    await this.audit('create', event.id, event.summary);
    return this.presentEvent({ ...event, meetingRooms });
  };

  updateEvent = async (input: DingtalkCalendarUpdateInput): Promise<DingtalkCalendarEvent> => {
    const identity = await this.actor();
    if (!input.eventId.trim()) return failWorkspace('DINGTALK_INVALID');
    const existing = await this.assertOrganizer(identity.unionId, input.eventId);
    const attendees = await resolveStaffTokens(this.db, input.attendeeTokens, MAX_ATTENDEES);
    const body: Record<string, unknown> = { id: input.eventId };
    if (input.summary !== undefined) body.summary = input.summary.trim();
    if (input.description !== undefined) body.description = input.description;
    if (input.isAllDay !== undefined) body.isAllDay = input.isAllDay;
    const nextStart: DingtalkDateTime | undefined =
      input.start !== undefined ? toDateTimePayload(input.start, input.isAllDay) : undefined;
    const nextEnd: DingtalkDateTime | undefined =
      input.end !== undefined
        ? input.isAllDay
          ? { date: allDayEndDate(input.start ?? input.end, input.end), timeZone: TZ }
          : toDateTimePayload(input.end, input.isAllDay)
        : undefined;
    if (nextStart) body.start = nextStart;
    if (nextEnd) body.end = nextEnd;
    if (input.location !== undefined) body.location = { displayName: input.location };
    if (input.onlineMeeting !== undefined) {
      body.onlineMeetingInfo = input.onlineMeeting ? { type: 'dingtalk' } : undefined;
    }
    const reminders = reminderPayload(input.reminders);
    if (reminders) body.reminders = reminders;
    if (input.attendeeTokens) body.attendees = attendees.map((item) => ({ id: item.unionId }));
    // Load rooms while the event is still at `existing` times — never query
    // the pre-PUT window after the event has moved.
    const currentRooms =
      input.roomIds !== undefined
        ? await this.loadBookedRooms(identity.unionId, input.eventId, existing)
        : undefined;
    const updated = await dingtalkWorkspaceRequest<Record<string, unknown>>({
      api: 'v1',
      body,
      method: 'PUT',
      path: calendarEventPath(identity.unionId, input.eventId),
    });
    if (input.roomIds !== undefined && currentRooms !== undefined) {
      try {
        await this.replaceRooms(identity.unionId, input.eventId, currentRooms, input.roomIds);
      } catch (error) {
        rethrowWithRoomIssues(error, {
          timeApplied: Boolean(nextStart || nextEnd || input.isAllDay !== undefined),
        });
      }
    }
    const mapped = mapEvent(updated);
    if (input.roomIds !== undefined) {
      const base = mapped ?? existing;
      const windowEvent: DingtalkCalendarEvent = {
        ...base,
        end: nextEnd ?? base.end,
        start: nextStart ?? base.start,
      };
      const meetingRooms = await this.reloadEventRooms(
        identity.unionId,
        windowEvent,
        input.roomIds,
      );
      await this.audit('update', input.eventId, windowEvent.summary);
      return this.presentEvent({ ...windowEvent, meetingRooms });
    }
    const event = mapped ?? (await this.loadEvent(identity.unionId, input.eventId));
    await this.audit('update', input.eventId, event.summary);
    return this.presentEvent(event);
  };

  deleteEvent = async (
    input: DingtalkCalendarIdInput,
  ): Promise<{ ok: boolean; eventId: string }> => {
    const identity = await this.actor();
    if (!input.eventId.trim()) return failWorkspace('DINGTALK_INVALID');
    await this.assertOrganizer(identity.unionId, input.eventId);
    await dingtalkWorkspaceRequest({
      api: 'v1',
      method: 'DELETE',
      path: calendarEventPath(identity.unionId, input.eventId),
      query: { pushNotification: true },
    });
    await this.audit('delete', input.eventId);
    return { eventId: input.eventId, ok: true };
  };

  respondEvent = async (
    input: DingtalkCalendarRespondInput,
  ): Promise<{ ok: boolean; eventId: string }> => {
    const identity = await this.actor();
    if (!input.eventId.trim()) return failWorkspace('DINGTALK_INVALID');
    if (!RESPONSE_STATUS.has(input.responseStatus)) return failWorkspace('DINGTALK_INVALID');
    await dingtalkWorkspaceRequest({
      api: 'v1',
      body: { responseStatus: input.responseStatus },
      method: 'POST',
      path: `${calendarEventPath(identity.unionId, input.eventId)}/respond`,
    });
    await this.audit('respond', input.eventId);
    return { eventId: input.eventId, ok: true };
  };

  preview = async (input: {
    apiName: string;
    args?: Record<string, unknown>;
  }): Promise<DingtalkWorkspacePreview> => {
    const identity = await this.actor();
    if (!isCalendarWriteApiName(input.apiName)) return failWorkspace('DINGTALK_INVALID');
    const args = input.args ?? {};
    const actingAs = await actingAsFromIdentity(this.db, identity);
    const warnings: string[] = ['仅组织者可以更新或删除日程'];

    const attendeesLine = async (tokens?: string[]) => {
      const attendees = await resolveStaffTokens(this.db, tokens, MAX_ATTENDEES);
      return attendees.map(formatStaffLabel).join('、');
    };

    if (input.apiName === 'createEvent') {
      const parsed = parseCreateInput(args);
      if (!parsed.isAllDay) assertTimeRange(parsed.start, parsed.end);
      const people = await attendeesLine(parsed.attendeeTokens);
      const start = toDateTimePayload(parsed.start, parsed.isAllDay);
      const end = parsed.isAllDay
        ? { date: allDayEndDate(parsed.start, parsed.end), timeZone: TZ }
        : toDateTimePayload(parsed.end);
      const lines: DingtalkWorkspacePreviewLine[] = [
        { label: '主题', value: parsed.summary },
        { label: '开始', value: formatDateTime(start) },
        { label: '结束', value: formatDateTime(end) },
        ...(parsed.isAllDay ? [{ label: '全天', value: '是' }] : []),
        ...(parsed.location ? [{ label: '地点', value: parsed.location }] : []),
        ...(people ? [{ label: '参与人', value: people }] : []),
        ...(parsed.onlineMeeting ? [{ label: '钉钉会议', value: '是' }] : []),
      ];
      const createWarnings: string[] = [];
      if (parsed.roomIds?.length) {
        const rooms = await this.previewRoomLine(identity.unionId, parsed.roomIds);
        lines.push({ label: '会议室', value: rooms.value });
        if (rooms.warning) createWarnings.push(rooms.warning);
      }
      return { actingAs, danger: false, lines, title: '创建日程', warnings: createWarnings };
    }

    if (input.apiName === 'updateEvent') {
      const eventId = requireText(asString(args.eventId)?.trim());
      const existing = await this.assertOrganizer(identity.unionId, eventId);
      const parsed = parseUpdateInput(args);
      const people = parsed.attendeeTokens ? await attendeesLine(parsed.attendeeTokens) : '';
      const lines: DingtalkWorkspacePreviewLine[] = [
        { label: '日程', value: eventPreviewHeadline(existing) },
        ...(parsed.summary ? [{ label: '主题', value: parsed.summary }] : []),
        ...(parsed.start
          ? [
              {
                label: '开始',
                value: formatDateTime(toDateTimePayload(parsed.start, parsed.isAllDay)),
              },
            ]
          : []),
        ...(parsed.end
          ? [
              {
                label: '结束',
                value: formatDateTime(toDateTimePayload(parsed.end, parsed.isAllDay)),
              },
            ]
          : []),
        ...(people ? [{ label: '参与人', value: people }] : []),
        ...(parsed.location ? [{ label: '地点', value: parsed.location }] : []),
      ];
      if (parsed.roomIds !== undefined) {
        const rooms = await this.previewRoomLine(identity.unionId, parsed.roomIds);
        lines.push({ label: '会议室', value: rooms.value });
        if (rooms.warning) warnings.push(rooms.warning);
      }
      return { actingAs, danger: false, lines, title: '更新日程', warnings };
    }

    if (input.apiName === 'deleteEvent') {
      const eventId = requireText(asString(args.eventId)?.trim());
      const existing = await this.assertOrganizer(identity.unionId, eventId);
      return {
        actingAs,
        danger: true,
        lines: [
          { label: '日程', value: eventPreviewHeadline(existing) },
          { label: '开始', value: formatDateTime(existing.start) },
          { label: '结束', value: formatDateTime(existing.end) },
        ],
        title: '删除日程',
        warnings,
      };
    }

    const eventId = asString(args.eventId)?.trim();
    const responseStatus = asString(args.responseStatus);
    if (!eventId || !responseStatus || !RESPONSE_STATUS.has(responseStatus)) {
      return failWorkspace('DINGTALK_INVALID');
    }
    const existing = await this.presentEvent(await this.loadEvent(identity.unionId, eventId));
    const statusLabel: Record<string, string> = {
      accepted: '接受',
      declined: '拒绝',
      needsAction: '未回复',
      tentative: '待定',
    };
    const organizerName =
      existing.organizer?.displayName?.trim() ||
      (existing.organizer?.self ? actingAs.name : '') ||
      '组织者';
    return {
      actingAs,
      danger: false,
      lines: [
        { label: '日程', value: eventPreviewHeadline(existing) },
        { label: '组织者', value: organizerName },
        { label: '开始', value: formatDateTime(existing.start) },
        { label: '结束', value: formatDateTime(existing.end) },
        { label: '回复', value: statusLabel[responseStatus] ?? responseStatus },
      ],
      title: '回复日程',
      warnings: [],
    };
  };
}
