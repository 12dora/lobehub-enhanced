import type { DingtalkPersonalWriteApiNames } from '../types';
import { DingtalkPersonalApiName } from '../types';

/**
 * API-name seam for the client surfaces: the canonical enums live in
 * `../types`, the UI only adds the groupings the cards need.
 */
export { DingtalkPersonalApiName, DingtalkPersonalWriteApiNames } from '../types';

export type DingtalkPersonalApiNameValue =
  (typeof DingtalkPersonalApiName)[keyof typeof DingtalkPersonalApiName];

export type DingtalkPersonalWriteApiNameValue = (typeof DingtalkPersonalWriteApiNames)[number];

/** Which product area an API belongs to — drives the inspector prefix. */
export const DINGTALK_PERSONAL_DOMAINS = {
  [DingtalkPersonalApiName.completeTodo]: 'todo',
  [DingtalkPersonalApiName.downloadMessageFile]: 'chat',
  [DingtalkPersonalApiName.getReport]: 'report',
  [DingtalkPersonalApiName.getReportTemplate]: 'report',
  [DingtalkPersonalApiName.getTodo]: 'todo',
  [DingtalkPersonalApiName.listGroupMessages]: 'chat',
  [DingtalkPersonalApiName.listMyGroups]: 'chat',
  [DingtalkPersonalApiName.listMyTodos]: 'todo',
  [DingtalkPersonalApiName.listReports]: 'report',
  [DingtalkPersonalApiName.listReportTemplates]: 'report',
  [DingtalkPersonalApiName.searchGroups]: 'chat',
  [DingtalkPersonalApiName.searchMessages]: 'chat',
  [DingtalkPersonalApiName.submitReport]: 'report',
  [DingtalkPersonalApiName.updateTodo]: 'todo',
} as const satisfies Record<DingtalkPersonalApiNameValue, 'chat' | 'report' | 'todo'>;

export type DingtalkPersonalDomain =
  (typeof DINGTALK_PERSONAL_DOMAINS)[keyof typeof DINGTALK_PERSONAL_DOMAINS];

export const isDingtalkPersonalApiName = (
  apiName: unknown,
): apiName is DingtalkPersonalApiNameValue =>
  typeof apiName === 'string' && Object.hasOwn(DINGTALK_PERSONAL_DOMAINS, apiName);
