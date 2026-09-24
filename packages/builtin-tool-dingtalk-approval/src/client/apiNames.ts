import type { DingtalkApprovalWriteApiNameType } from '../types';
import { DingtalkApprovalWriteApiName } from '../types';

/**
 * API-name seam for the client surfaces: the canonical enums live in
 * `../types`, the UI only adds the danger list that styles the confirm card
 * and the item list of each batch write.
 */
export type { DingtalkApprovalApiNameType, DingtalkApprovalWriteApiNameType } from '../types';
export { DINGTALK_APPROVAL_WRITE_APIS, DingtalkApprovalApiName } from '../types';

/**
 * Local fallback for the accent of the confirm card: `preview.danger` from the
 * server wins, this list only covers a preview that omits the flag.
 */
export const DINGTALK_APPROVAL_DANGER_API_NAMES = new Set<string>([
  DingtalkApprovalWriteApiName.refuseTask,
  DingtalkApprovalWriteApiName.refuseTasks,
  DingtalkApprovalWriteApiName.returnTask,
  DingtalkApprovalWriteApiName.withdrawApplication,
  DingtalkApprovalWriteApiName.deleteTemplate,
  DingtalkApprovalWriteApiName.deleteApprovalRule,
]);

/**
 * Batch write APIs and the argument array that lists their items: one call,
 * one confirmation, however many approvals it acts on.
 */
export const DINGTALK_APPROVAL_BATCH_ITEM_FIELDS = {
  [DingtalkApprovalWriteApiName.approveTasks]: 'tasks',
  [DingtalkApprovalWriteApiName.refuseTasks]: 'tasks',
} as const satisfies Partial<Record<DingtalkApprovalWriteApiNameType, string>>;

export type DingtalkApprovalBatchApiName = keyof typeof DINGTALK_APPROVAL_BATCH_ITEM_FIELDS;

export const isDingtalkApprovalBatchApiName = (
  apiName: unknown,
): apiName is DingtalkApprovalBatchApiName =>
  typeof apiName === 'string' && Object.hasOwn(DINGTALK_APPROVAL_BATCH_ITEM_FIELDS, apiName);
