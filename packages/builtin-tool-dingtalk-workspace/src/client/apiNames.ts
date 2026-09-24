import type { DingtalkWorkspaceApiNameType, DingtalkWorkspaceWriteApiName } from '../types';
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
  [DingtalkWorkspaceApiName.completeTodos]: 'todo',
  [DingtalkWorkspaceApiName.createEvent]: 'calendar',
  [DingtalkWorkspaceApiName.createTodo]: 'todo',
  [DingtalkWorkspaceApiName.deleteEvent]: 'calendar',
  [DingtalkWorkspaceApiName.deleteTodo]: 'todo',
  [DingtalkWorkspaceApiName.deleteTodos]: 'todo',
  [DingtalkWorkspaceApiName.getEvent]: 'calendar',
  [DingtalkWorkspaceApiName.listEvents]: 'calendar',
  [DingtalkWorkspaceApiName.listMeetingRooms]: 'calendar',
  [DingtalkWorkspaceApiName.listTodos]: 'todo',
  [DingtalkWorkspaceApiName.queryFreeBusy]: 'calendar',
  [DingtalkWorkspaceApiName.respondEvent]: 'calendar',
  [DingtalkWorkspaceApiName.searchDirectory]: 'directory',
  [DingtalkWorkspaceApiName.updateEvent]: 'calendar',
  [DingtalkWorkspaceApiName.updateTodo]: 'todo',
} as const satisfies Record<DingtalkWorkspaceApiNameType, 'calendar' | 'directory' | 'todo'>;

export type DingtalkWorkspaceDomain =
  (typeof DINGTALK_WORKSPACE_DOMAINS)[keyof typeof DINGTALK_WORKSPACE_DOMAINS];

/**
 * Local fallback for the accent of the confirm card: `preview.danger` from the
 * server wins, this list only covers a preview that omits the flag.
 */
export const DINGTALK_WORKSPACE_DANGER_API_NAMES = new Set<string>([
  DingtalkWorkspaceApiName.deleteTodo,
  DingtalkWorkspaceApiName.deleteTodos,
  DingtalkWorkspaceApiName.deleteEvent,
]);

/**
 * Batch write APIs and the argument array that lists their items: one call,
 * one confirmation, however many todos it touches.
 */
export const DINGTALK_WORKSPACE_BATCH_ITEM_FIELDS = {
  [DingtalkWorkspaceApiName.completeTodos]: 'taskIds',
  [DingtalkWorkspaceApiName.deleteTodos]: 'taskIds',
} as const satisfies Partial<Record<DingtalkWorkspaceWriteApiName, string>>;

export type DingtalkWorkspaceBatchApiName = keyof typeof DINGTALK_WORKSPACE_BATCH_ITEM_FIELDS;

export const isDingtalkWorkspaceBatchApiName = (
  apiName: unknown,
): apiName is DingtalkWorkspaceBatchApiName =>
  typeof apiName === 'string' && Object.hasOwn(DINGTALK_WORKSPACE_BATCH_ITEM_FIELDS, apiName);
