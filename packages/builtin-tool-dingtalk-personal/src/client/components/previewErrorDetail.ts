import { toReaderReason } from '@lobechat/builtin-tool-dingtalk-workspace/client/reasonText';

/**
 * 「参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：」 — the model's lead-in. The card's title already
 * says the arguments were refused; only what follows is news to the reader.
 */
const INVALID_PREFIX =
  /^\s*参数(?:无效|不正确)\s*(?:[(（]\s*[A-Z][\dA-Z_]{2,}\s*[)）]\s*)?(?:[.:。：]\s*|$)/;

const HAS_MEANING = /[\p{L}\p{N}]/u;

export const PREVIEW_ERROR_DETAIL_LIMIT = 200;

/** Where a transport may have put the service's `details`: the lambda error formatter nests it. */
const NESTED_KEYS = ['data', 'errorData', 'shape', 'cause', 'body', 'error'] as const;

const readDetailsMessage = (value: unknown, depth = 0): string | undefined => {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;

  const record = value as Record<string, unknown>;
  const details = record.details;
  if (details && typeof details === 'object') {
    const { message } = details as { message?: unknown };
    if (typeof message === 'string' && message.trim()) return message;
  }

  for (const key of NESTED_KEYS) {
    const nested = readDetailsMessage(record[key], depth + 1);
    if (nested) return nested;
  }

  return undefined;
};

/**
 * Why the service refused a write's arguments, for the confirm card: 「内容过大（约 80 KB），请分成
 * 多次写入…」, 「字段「预算」不在该数据表中」. Read from the tRPC error's
 * `data.errorData.details.message`, stripped of the 「参数无效（CODE）：」 lead-in, codes and
 * sentences meant for the model, and capped at {@link PREVIEW_ERROR_DETAIL_LIMIT} characters.
 * `undefined` when the error carries no such message — the card then shows the title alone.
 */
export const resolvePreviewErrorDetail = (error: unknown): string | undefined => {
  const raw = readDetailsMessage(error);
  if (!raw) return undefined;

  const text = toReaderReason(raw.replace(INVALID_PREFIX, ''));
  if (!text || !HAS_MEANING.test(text)) return undefined;

  return text.length > PREVIEW_ERROR_DETAIL_LIMIT
    ? `${text.slice(0, PREVIEW_ERROR_DETAIL_LIMIT - 1)}…`
    : text;
};
