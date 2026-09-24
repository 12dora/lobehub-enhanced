import type { DingtalkWorkspaceBatchApiName } from '../apiNames';
import { DINGTALK_WORKSPACE_BATCH_ITEM_FIELDS, isDingtalkWorkspaceBatchApiName } from '../apiNames';

/** A todo id the model may send as a string or, for a numeric id, as a number. */
const isItem = (value: unknown): boolean =>
  (typeof value === 'string' && value.trim().length > 0) ||
  (typeof value === 'number' && Number.isFinite(value));

/**
 * How many items a batch call carries, e.g. 3 for `deleteTodos { taskIds: [a, b, c] }`.
 * Undefined for any other API, and while the array has not streamed in yet or holds
 * nothing usable — the header then falls back to the plain action name.
 */
export const batchItemCount = (apiName: string, args?: unknown): number | undefined => {
  if (!isDingtalkWorkspaceBatchApiName(apiName)) return undefined;
  if (!args || typeof args !== 'object') return undefined;

  const list = (args as Record<string, unknown>)[DINGTALK_WORKSPACE_BATCH_ITEM_FIELDS[apiName]];
  if (!Array.isArray(list)) return undefined;

  const count = list.filter(isItem).length;
  return count > 0 ? count : undefined;
};

/** The batch API and its item count, when the header can say 「完成 3 项待办」. */
export const resolveBatchCall = (
  apiName: string,
  args?: unknown,
  partialArgs?: unknown,
): { apiName: DingtalkWorkspaceBatchApiName; count: number } | undefined => {
  if (!isDingtalkWorkspaceBatchApiName(apiName)) return undefined;

  // Final args win; while they are still streaming, the partial ones already count.
  const count = batchItemCount(apiName, args) ?? batchItemCount(apiName, partialArgs);
  return count ? { apiName, count } : undefined;
};
