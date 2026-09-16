import { decodeDingTalkThreadId } from '@lobechat/chat-adapter-dingtalk';
import type { ChatTopicBotContext, ChatTopicMetadata } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

import { sendDingTalkMarkdown } from './cards';
import { isDingTalkThreadBusy } from './queue';
import { resolveDingTalkStaffId } from './resolveStaffId';

const log = debug('lobe-server:messenger:dingtalk:mirror');

const USER_QUOTE_MAX_CHARS = 500;

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
    if (params.userMessageTrigger === RequestTrigger.Bot || params.userMessageTrigger === 'bot') {
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

    let userText = params.userMessage ?? '';
    let assistantText = params.assistantMessage ?? '';

    if (params.userMessageId || params.assistantMessageId) {
      const { extractTextFromMessage } =
        await import('@/server/services/agentRuntime/CompletionLifecycle');
      const messageModel = new MessageModel(params.db, params.userId, params.workspaceId);
      if (params.userMessageId) {
        const row = await messageModel.findById(params.userMessageId);
        userText = extractTextFromMessage(row) ?? '';
        const rowTrigger = triggerFromMessage(row);
        if (rowTrigger === RequestTrigger.Bot || rowTrigger === 'bot') {
          log('skip inbound loop (message.trigger=bot) topicId=%s', params.topicId);
          return;
        }
      }
      if (params.assistantMessageId) {
        const row = await messageModel.findById(params.assistantMessageId);
        assistantText = extractTextFromMessage(row) ?? '';
      }
    }

    if (!userText.trim() && !assistantText.trim()) {
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

    const body = buildMirrorBody(userText, assistantText);
    await sendDingTalkMarkdown(threadId, body, { staffId });
  } catch (error) {
    log('mirrorWebTurnToDingTalk failed topicId=%s: %O', params.topicId, error);
  }
};
