import type { BuiltinRender } from '@lobechat/types';

import { DingtalkPersonalApiName } from '../apiNames';
import ResultRender from './ResultRender';

/**
 * Render registry: every API (reads and confirmed writes) maps to the same
 * `kind`-driven result view, which also shows the inline authorize widget when
 * the call needs the user's DingTalk authorization first.
 */
export const DingtalkPersonalRenders: Record<string, BuiltinRender> = Object.fromEntries(
  Object.values(DingtalkPersonalApiName).map((apiName) => [apiName, ResultRender as BuiltinRender]),
);

export { default as DingtalkPersonalAuthorizationRequiredRender } from './AuthorizationRequired';
export { default as DingtalkPersonalBatchWriteRender } from './BatchWriteResult';
export { default as DingtalkPersonalFileRender } from './FileResult';
export { default as DingtalkPersonalGroupListRender } from './GroupList';
export { default as DingtalkPersonalMessageListRender } from './MessageList';
export { default as DingtalkPersonalReportDetailRender } from './ReportDetail';
export { default as DingtalkPersonalReportListRender } from './ReportList';
export type { DingtalkPersonalRenderState } from './ResultRender';
export { default as DingtalkPersonalResultRender } from './ResultRender';
export { default as DingtalkPersonalTemplateDetailRender } from './TemplateDetail';
export { default as DingtalkPersonalTemplateListRender } from './TemplateList';
export { default as DingtalkPersonalTodoDetailRender } from './TodoDetail';
export { default as DingtalkPersonalTodoListRender } from './TodoList';
export { default as DingtalkPersonalWriteRender } from './WriteResult';
