import { convertGfmTablesForDingTalk } from '@lobechat/chat-adapter-dingtalk/markdownTables';

/** Shown when a tool-using turn ends with no real assistant text and nothing else was sent. */
export const DINGTALK_EMPTY_TURN_REPLY = '（本轮没有生成回复，请重试或换个说法）';

/** `...` / `…` / `。。。` and whitespace. A sentence that merely contains an ellipsis is kept. */
const ELLIPSIS_ONLY = /^[.\u2026。．]+$/;

/** Drop a partial that never meets its completion. Expiry is the backstop; error and waiting paths clear sooner. */
export const DINGTALK_DELIVERED_TEXT_TTL_MS = 30 * 60 * 1000;
export const DINGTALK_DELIVERED_TEXT_MAX_KEYS = 500;

interface DeliveredEntry {
  at: number;
  text: string;
}

const deliveredText = new Map<string, DeliveredEntry>();

const deliveredKey = (threadId: string, operationId?: string): string =>
  operationId ? `${threadId}\n${operationId}` : threadId;

const pruneDeliveredText = (now: number): void => {
  for (const [key, entry] of deliveredText) {
    if (now - entry.at >= DINGTALK_DELIVERED_TEXT_TTL_MS) deliveredText.delete(key);
  }
  if (deliveredText.size <= DINGTALK_DELIVERED_TEXT_MAX_KEYS) return;
  const oldest = [...deliveredText.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [key] of oldest) {
    if (deliveredText.size <= DINGTALK_DELIVERED_TEXT_MAX_KEYS) break;
    deliveredText.delete(key);
  }
};

export const clearDingTalkDeliveredTextForThread = (threadId: string): void => {
  if (!threadId) return;
  for (const key of deliveredText.keys()) {
    if (key === threadId || key.startsWith(`${threadId}\n`)) deliveredText.delete(key);
  }
};

export const isBlankDingTalkAssistantText = (text: string | null | undefined): boolean => {
  const compact = (text ?? '').replaceAll(/\s+/g, '');
  if (!compact) return true;
  return ELLIPSIS_ONLY.test(compact);
};

export const countDingTalkToolCalls = (...values: unknown[]): number => {
  let max = 0;
  for (const value of values) {
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > max) max = parsed;
  }
  return max;
};

/**
 * Text for the DingTalk bubble. Empty and ellipsis-only content is not sent.
 * After tool calls, a short Chinese line is sent only when this turn has not
 * already delivered another message (files, or a real streamed partial passed
 * in as `deliveredText` by the caller).
 */
export const resolveDingTalkOutboundText = (params: {
  content?: string | null;
  hadToolCalls: boolean;
  otherMessageSent: boolean;
}): string => {
  const raw = params.content ?? '';
  if (!isBlankDingTalkAssistantText(raw)) return raw;
  if (params.otherMessageSent) return '';
  if (params.hadToolCalls) return DINGTALK_EMPTY_TURN_REPLY;
  return '';
};

/** Non-blank partials are table-converted. Blank / `...` returns undefined so the card is not updated. */
export const renderDingTalkPartial = (text: string): string | undefined => {
  if (isBlankDingTalkAssistantText(text)) return undefined;
  return convertGfmTablesForDingTalk(text);
};

export const rememberDingTalkDeliveredText = (
  threadId: string,
  operationId: string | undefined,
  text: string,
  now = Date.now(),
): void => {
  pruneDeliveredText(now);
  const entry = { at: now, text };
  deliveredText.set(deliveredKey(threadId, operationId), entry);
  if (operationId) deliveredText.set(threadId, entry);
  pruneDeliveredText(now);
};

export const takeDingTalkDeliveredText = (
  threadId: string,
  operationId?: string,
  now = Date.now(),
): string => {
  pruneDeliveredText(now);
  const text =
    deliveredText.get(deliveredKey(threadId, operationId))?.text ??
    deliveredText.get(threadId)?.text ??
    '';
  clearDingTalkDeliveredTextForThread(threadId);
  return text;
};

export const clearDingTalkDeliveredText = (): void => {
  deliveredText.clear();
};

export const composeDingTalkFinalText = (params: {
  deliveredText?: string;
  firstReplyPrefix?: string;
  otherMessageSent?: boolean;
  rawContent?: string | null;
  toolCalls?: unknown;
  totalToolCalls?: unknown;
}): string => {
  const raw = params.rawContent ?? '';
  const assistant = isBlankDingTalkAssistantText(raw) ? '' : raw;
  const delivered = isBlankDingTalkAssistantText(params.deliveredText)
    ? ''
    : (params.deliveredText ?? '');
  const body = assistant || delivered;
  const combined = params.firstReplyPrefix ? `${params.firstReplyPrefix}\n\n${body}`.trim() : body;
  const text = resolveDingTalkOutboundText({
    content: combined,
    hadToolCalls: countDingTalkToolCalls(params.toolCalls, params.totalToolCalls) > 0,
    otherMessageSent: Boolean(params.otherMessageSent),
  });
  return convertGfmTablesForDingTalk(text);
};
