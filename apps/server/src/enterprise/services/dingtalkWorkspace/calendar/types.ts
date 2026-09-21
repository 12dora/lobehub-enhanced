import type { DingtalkWorkspacePreview, DingtalkWorkspacePreviewLine } from '../todo/types';

export type { DingtalkWorkspacePreview, DingtalkWorkspacePreviewLine };

export interface DingtalkCalendarIdentity {
  name: string;
  staffId: string;
  unionId: string;
}

export interface DingtalkDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface DingtalkCalendarAttendee {
  displayName?: string;
  /** Upstream unionId — stripped before the model-facing payload. */
  id?: string;
  isOptional?: boolean;
  self?: boolean;
  staffToken?: string;
  unresolved?: boolean;
}

export interface DingtalkCalendarEvent {
  attendees: DingtalkCalendarAttendee[];
  description?: string;
  end: DingtalkDateTime;
  id: string;
  isAllDay?: boolean;
  location?: string;
  meetingRooms: Array<{ displayName?: string; roomId: string }>;
  onlineMeeting: boolean;
  organizer?: {
    displayName?: string;
    /** Upstream unionId — stripped before the model-facing payload. */
    id?: string;
    self?: boolean;
    staffToken?: string;
    unresolved?: boolean;
  };
  reminders: Array<{ method?: string; minutes: number }>;
  start: DingtalkDateTime;
  status?: string;
  summary: string;
}

export interface DingtalkCalendarListInput {
  from: string;
  to: string;
}

export interface DingtalkCalendarListResult {
  items: DingtalkCalendarEvent[];
  truncated: boolean;
}

export interface DingtalkFreeBusyBlock {
  end: DingtalkDateTime;
  start: DingtalkDateTime;
  status: 'BUSY' | 'TENTATIVE' | 'FREE' | string;
}

export interface DingtalkFreeBusyPerson {
  blocks: DingtalkFreeBusyBlock[];
  /** Stable DINGTALK_* code when the upstream per-user query failed. */
  error?: string;
  name: string;
  staffToken: string;
  /** Set when DingTalk returned no row for this requested person. */
  status?: 'unknown';
}

export interface DingtalkMeetingRoom {
  roomCapacity?: number;
  roomId: string;
  roomLocation?: string;
  roomName: string;
  roomStatus?: number;
}

export interface DingtalkCalendarCreateInput {
  attendeeTokens?: string[];
  description?: string;
  end: string;
  isAllDay?: boolean;
  location?: string;
  onlineMeeting?: boolean;
  reminders?: Array<number | { method?: string; minutes: number }>;
  roomIds?: string[];
  start: string;
  summary: string;
}

export interface DingtalkCalendarUpdateInput extends Partial<DingtalkCalendarCreateInput> {
  eventId: string;
}

export interface DingtalkCalendarIdInput {
  eventId: string;
}

export interface DingtalkCalendarRespondInput {
  eventId: string;
  responseStatus: 'needsAction' | 'accepted' | 'declined' | 'tentative';
}

export const CALENDAR_WRITE_API_NAMES = [
  'createEvent',
  'updateEvent',
  'deleteEvent',
  'respondEvent',
] as const;

export type CalendarWriteApiName = (typeof CALENDAR_WRITE_API_NAMES)[number];

export const isCalendarWriteApiName = (value: string): value is CalendarWriteApiName =>
  (CALENDAR_WRITE_API_NAMES as readonly string[]).includes(value);

export type CalendarPreview = DingtalkWorkspacePreview;
