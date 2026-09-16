import { decodeDingTalkThreadId } from '@lobechat/chat-adapter-dingtalk';
import { LOADING_FLAT } from '@lobechat/const';
import type { ChatTopicBotContext, ChatTopicMetadata } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { sendDingTalkMarkdown } from './cards';
import { isDingTalkThreadBusy } from './queue';
import { resolveDingTalkStaffId } from './resolveStaffId';

const log = debug('lobe-server:messenger:dingtalk:mirror');

const USER_QUOTE_MAX_CHARS = 500;
const MIRROR_LOCK_TTL_SECONDS = 30;

export interface MirrorWebTurnToDingTalkParams {
  assistantMessage?: string;
  assistantMessageId?: string;
  botContext?: ChatTopicBotContext | null;
  db: LobeChatDatabase;
  topicId: string;
  userId: string;
  userMessage?: string;
  userMessageId?: string;
  userMessageTrigger?: string;
  workspaceId?: string;
}

const isDingTalkOrigin = (metadata: ChatTopicMetadata | null | undefined): boolean =>
  metadata?.bot?.platform === 'dingtalk' || metadata?.messenger?.platform === 'dingtalk';

const collapseToOneParagraph = (text: string): string => text.replaceAll(/\s+/g, ' ').trim();

const quoteUserQuestion = (text: string): string => {
  const paragraph = collapseToOneParagraph(text);
  if (!paragraph) return '';
  return paragraph.length <= USER_QUOTE_MAX_CHARS
    ? paragraph
    : paragraph.slice(0, USER_QUOTE_MAX_CHARS);
};

const buildMirrorBody = (userText: string, assistantText: string): string => {
  const quoted = quoteUserQuestion(userText);
  const parts = ['**网页续聊**', ''];
  if (quoted) {
    parts.push(`> ${quoted}`, '');
  }
  if (assistantText) parts.push(assistantText);
  return parts.join('\n').trimEnd();
};

const triggerFromMessage = (message: unknown): string | undefined => {
  if (!isRecord(message)) return undefined;
  const metadata = isRecord(message.metadata) ? message.metadata : undefined;
  return typeof metadata?.trigger === 'string' ? metadata.trigger : undefined;
};

const isBotTrigger = (trigger: string | undefined): boolean =>
  trigger === RequestTrigger.Bot || trigger === 'bot';

const isUsableMirrorText = (text: string | undefined): text is string => {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 && trimmed !== LOADING_FLAT;
};

/** Prefer DB text when it is non-empty and not the streaming placeholder; else caller text. */
const resolveMirrorText = (dbText: string | undefined, callerText: string | undefined): string => {
  if (isUsableMirrorText(dbText)) return dbText;
  if (isUsableMirrorText(callerText)) return callerText;
  return '';
};

const mirrorLockKey = (threadId: string): string => `messenger:dingtalk:mirror:${threadId}`;

/** In-process NX fallback when Redis is unset. */
const memoryMirrorLocks = new Map<string, number>();

const tryAcquireMirrorLock = async (threadId: string): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const result = await redis.set(
        mirrorLockKey(threadId),
        '1',
        'EX',
        MIRROR_LOCK_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      log('mirror lock redis set failed threadId=%s: %O', threadId, error);
      // Don't drop the mirror because Redis blipped.
      return true;
    }
  }

  const now = Date.now();
  const expiresAt = memoryMirrorLocks.get(threadId);
  if (expiresAt !== undefined && expiresAt > now) return false;
  memoryMirrorLocks.set(threadId, now + MIRROR_LOCK_TTL_SECONDS * 1000);
  return true;
};

const releaseMirrorLock = async (threadId: string): Promise<void> => {
  memoryMirrorLocks.delete(threadId);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(mirrorLockKey(threadId));
  } catch (error) {
    log('mirror lock redis del failed threadId=%s: %O', threadId, error);
  }
};

/**
 * Mirror a web continuation of a DingTalk-originated 1:1 topic back into
 * the original robot chat. Fire-and-forget friendly: errors are logged and
 * never thrown. Does not move the DingTalk thread's current-topic pointer
 * and does not touch the inbound reply sink.
 */
export const mirrorWebTurnToDingTalk = async (
  params: MirrorWebTurnToDingTalkParams,
): Promise<void> => {
  try {
    if (params.botContext?.platform === 'dingtalk') {
      log('skip inbound loop (botContext.platform=dingtalk) topicId=%s', params.topicId);
      return;
    }
    if (isBotTrigger(params.userMessageTrigger)) {
      log('skip inbound loop (userMessageTrigger=bot) topicId=%s', params.topicId);
      return;
    }

    const config = await getMessengerDingTalkConfig();
    if (!config?.chatEnabled) {
      log('skip: connector missing or chatEnabled=false');
      return;
    }

    const topic = await new TopicModel(params.db, params.userId, params.workspaceId).findById(
      params.topicId,
    );
    const metadata = (topic?.metadata ?? null) as ChatTopicMetadata | null;
    if (!isDingTalkOrigin(metadata)) {
      log('skip: topic is not DingTalk-originated topicId=%s', params.topicId);
      return;
    }

    const threadId = metadata?.bot?.platformThreadId;
    if (!threadId) {
      log('skip: missing platformThreadId topicId=%s', params.topicId);
      return;
    }

    const decoded = decodeDingTalkThreadId(threadId);
    const isGroup =
      metadata?.messenger?.conversationType === 'group' || Boolean(decoded.senderStaffId);
    if (isGroup) {
      log('skip group topic topicId=%s threadId=%s', params.topicId, threadId);
      return;
    }

    let userText = resolveMirrorText(undefined, params.userMessage);
    let assistantText = resolveMirrorText(undefined, params.assistantMessage);

    if (params.userMessageId || params.assistantMessageId) {
      const { extractTextFromMessage } =
        await import('@/server/services/agentRuntime/CompletionLifecycle');
      const messageModel = new MessageModel(params.db, params.userId, params.workspaceId);
      if (params.userMessageId) {
        const row = await messageModel.findById(params.userMessageId);
        const rowTrigger = triggerFromMessage(row);
        if (isBotTrigger(rowTrigger)) {
          log('skip inbound loop (message.trigger=bot) topicId=%s', params.topicId);
          return;
        }
        userText = resolveMirrorText(extractTextFromMessage(row), params.userMessage);
      }
      if (params.assistantMessageId) {
        const row = await messageModel.findById(params.assistantMessageId);
        assistantText = resolveMirrorText(extractTextFromMessage(row), params.assistantMessage);
      }
    }

    if (!isUsableMirrorText(userText) && !isUsableMirrorText(assistantText)) {
      log('skip: empty user and assistant texts topicId=%s', params.topicId);
      return;
    }

    const staffId =
      metadata?.bot?.senderExternalUserId ||
      (await resolveDingTalkStaffId(params.db, params.userId));
    if (!staffId) {
      log('skip: no staffId topicId=%s threadId=%s', params.topicId, threadId);
      return;
    }

    if (await isDingTalkThreadBusy(threadId)) {
      log('skip: thread busy topicId=%s threadId=%s', params.topicId, threadId);
      return;
    }

    if (!(await tryAcquireMirrorLock(threadId))) {
      log('skip: mirror lock held topicId=%s threadId=%s', params.topicId, threadId);
      return;
    }

    try {
      const body = buildMirrorBody(userText, assistantText);
      await sendDingTalkMarkdown(threadId, body, {
        beforeChunk: async () => !(await isDingTalkThreadBusy(threadId)),
        staffId,
      });
    } finally {
      await releaseMirrorLock(threadId);
    }
  } catch (error) {
    log('mirrorWebTurnToDingTalk failed topicId=%s: %O', params.topicId, error);
  }
};
