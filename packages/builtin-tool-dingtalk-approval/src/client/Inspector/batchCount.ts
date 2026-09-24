import type { DingtalkApprovalBatchApiName } from '../apiNames';
import { DINGTALK_APPROVAL_BATCH_ITEM_FIELDS, isDingtalkApprovalBatchApiName } from '../apiNames';

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

/**
 * One `{ processInstanceId, taskId }` entry. A streaming parser hands over `{}` the
 * moment an object opens, so an entry only counts once it names something.
 */
const isItem = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const { processInstanceId, taskId } = value as Record<string, unknown>;
  return hasText(taskId) || hasText(processInstanceId);
};

/**
 * How many approvals a batch call acts on, e.g. 2 for `approveTasks { tasks: [a, b] }`.
 * Undefined for any other API, and while the array has not streamed in yet or holds
 * nothing usable — the header then falls back to the plain action name.
 */
export const batchItemCount = (apiName: string, args?: unknown): number | undefined => {
  if (!isDingtalkApprovalBatchApiName(apiName)) return undefined;
  if (!args || typeof args !== 'object') return undefined;

  const list = (args as Record<string, unknown>)[DINGTALK_APPROVAL_BATCH_ITEM_FIELDS[apiName]];
  if (!Array.isArray(list)) return undefined;

  const count = list.filter(isItem).length;
  return count > 0 ? count : undefined;
};

/** The batch API and its item count, when the header can say 「同意 2 项审批」. */
export const resolveBatchCall = (
  apiName: string,
  args?: unknown,
  partialArgs?: unknown,
): { apiName: DingtalkApprovalBatchApiName; count: number } | undefined => {
  if (!isDingtalkApprovalBatchApiName(apiName)) return undefined;

  // Final args win; while they are still streaming, the partial ones already count.
  const count = batchItemCount(apiName, args) ?? batchItemCount(apiName, partialArgs);
  return count ? { apiName, count } : undefined;
};
