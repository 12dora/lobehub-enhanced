import {
  BATCH_SKIPPED_REASON,
  toBatchActionHref,
  toBatchActionLabel,
  toReaderReason,
} from '@lobechat/builtin-tool-dingtalk-workspace/client';

import type { BatchWriteState } from '../../types';
import type { MaskIdentifiersOptions } from '../components/displayText';
import { maskIdentifiers } from '../components/displayText';
import type { DingtalkErrorCode } from '../components/previewError';
import { DINGTALK_ERROR_CODES } from '../components/previewError';

/** One item of a batch write, ready to render. Ids stay React keys. */
export interface BatchWriteRow {
  /** https page where the failure is fixed (permission apply, authorization, settings). */
  actionHref?: string;
  actionLabel?: string;
  /** Cleaned reason: no codes, no sentences addressed to the model. */
  error?: string;
  /** Known stable code of the failure: the card shows its translated title instead of `error`. */
  errorCode?: DingtalkErrorCode;
  key: string;
  ok: boolean;
  /** Undefined when the item carries no readable name: the card shows a neutral noun. */
  title?: string;
}

export interface BatchWriteView {
  failed: number;
  rows: BatchWriteRow[];
  succeeded: number;
  summary?: string;
  total: number;
}

export const isBatchWriteState = (value: unknown): value is BatchWriteState =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'batchWrite';

const KNOWN_CODES = new Set<string>(DINGTALK_ERROR_CODES);

const asCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

const toErrorCode = (value: unknown): DingtalkErrorCode | undefined =>
  typeof value === 'string' && KNOWN_CODES.has(value) ? (value as DingtalkErrorCode) : undefined;

/** Why one item failed, plus where to fix it. A skipped item says 「未执行」 and nothing else. */
const toFailure = (
  record: Record<string, unknown>,
  mask?: MaskIdentifiersOptions,
): Pick<BatchWriteRow, 'actionHref' | 'actionLabel' | 'error' | 'errorCode'> => {
  const error = maskIdentifiers(toReaderReason(record.error), mask);
  if (error === BATCH_SKIPPED_REASON) return { error };

  const actionHref = toBatchActionHref(record.actionUrl);
  const actionLabel = actionHref
    ? maskIdentifiers(toBatchActionLabel(record.actionLabel), mask)
    : undefined;
  const errorCode = toErrorCode(record.errorCode);

  return {
    ...(actionHref ? { actionHref } : {}),
    ...(actionLabel ? { actionLabel } : {}),
    ...(error ? { error } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
};

/**
 * The rows of a `batchWrite` state. History may hold anything, so a malformed item
 * is skipped rather than crashing the card; the counts follow the rows the user
 * actually sees and fall back to the state's own numbers only without rows. Titles
 * and reasons go through the same identifier mask as every other card.
 */
export const toBatchWriteView = (
  state: BatchWriteState,
  mask?: MaskIdentifiersOptions,
): BatchWriteView => {
  const items: unknown[] = Array.isArray(state.items) ? state.items : [];

  const rows = items.flatMap((item, index): BatchWriteRow[] => {
    if (!item || typeof item !== 'object') return [];

    const record = item as Record<string, unknown>;
    const done = record.ok === true;

    return [
      {
        ...(done ? {} : toFailure(record, mask)),
        key: `${index}-${typeof record.id === 'string' ? record.id : ''}`,
        ok: done,
        title: maskIdentifiers(record.title, mask),
      },
    ];
  });

  const succeeded = rows.filter((row) => row.ok).length;
  const summary = maskIdentifiers(state.summary, mask);

  return rows.length > 0
    ? { failed: rows.length - succeeded, rows, succeeded, summary, total: rows.length }
    : {
        failed: asCount(state.failed) ?? 0,
        rows,
        succeeded: asCount(state.succeeded) ?? 0,
        summary,
        total: asCount(state.total) ?? 0,
      };
};
