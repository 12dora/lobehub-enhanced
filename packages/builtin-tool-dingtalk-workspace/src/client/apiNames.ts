import { DingtalkWorkspaceApiName } from '../types';

/**
 * API-name seam for the client surfaces: the canonical enums live in
 * `../types`, the UI only adds the groupings the cards need.
 */
export type { DingtalkWorkspaceApiNameType, DingtalkWorkspaceWriteApiName } from '../types';
export { DingtalkWorkspaceApiName, DingtalkWorkspaceWriteApiNames } from '../types';

/** Which product area an API belongs to — drives the inspector prefix. */
export const DINGTALK_WORKSPACE_DOMAINS = {
  [DingtalkWorkspaceApiName.completeTodo]: 'todo',
  [DingtalkWorkspaceApiName.createEvent]: 'calendar',
  [DingtalkWorkspaceApiName.createTodo]: 'todo',
  [DingtalkWorkspaceApiName.deleteEvent]: 'calendar',
  [DingtalkWorkspaceApiName.deleteTodo]: 'todo',
  [DingtalkWorkspaceApiName.getEvent]: 'calendar',
  [DingtalkWorkspaceApiName.listEvents]: 'calendar',
  [DingtalkWorkspaceApiName.listMeetingRooms]: 'calendar',
  [DingtalkWorkspaceApiName.listTodos]: 'todo',
  [DingtalkWorkspaceApiName.queryFreeBusy]: 'calendar',
  [DingtalkWorkspaceApiName.respondEvent]: 'calendar',
  [DingtalkWorkspaceApiName.searchDirectory]: 'directory',
  [DingtalkWorkspaceApiName.updateEvent]: 'calendar',
  [DingtalkWorkspaceApiName.updateTodo]: 'todo',
} as const satisfies Record<string, 'calendar' | 'directory' | 'todo'>;

export type DingtalkWorkspaceDomain =
  (typeof DINGTALK_WORKSPACE_DOMAINS)[keyof typeof DINGTALK_WORKSPACE_DOMAINS];

/**
 * Local fallback for the accent of the confirm card: `preview.danger` from the
 * server wins, this list only covers a preview that omits the flag.
 */
export const DINGTALK_WORKSPACE_DANGER_API_NAMES = new Set<string>([
  DingtalkWorkspaceApiName.deleteTodo,
  DingtalkWorkspaceApiName.deleteEvent,
]);
