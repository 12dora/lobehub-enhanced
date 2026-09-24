import {
  BATCH_SKIPPED_REASON,
  toBatchActionHref,
  toBatchActionLabel,
  toReaderReason,
} from '@lobechat/builtin-tool-dingtalk-workspace/client';

import type { BatchWriteState } from '../../types';
import type { DingtalkPersonalErrorCode } from '../components/errorCode';
import { DINGTALK_PERSONAL_ERROR_CODES } from '../components/errorCode';
import { asText } from './format';

/** One item of a batch write, ready to render. Ids stay React keys. */
export interface BatchWriteRow {
  /** https page where the failure is fixed (DingTalk permission page, authorization, settings). */
  actionHref?: string;
  actionLabel?: string;
  /** Cleaned reason: no codes, no sentences addressed to the model. */
  error?: string;
  /** Known stable code of the failure: the card shows its translated title instead of `error`. */
  errorCode?: DingtalkPersonalErrorCode;
  key: string;
  ok: boolean;
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

const KNOWN_CODES = new Set<string>(DINGTALK_PERSONAL_ERROR_CODES);

const asCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

const toErrorCode = (value: unknown): DingtalkPersonalErrorCode | undefined =>
  typeof value === 'string' && KNOWN_CODES.has(value)
    ? (value as DingtalkPersonalErrorCode)
    : undefined;

/** Why one item failed, plus where to fix it. A skipped item says 「未执行」 and nothing else. */
const toFailure = (
  record: Record<string, unknown>,
): Pick<BatchWriteRow, 'actionHref' | 'actionLabel' | 'error' | 'errorCode'> => {
  const error = toReaderReason(record.error);
  if (error === BATCH_SKIPPED_REASON) return { error };

  const actionHref = toBatchActionHref(record.actionUrl);
  const actionLabel = actionHref ? toBatchActionLabel(record.actionLabel) : undefined;
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
 * actually sees and fall back to the state's own numbers only without rows.
 */
export const toBatchWriteView = (state: BatchWriteState): BatchWriteView => {
  const items: unknown[] = Array.isArray(state.items) ? state.items : [];

  const rows = items.flatMap((item, index): BatchWriteRow[] => {
    if (!item || typeof item !== 'object') return [];

    const record = item as Record<string, unknown>;
    const done = record.ok === true;

    return [
      {
        ...(done ? {} : toFailure(record)),
        key: `${index}-${asText(record.id) ?? ''}`,
        ok: done,
        title: asText(record.title),
      },
    ];
  });

  const succeeded = rows.filter((row) => row.ok).length;

  return rows.length > 0
    ? {
        failed: rows.length - succeeded,
        rows,
        succeeded,
        summary: asText(state.summary),
        total: rows.length,
      }
    : {
        failed: asCount(state.failed) ?? 0,
        rows,
        succeeded: asCount(state.succeeded) ?? 0,
        summary: asText(state.summary),
        total: asCount(state.total) ?? 0,
      };
};
