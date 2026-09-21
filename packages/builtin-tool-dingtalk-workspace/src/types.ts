export const DingtalkWorkspaceIdentifier = 'lobe-dingtalk-workspace';

export const DingtalkWorkspaceApiName = {
  completeTodo: 'completeTodo',
  createEvent: 'createEvent',
  createTodo: 'createTodo',
  deleteEvent: 'deleteEvent',
  deleteTodo: 'deleteTodo',
  getEvent: 'getEvent',
  listEvents: 'listEvents',
  listMeetingRooms: 'listMeetingRooms',
  listTodos: 'listTodos',
  queryFreeBusy: 'queryFreeBusy',
  respondEvent: 'respondEvent',
  searchDirectory: 'searchDirectory',
  updateEvent: 'updateEvent',
  updateTodo: 'updateTodo',
} as const;

export type DingtalkWorkspaceApiNameType =
  (typeof DingtalkWorkspaceApiName)[keyof typeof DingtalkWorkspaceApiName];

/** Write APIs — each has humanIntervention: 'always'. */
export const DingtalkWorkspaceWriteApiNames = [
  DingtalkWorkspaceApiName.createTodo,
  DingtalkWorkspaceApiName.updateTodo,
  DingtalkWorkspaceApiName.completeTodo,
  DingtalkWorkspaceApiName.deleteTodo,
  DingtalkWorkspaceApiName.createEvent,
  DingtalkWorkspaceApiName.updateEvent,
  DingtalkWorkspaceApiName.deleteEvent,
  DingtalkWorkspaceApiName.respondEvent,
] as const;

export type DingtalkWorkspaceWriteApiName = (typeof DingtalkWorkspaceWriteApiNames)[number];

export const DingtalkTodoPriorityValues = [10, 20, 30, 40] as const;
export type DingtalkTodoPriority = (typeof DingtalkTodoPriorityValues)[number];

export const DingtalkEventResponseStatuses = [
  'accepted',
  'declined',
  'needsAction',
  'tentative',
] as const;
export type DingtalkEventResponseStatus = (typeof DingtalkEventResponseStatuses)[number];

export type DingtalkWorkspaceRecipientKind = 'department' | 'user';

export interface DirectoryUserHit {
  active?: boolean;
  deptPath?: string;
  leafDeptId?: string | null;
  leafDeptName?: string;
  name: string;
  staffId: string;
}

export interface DirectoryDepartmentHit {
  deptId: string;
  memberCount?: number;
  name: string;
  pathNames?: string;
}

export interface SearchDirectoryParams {
  kind?: DingtalkWorkspaceRecipientKind;
  q: string;
}

export interface SearchDirectoryState {
  ambiguous: boolean;
  departmentCount: number;
  hits?: {
    departments: DirectoryDepartmentHit[];
    users: DirectoryUserHit[];
  };
  serverNow?: string;
  userCount: number;
}

export interface ListTodosParams {
  done?: boolean;
}

export interface TodoView {
  createdTime?: string | number;
  creatorId?: string;
  dueTime?: string | number | null;
  isDone?: boolean;
  priority?: number;
  sourceId?: string;
  subject?: string;
  taskId?: string;
}

export interface ListTodosState {
  count: number;
  items?: TodoView[];
  serverNow?: string;
  success: boolean;
}

export interface CreateTodoParams {
  description?: string;
  dueTime?: string;
  executorTokens?: string[];
  priority?: DingtalkTodoPriority;
  subject: string;
}

export interface CreateTodoState {
  serverNow?: string;
  success: boolean;
  taskId?: string;
}

export interface UpdateTodoParams {
  description?: string;
  done?: boolean;
  /** ISO 8601 due time; `null` clears the due time. */
  dueTime?: string | null;
  executorTokens?: string[];
  priority?: DingtalkTodoPriority;
  subject?: string;
  taskId: string;
}

export interface UpdateTodoState {
  serverNow?: string;
  success: boolean;
  taskId: string;
}

export interface CompleteTodoParams {
  taskId: string;
}

export interface CompleteTodoState {
  serverNow?: string;
  success: boolean;
  taskId: string;
}

export interface DeleteTodoParams {
  taskId: string;
}

export interface DeleteTodoState {
  serverNow?: string;
  success: boolean;
  taskId: string;
}

export interface ListEventsParams {
  from: string;
  to: string;
}

export interface CalendarEventView {
  attendees?: Array<{
    displayName?: string;
    isOptional?: boolean;
    staffToken?: string;
    unresolved?: boolean;
  }>;
  description?: string;
  end?: string;
  eventId?: string;
  id?: string;
  isAllDay?: boolean;
  location?: string;
  organizer?: {
    displayName?: string;
    self?: boolean;
    staffToken?: string;
    unresolved?: boolean;
  };
  start?: string;
  summary?: string;
}

export interface ListEventsState {
  count: number;
  items?: CalendarEventView[];
  serverNow?: string;
  success: boolean;
}

export interface GetEventParams {
  eventId: string;
}

export interface GetEventState {
  event?: CalendarEventView;
  serverNow?: string;
  success: boolean;
}

export interface QueryFreeBusyParams {
  from: string;
  staffTokens: string[];
  to: string;
}

export interface FreeBusyBlock {
  end?: string;
  start?: string;
  status?: 'BUSY' | 'TENTATIVE' | string;
}

export interface FreeBusyPerson {
  blocks?: FreeBusyBlock[];
  error?: string;
  name?: string;
  staffToken?: string;
  status?: 'unknown' | string;
  /** @deprecated Model payloads omit this; kept for older UI rows. */
  unionId?: string;
}

export interface QueryFreeBusyState {
  people?: FreeBusyPerson[];
  serverNow?: string;
  success: boolean;
}

/** No model-facing filters; unionId is resolved server-side. */
export type ListMeetingRoomsParams = Record<string, never>;

export interface MeetingRoomView {
  roomCapacity?: number;
  roomId?: string;
  roomName?: string;
  roomStatus?: number;
}

export interface ListMeetingRoomsState {
  count: number;
  items?: MeetingRoomView[];
  serverNow?: string;
  success: boolean;
}

export interface CreateEventParams {
  attendeeTokens?: string[];
  description?: string;
  end: string;
  isAllDay?: boolean;
  location?: string;
  onlineMeeting?: boolean;
  reminders?: number[];
  roomIds?: string[];
  start: string;
  summary: string;
}

export interface CreateEventState {
  eventId?: string;
  serverNow?: string;
  success: boolean;
}

export interface UpdateEventParams {
  attendeeTokens?: string[];
  description?: string;
  end?: string;
  eventId: string;
  isAllDay?: boolean;
  location?: string;
  onlineMeeting?: boolean;
  reminders?: number[];
  roomIds?: string[];
  start?: string;
  summary?: string;
}

export interface UpdateEventState {
  eventId: string;
  serverNow?: string;
  success: boolean;
}

export interface DeleteEventParams {
  eventId: string;
}

export interface DeleteEventState {
  eventId: string;
  serverNow?: string;
  success: boolean;
}

export interface RespondEventParams {
  eventId: string;
  responseStatus: DingtalkEventResponseStatus;
}

export interface RespondEventState {
  eventId: string;
  responseStatus: DingtalkEventResponseStatus;
  serverNow?: string;
  success: boolean;
}

/** Confirm-card preview (lambda `preview`; not a model-facing API). */
export interface WorkspacePreviewParams {
  apiName: DingtalkWorkspaceWriteApiName | string;
  args: Record<string, unknown>;
}

export interface WorkspacePreviewActingAs {
  deptPath: string;
  name: string;
}

export interface WorkspacePreviewLine {
  label: string;
  value: string;
}

export interface WorkspacePreviewResult {
  actingAs: WorkspacePreviewActingAs;
  danger: boolean;
  lines: WorkspacePreviewLine[];
  title: string;
  warnings: string[];
}

export interface AmbiguousCandidate {
  deptPath?: string;
  leafDeptName?: string;
  name: string;
  staffId: string;
}
