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
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import type { AgentReplySink } from '@/server/services/bot/AgentBridgeService';
import { sendDingTalkAttachments } from '@/server/services/bot/platforms/dingtalk/sendAttachments';

import type { DingTalkOutboundAttachment } from './attachments';
import { mapOutboundAttachments } from './attachments';
import { resolveDingTalkBrandingDisplayName } from './branding';
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

export const sendDingTalkMarkdown = async (threadId: string, text: string): Promise<void> => {
  if (!text) return;
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
  const api = new DingTalkApiClient(config.clientId, config.clientSecret);
  const { decoded, isGroup, session, staffId } = resolveSendTarget(threadId);
  const chunks = chunkMarkdown(text);
  for (const chunk of chunks) {
    const title = markdownTitle(chunk);
    const body =
      isGroup && staffId && !chunk.includes(`@${staffId}`) ? `@${staffId} ${chunk}` : chunk;
    try {
      if (isSessionWebhookLive(session) && session?.sessionWebhook) {
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
      if (isGroup) {
        await api.sendGroupMessage({
          msgKey: 'sampleMarkdown',
          msgParam,
          openConversationId: decoded.conversationId,
          robotCode: config.robotCode,
        });
      } else {
        await api.sendOtoMessage({
          msgKey: 'sampleMarkdown',
          msgParam,
          robotCode: config.robotCode,
          userIds: [staffId || decoded.conversationId],
        });
      }
    } catch (error) {
      log('sendDingTalkMarkdown failed: %O', error);
    }
  }
};

const sendActionCard = async (params: {
  buttons: DingTalkChoiceEntry[];
  text: string;
  threadId: string;
  title: string;
}): Promise<void> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return;
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
  try {
    if (isGroup) {
      await api.sendGroupMessage({
        msgKey: card.msgKey,
        msgParam: card.msgParam,
        openConversationId: decoded.conversationId,
        robotCode: config.robotCode,
      });
      return;
    }
    await api.sendOtoMessage({
      msgKey: card.msgKey,
      msgParam: card.msgParam,
      robotCode: config.robotCode,
      userIds: [staffId || decoded.conversationId],
    });
  } catch (error) {
    log('sendActionCard failed: %O', error);
    await sendDingTalkMarkdown(
      params.threadId,
      `${text}\n${params.buttons.map((b) => `• ${b.label}`).join('\n')}`,
    );
  }
};

export const sendDingTalkCommandCard = async (params: {
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
    if (sent) return;
  }

  await sendActionCard({
    buttons,
    text,
    threadId: params.threadId,
    title: params.title,
  });
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

  const fallbackToText = async (content?: string) => {
    mode = 'text';
    if (content) await sendDingTalkMarkdown(threadId, content);
  };

  const finalizeCard = async (content: string) => {
    if (finalized) return;
    finalized = true;
    if (mode !== 'card' || !stream) return;
    try {
      await stream.finalize(content);
    } catch (error) {
      log('finalizeCard failed, falling back to text: %O', error);
      await fallbackToText(content);
    }
  };

  const sink: AgentReplySink = {
    onComplete: async (content, extras) => {
      if (mode === 'card') {
        await finalizeCard(content);
      } else {
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
        await sendDingTalkMarkdown(threadId, DINGTALK_THINKING_REPLY);
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
