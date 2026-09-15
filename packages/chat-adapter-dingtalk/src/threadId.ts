import type { DingTalkRobotMessage, DingTalkSessionContext, DingTalkThreadId } from './types';
import { CONVERSATION_TYPE_DM, CONVERSATION_TYPE_GROUP } from './types';

const THREAD_PREFIX = 'dingtalk';

/** Process-local session cache. Survives for the worker lifetime; empty after restart. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_MAX_ENTRIES = 4096;
const CARD_TTL_MS = 8 * 60 * 60 * 1000;
const CARD_MAX_ENTRIES = 4096;

interface Stored<T> {
  expiresAt: number;
  value: T;
}

const sessions = new Map<string, Stored<DingTalkSessionContext>>();
const cards = new Map<string, Stored<DingTalkCardMemory>>();

const pruneMap = <T>(map: Map<string, Stored<T>>, maxEntries: number, now: number): void => {
  for (const [key, entry] of map) {
    if (entry.expiresAt <= now) map.delete(key);
  }
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
};

const put = <T>(
  map: Map<string, Stored<T>>,
  key: string,
  value: T,
  expiresAt: number,
  maxEntries: number,
): void => {
  const now = Date.now();
  pruneMap(map, maxEntries, now);
  map.delete(key);
  map.set(key, { expiresAt, value });
  if (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
};

const getFresh = <T>(map: Map<string, Stored<T>>, key: string): T | undefined => {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
};

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
 * Decode a DingTalk thread id.
 *
 * The last colon-separated segment is treated as `senderStaffId` whenever a
 * colon is present. Group round-trips with colons in `conversationId` work
 * because the asker is always the final segment. A **DM** conversation id
 * that itself contains a colon would be decoded as a group — DingTalk `cid…`
 * ids usually have no colon, so this matches the live codec.
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
  const expiresAt = Math.max(Date.now() + SESSION_TTL_MS, session.sessionWebhookExpiredTime ?? 0);
  put(sessions, session.conversationId, session, expiresAt, SESSION_MAX_ENTRIES);
  const threadId = encodeDingTalkThreadId({
    conversationId: session.conversationId,
    senderStaffId:
      session.conversationType === CONVERSATION_TYPE_GROUP ? session.senderStaffId : undefined,
  });
  put(sessions, threadId, session, expiresAt, SESSION_MAX_ENTRIES);
}

export function getDingTalkSession(
  conversationIdOrThreadId: string,
): DingTalkSessionContext | undefined {
  const direct = getFresh(sessions, conversationIdOrThreadId);
  if (direct) return direct;

  const { conversationId } = decodeDingTalkThreadId(conversationIdOrThreadId);
  return getFresh(sessions, conversationId);
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

export interface DingTalkCardMemory {
  askerStaffId: string;
  conversationId: string;
  conversationType: string;
  threadId: string;
}

export interface RememberDingTalkCardInput {
  askerStaffId: string;
  conversationId: string;
  conversationType?: string;
  threadId?: string;
}

/**
 * Remember `outTrackId → { threadId, askerStaffId }` at card creation so
 * `/v1.0/card/instances/callback` taps can be turned into synthetic commands
 * on the original thread.
 */
export function rememberDingTalkCard(outTrackId: string, memory: RememberDingTalkCardInput): void {
  if (!outTrackId) return;
  if (!memory.conversationId.trim() || !memory.askerStaffId.trim()) return;
  const conversationType = memory.conversationType || CONVERSATION_TYPE_DM;
  const threadId =
    memory.threadId ??
    encodeDingTalkThreadId({
      conversationId: memory.conversationId,
      senderStaffId: conversationType === CONVERSATION_TYPE_GROUP ? memory.askerStaffId : undefined,
    });
  put(
    cards,
    outTrackId,
    {
      askerStaffId: memory.askerStaffId,
      conversationId: memory.conversationId,
      conversationType,
      threadId,
    },
    Date.now() + CARD_TTL_MS,
    CARD_MAX_ENTRIES,
  );
}

export function getDingTalkCard(outTrackId: string): DingTalkCardMemory | undefined {
  return getFresh(cards, outTrackId);
}

export function clearDingTalkCards(): void {
  cards.clear();
}
