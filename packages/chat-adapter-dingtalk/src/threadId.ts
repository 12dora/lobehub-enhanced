import type { DingTalkRobotMessage, DingTalkSessionContext, DingTalkThreadId } from './types';
import { CONVERSATION_TYPE_DM, CONVERSATION_TYPE_GROUP } from './types';

const THREAD_PREFIX = 'dingtalk';

const sessions = new Map<string, DingTalkSessionContext>();

/**
 * Encode a DingTalk thread id.
 *
 *   - DM:    `dingtalk:<conversationId>`
 *   - group: `dingtalk:<conversationId>:<senderStaffId>`
 *
 * Group sessions are per (conversation, asker) so two people talking to the
 * bot in the same group do not share a topic.
 */
export function encodeDingTalkThreadId(data: DingTalkThreadId): string {
  if (data.senderStaffId) {
    return `${THREAD_PREFIX}:${data.conversationId}:${data.senderStaffId}`;
  }
  return `${THREAD_PREFIX}:${data.conversationId}`;
}

/**
 * Decode a DingTalk thread id. Conversation ids that themselves contain
 * colons stay intact: the last segment is only treated as `senderStaffId`
 * when a third (or later) segment is present.
 */
export function decodeDingTalkThreadId(threadId: string): DingTalkThreadId {
  if (!threadId) return { conversationId: '' };

  const withoutPrefix = threadId.startsWith(`${THREAD_PREFIX}:`)
    ? threadId.slice(THREAD_PREFIX.length + 1)
    : threadId;

  const lastColon = withoutPrefix.lastIndexOf(':');
  if (lastColon === -1) {
    return { conversationId: withoutPrefix };
  }

  return {
    conversationId: withoutPrefix.slice(0, lastColon),
    senderStaffId: withoutPrefix.slice(lastColon + 1),
  };
}

export function isDingTalkDmThread(threadId: string): boolean {
  return decodeDingTalkThreadId(threadId).senderStaffId === undefined;
}

export function threadIdFromRobotMessage(payload: DingTalkRobotMessage): string {
  const isGroup = payload.conversationType === CONVERSATION_TYPE_GROUP;
  return encodeDingTalkThreadId({
    conversationId: payload.conversationId,
    senderStaffId: isGroup ? payload.senderStaffId : undefined,
  });
}

export function rememberDingTalkSession(session: DingTalkSessionContext): void {
  sessions.set(session.conversationId, session);
  const threadId = encodeDingTalkThreadId({
    conversationId: session.conversationId,
    senderStaffId:
      session.conversationType === CONVERSATION_TYPE_GROUP ? session.senderStaffId : undefined,
  });
  sessions.set(threadId, session);
}

export function getDingTalkSession(
  conversationIdOrThreadId: string,
): DingTalkSessionContext | undefined {
  const direct = sessions.get(conversationIdOrThreadId);
  if (direct) return direct;

  const { conversationId } = decodeDingTalkThreadId(conversationIdOrThreadId);
  return sessions.get(conversationId);
}

export function sessionFromRobotMessage(payload: DingTalkRobotMessage): DingTalkSessionContext {
  return {
    conversationId: payload.conversationId,
    conversationType: payload.conversationType || CONVERSATION_TYPE_DM,
    robotCode: payload.robotCode,
    senderNick: payload.senderNick,
    senderStaffId: payload.senderStaffId || '',
    sessionWebhook: payload.sessionWebhook,
    sessionWebhookExpiredTime: payload.sessionWebhookExpiredTime,
  };
}

export function isSessionWebhookLive(session?: DingTalkSessionContext): boolean {
  if (!session?.sessionWebhook) return false;
  if (!session.sessionWebhookExpiredTime) return true;
  return Date.now() < session.sessionWebhookExpiredTime;
}

export function clearDingTalkSessions(): void {
  sessions.clear();
}
