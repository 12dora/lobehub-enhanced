import {
  buildActionCardParam,
  chunkMarkdown,
  decodeDingTalkThreadId,
  DingTalkAiCardStream,
  DingTalkApiClient,
  DingTalkCardUnavailableError,
  getDingTalkSession,
  isSessionWebhookLive,
  rememberDingTalkCard,
} from '@lobechat/chat-adapter-dingtalk';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import type { AgentReplySink } from '@/server/services/bot/AgentBridgeService';
import { sendDingTalkAttachments } from '@/server/services/bot/platforms/dingtalk/sendAttachments';

import type { DingTalkOutboundAttachment } from './attachments';
import { mapOutboundAttachments } from './attachments';
import { resolveDingTalkBrandingDisplayName } from './branding';
import type { DingTalkLastListKind } from './const';
import {
  DINGTALK_COMMAND_CARD_TEXT,
  DINGTALK_COMMAND_CARD_TITLE,
  DINGTALK_COMMAND_SHORTCUT_BUTTONS,
  DINGTALK_HELP_TEXT,
  DINGTALK_LIST_PAGE_SIZE,
  DINGTALK_MARKDOWN_TITLE_FALLBACK,
  DINGTALK_THINKING_REPLY,
  DINGTALK_UNKNOWN_COMMAND_REPLY,
  DINGTALK_WELCOME_TEXT,
  formatDingTalkWelcomeTitle,
} from './const';
import { setDingTalkLastList } from './redis';

const log = debug('lobe-server:messenger:dingtalk:cards');

const liveSinks = new Map<string, AgentReplySink>();

export const getDingTalkReplySink = (threadId: string): AgentReplySink | undefined =>
  liveSinks.get(threadId);

export const clearDingTalkReplySink = (threadId: string): void => {
  liveSinks.delete(threadId);
};

export interface DingTalkChoiceEntry {
  command: string;
  label: string;
}

const markdownTitle = (text: string): string => {
  const line = text.split('\n').find((item) => item.trim());
  if (!line) return DINGTALK_MARKDOWN_TITLE_FALLBACK;
  return line.replace(/^#+\s*/, '').slice(0, 32) || DINGTALK_MARKDOWN_TITLE_FALLBACK;
};

const attachGroupAtUserIds = (msgParam: string, staffId: string): string => {
  try {
    const parsed: unknown = JSON.parse(msgParam);
    if (!isRecord(parsed)) return msgParam;
    return JSON.stringify({ ...parsed, at: { atUserIds: [staffId] } });
  } catch {
    return msgParam;
  }
};

export const wrapDingTalkAskerCommand = (
  command: string,
  askerStaffId: string,
  isGroup: boolean,
): string => {
  if (!isGroup || !askerStaffId) return command;
  const rest = command.startsWith('messenger:') ? command.slice('messenger:'.length) : command;
  return `messenger:asker:${askerStaffId}:${rest}`;
};

export const parseDingTalkAskerCommand = (
  text: string,
): { askerStaffId?: string; command: string } => {
  const trimmed = text.trim();
  const match = trimmed.match(/^messenger:asker:([^:]+):([\s\S]+)$/);
  if (match) {
    const rest = match[2];
    return {
      askerStaffId: match[1],
      command: rest.startsWith('messenger:') ? rest : `messenger:${rest}`,
    };
  }
  return { command: trimmed };
};

const resolveSendTarget = (threadId: string) => {
  const decoded = decodeDingTalkThreadId(threadId);
  const session = getDingTalkSession(threadId) ?? getDingTalkSession(decoded.conversationId);
  const isGroup = Boolean(decoded.senderStaffId);
  const staffId = decoded.senderStaffId || session?.senderStaffId || '';
  return { decoded, isGroup, session, staffId };
};

const recallDingTalkMessage = async (
  api: DingTalkApiClient,
  params: {
    isGroup: boolean;
    openConversationId: string;
    processQueryKey: string | undefined;
    robotCode: string;
  },
): Promise<void> => {
  if (!params.processQueryKey) return;
  try {
    await api.recallMessage({
      openConversationId: params.isGroup ? params.openConversationId : undefined,
      processQueryKeys: [params.processQueryKey],
      robotCode: params.robotCode,
    });
  } catch (error) {
    log('recallDingTalkMessage failed: %O', error);
  }
};

export const sendDingTalkMarkdown = async (
  threadId: string,
  text: string,
  options?: { recallable?: boolean },
): Promise<string | undefined> => {
  if (!text) return;
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
  const { decoded, isGroup, session, staffId } = resolveSendTarget(threadId);
  const chunks = chunkMarkdown(text);
  let processQueryKey: string | undefined;
  for (const chunk of chunks) {
    const title = markdownTitle(chunk);
    const body =
      isGroup && staffId && !chunk.includes(`@${staffId}`) ? `@${staffId} ${chunk}` : chunk;
    try {
      // Session webhooks do not return `processQueryKey`, so skip them when
      // the caller needs to recall this message later (thinking placeholder).
      if (!options?.recallable && isSessionWebhookLive(session) && session?.sessionWebhook) {
        const payload: Record<string, unknown> = {
          markdown: { text: body, title },
          msgtype: 'markdown',
        };
        if (isGroup && staffId) payload.at = { atUserIds: [staffId] };
        await api.sendBySessionWebhook(session.sessionWebhook, payload);
        continue;
      }
      const msgParamObj: Record<string, unknown> = { text: body, title };
      if (isGroup && staffId) msgParamObj.at = { atUserIds: [staffId] };
      const msgParam = JSON.stringify(msgParamObj);
      const sent = isGroup
        ? await api.sendGroupMessage({
            msgKey: 'sampleMarkdown',
            msgParam,
            openConversationId: decoded.conversationId,
            robotCode: config.robotCode,
          })
        : await api.sendOtoMessage({
            msgKey: 'sampleMarkdown',
            msgParam,
            robotCode: config.robotCode,
            userIds: [staffId || decoded.conversationId],
          });
      if (sent.processQueryKey) processQueryKey = sent.processQueryKey;
    } catch (error) {
      log('sendDingTalkMarkdown failed: %O', error);
    }
  }
  return processQueryKey;
};

const lastListKindFromPagePrefix = (
  pageCommandPrefix: string | undefined,
): DingTalkLastListKind | null => {
  if (pageCommandPrefix === 'messenger:agents:page:') return 'agents';
  if (pageCommandPrefix === 'messenger:topics:page:') return 'topics';
  if (pageCommandPrefix === 'messenger:question:page:') return 'question';
  return null;
};

const rememberDingTalkChoiceList = async (
  threadId: string,
  pageCommandPrefix: string | undefined,
): Promise<void> => {
  const kind = lastListKindFromPagePrefix(pageCommandPrefix);
  if (!kind) return;
  await setDingTalkLastList(threadId, kind);
};

const sendActionCard = async (params: {
  buttons: DingTalkChoiceEntry[];
  text: string;
  threadId: string;
  title: string;
}): Promise<boolean> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return false;
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
  const { staffId, decoded, isGroup } = resolveSendTarget(params.threadId);
  const text =
    isGroup && staffId && !params.text.includes(`@${staffId}`)
      ? `@${staffId} ${params.text}`
      : params.text;
  const card = buildActionCardParam({
    buttons: params.buttons.slice(0, 5),
    text,
    title: params.title,
  });
  const msgParam =
    isGroup && staffId ? attachGroupAtUserIds(card.msgParam, staffId) : card.msgParam;
  try {
    if (isGroup) {
      await api.sendGroupMessage({
        msgKey: card.msgKey,
        msgParam,
        openConversationId: decoded.conversationId,
        robotCode: config.robotCode,
      });
      return true;
    }
    await api.sendOtoMessage({
      msgKey: card.msgKey,
      msgParam,
      robotCode: config.robotCode,
      userIds: [staffId || decoded.conversationId],
    });
    return true;
  } catch (error) {
    log('sendActionCard failed: %O', error);
    await sendDingTalkMarkdown(
      params.threadId,
      `${text}\n${params.buttons.map((b) => `• ${b.label}`).join('\n')}`,
    );
    return true;
  }
};

const sendDingTalkCommandCard = async (params: {
  text: string;
  threadId: string;
  title: string;
}): Promise<void> => {
  await sendActionCard({
    buttons: DINGTALK_COMMAND_SHORTCUT_BUTTONS,
    text: params.text,
    threadId: params.threadId,
    title: params.title,
  });
};

export const sendDingTalkWelcomeCard = async (threadId: string): Promise<void> => {
  const displayName = await resolveDingTalkBrandingDisplayName();
  await sendDingTalkCommandCard({
    text: DINGTALK_WELCOME_TEXT,
    threadId,
    title: formatDingTalkWelcomeTitle(displayName),
  });
};

export const sendDingTalkHelpReply = async (threadId: string): Promise<void> => {
  await sendDingTalkMarkdown(threadId, DINGTALK_HELP_TEXT);
  await sendDingTalkCommandCard({
    text: DINGTALK_COMMAND_CARD_TEXT,
    threadId,
    title: DINGTALK_COMMAND_CARD_TITLE,
  });
};

export const sendDingTalkUnknownCommandReply = async (threadId: string): Promise<void> => {
  await sendDingTalkMarkdown(threadId, DINGTALK_UNKNOWN_COMMAND_REPLY);
  await sendDingTalkCommandCard({
    text: DINGTALK_COMMAND_CARD_TEXT,
    threadId,
    title: DINGTALK_COMMAND_CARD_TITLE,
  });
};

const sendSelectCard = async (params: {
  askerStaffId: string;
  buttons: DingTalkChoiceEntry[];
  templateId: string;
  text: string;
  threadId: string;
  title: string;
}): Promise<boolean> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return false;
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
  const { decoded, isGroup, staffId } = resolveSendTarget(params.threadId);
  const outTrackId = `select-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await api.createAndDeliverCard({
      cardData: {
        cardParamMap: {
          content: `${params.text}\n${params.buttons.map((b, i) => `${i + 1}. ${b.label}`).join('\n')}`,
          options: JSON.stringify(
            params.buttons.map((b) => ({ label: b.label, value: b.command })),
          ),
          title: params.title,
        },
      },
      cardTemplateId: params.templateId,
      openConversationId: isGroup ? decoded.conversationId : undefined,
      outTrackId,
      robotCode: config.robotCode,
      staffId: staffId || params.askerStaffId,
    });
    rememberDingTalkCard(outTrackId, {
      askerStaffId: params.askerStaffId || staffId,
      conversationId: decoded.conversationId,
      conversationType: isGroup ? '2' : '1',
      threadId: params.threadId,
    });
    return true;
  } catch (error) {
    log('sendSelectCard failed, falling back to ActionCard: %O', error);
    return false;
  }
};

export const paginateEntries = <T>(
  entries: T[],
  page: number,
  pageSize = DINGTALK_LIST_PAGE_SIZE,
) => {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = (current - 1) * pageSize;
  return {
    current,
    items: entries.slice(start, start + pageSize),
    totalPages,
  };
};

export const sendDingTalkChoiceList = async (params: {
  askerStaffId: string;
  entries: DingTalkChoiceEntry[];
  page?: number;
  pageCommandPrefix?: string;
  text: string;
  threadId: string;
  title: string;
}): Promise<void> => {
  const isGroup = Boolean(decodeDingTalkThreadId(params.threadId).senderStaffId);
  const page = params.page ?? 1;
  const paged = paginateEntries(params.entries, page);
  const buttons: DingTalkChoiceEntry[] = paged.items.map((entry) => ({
    command: wrapDingTalkAskerCommand(entry.command, params.askerStaffId, isGroup),
    label: entry.label,
  }));
  if (paged.totalPages > 1 && paged.current < paged.totalPages && params.pageCommandPrefix) {
    const nextCommand = `${params.pageCommandPrefix}${paged.current + 1}`;
    buttons.push({
      command: wrapDingTalkAskerCommand(nextCommand, params.askerStaffId, isGroup),
      label: '下一页',
    });
  }

  const text =
    paged.totalPages > 1 ? `${params.text}\n(${paged.current}/${paged.totalPages})` : params.text;

  const config = await getMessengerDingTalkConfig();
  if (config?.selectCardTemplateId) {
    const sent = await sendSelectCard({
      askerStaffId: params.askerStaffId,
      buttons,
      templateId: config.selectCardTemplateId,
      text,
      threadId: params.threadId,
      title: params.title,
    });
    if (sent) {
      await rememberDingTalkChoiceList(params.threadId, params.pageCommandPrefix);
      return;
    }
  }

  const actionSent = await sendActionCard({
    buttons,
    text,
    threadId: params.threadId,
    title: params.title,
  });
  if (actionSent) {
    await rememberDingTalkChoiceList(params.threadId, params.pageCommandPrefix);
  }
};

const sendOutboundAttachments = async (
  threadId: string,
  attachments: DingTalkOutboundAttachment[] | undefined,
): Promise<void> => {
  const outbound = mapOutboundAttachments(attachments);
  if (!outbound.length) return;
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
  const { decoded, isGroup, session, staffId } = resolveSendTarget(threadId);
  try {
    await sendDingTalkAttachments(
      api,
      {
        openConversationId: isGroup ? decoded.conversationId : undefined,
        robotCode: config.robotCode,
        sessionWebhook: isSessionWebhookLive(session) ? session?.sessionWebhook : undefined,
        userIds: !isGroup && staffId ? [staffId] : undefined,
      },
      outbound,
    );
  } catch (error) {
    log('sendOutboundAttachments failed: %O', error);
  }
};

export const createDingTalkReplySink = async (
  threadId: string,
): Promise<AgentReplySink | undefined> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return undefined;

  const { decoded, isGroup, staffId } = resolveSendTarget(threadId);
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
  let mode: 'card' | 'text' = config.aiCardTemplateId ? 'card' : 'text';
  let stream: DingTalkAiCardStream | undefined;
  let finalized = false;
  let thinkingProcessQueryKey: string | undefined;

  const recallThinking = async () => {
    const key = thinkingProcessQueryKey;
    thinkingProcessQueryKey = undefined;
    await recallDingTalkMessage(api, {
      isGroup,
      openConversationId: decoded.conversationId,
      processQueryKey: key,
      robotCode: config.robotCode,
    });
  };

  const sendThinkingPlaceholder = async () => {
    thinkingProcessQueryKey = await sendDingTalkMarkdown(threadId, DINGTALK_THINKING_REPLY, {
      recallable: true,
    });
  };

  const fallbackToText = async (content?: string) => {
    mode = 'text';
    if (content === DINGTALK_THINKING_REPLY) {
      await sendThinkingPlaceholder();
      return;
    }
    if (content) await sendDingTalkMarkdown(threadId, content);
  };

  const finalizeCard = async (content: string) => {
    if (finalized) return;
    finalized = true;
    if (!stream) return;
    try {
      // Replace first so the card body is the answer even if DingTalk's
      // streaming-finish call only flips the streaming flag.
      await stream.replace(content);
      await stream.finalize(content);
    } catch (error) {
      log('finalizeCard failed, falling back to text: %O', error);
      mode = 'text';
      await sendDingTalkMarkdown(threadId, content);
    }
  };

  const sink: AgentReplySink = {
    onComplete: async (content, extras) => {
      if (mode === 'card') {
        await finalizeCard(content);
      } else {
        await recallThinking();
        await sendDingTalkMarkdown(threadId, content);
      }
      if (extras?.attachments?.length) {
        await sendOutboundAttachments(threadId, extras.attachments);
      }
    },
    onError: async (errorText) => {
      const text = errorText || '执行失败';
      if (mode === 'card') {
        await finalizeCard(text);
        return;
      }
      await recallThinking();
      await sendDingTalkMarkdown(threadId, text);
    },
    onPartial: async (content) => {
      if (mode !== 'card' || !stream || finalized) return;
      try {
        await stream.replace(content);
      } catch (error) {
        if (error instanceof DingTalkCardUnavailableError) {
          await fallbackToText();
          return;
        }
        log('onPartial failed: %O', error);
      }
    },
    onStart: async () => {
      if (mode !== 'card' || !config.aiCardTemplateId) {
        mode = 'text';
        await sendThinkingPlaceholder();
        return;
      }
      stream = new DingTalkAiCardStream(api, {
        cardTemplateId: config.aiCardTemplateId,
        conversationId: decoded.conversationId,
        openConversationId: isGroup ? decoded.conversationId : undefined,
        robotCode: config.robotCode,
        staffId: staffId || undefined,
      });
      try {
        await stream.create(DINGTALK_THINKING_REPLY);
      } catch (error) {
        log('AI card create failed, falling back to text: %O', error);
        await fallbackToText(DINGTALK_THINKING_REPLY);
      }
    },
  };
  liveSinks.set(threadId, sink);
  return sink;
};
