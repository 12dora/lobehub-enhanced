import {
  decodeDingTalkThreadId,
  DingTalkApiClient,
  getDingTalkCard,
  getDingTalkSession,
  isSessionWebhookLive,
} from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { DingTalkClientFactory } from '@/server/services/bot/platforms/dingtalk/client';

import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPickerAction,
  MessengerPlatformBinder,
  UnlinkedMessageContext,
} from '../../types';
import { resolveDingTalkBrandingDisplayName } from './branding';
import { sendDingTalkChoiceList } from './cards';
import { DINGTALK_MARKDOWN_TITLE_FALLBACK, formatDingTalkUnknownUserReply } from './const';

const log = debug('lobe-server:messenger:dingtalk');

const CALLBACK_PREFIX = 'messenger:';

const markdownTitle = (text: string): string => {
  const line = text.split('\n').find((item) => item.trim());
  if (!line) return DINGTALK_MARKDOWN_TITLE_FALLBACK;
  return line.replace(/^#+\s*/, '').slice(0, 32) || DINGTALK_MARKDOWN_TITLE_FALLBACK;
};

const resolveRobotTarget = (chatId: string) => {
  const session = getDingTalkSession(chatId) ?? getDingTalkSession(`dingtalk:${chatId}`);
  const decoded = decodeDingTalkThreadId(
    chatId.startsWith('dingtalk:') ? chatId : `dingtalk:${chatId}`,
  );
  const staffId = session?.senderStaffId || decoded.senderStaffId || chatId;
  return { decoded, session, staffId };
};

export class MessengerDingTalkBinder implements MessengerPlatformBinder {
  async createClient(): Promise<PlatformClient | null> {
    const config = await getMessengerDingTalkConfig();
    if (!config) return null;

    return new DingTalkClientFactory().createClient(
      {
        applicationId: config.clientId,
        credentials: { clientSecret: config.clientSecret },
        platform: 'dingtalk',
        settings: {
          aiCardTemplateId: config.aiCardTemplateId ?? undefined,
          robotCode: config.robotCode,
          selectCardTemplateId: config.selectCardTemplateId ?? undefined,
        },
      },
      { appUrl: appEnv.APP_URL },
    );
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    // Auto-link is the primary path (MessengerRouter). This is a safety net
    // if the router still falls through to the binder.
    try {
      const displayName = await resolveDingTalkBrandingDisplayName();
      await this.sendDmText(ctx.chatId, formatDingTalkUnknownUserReply(displayName));
    } catch (error) {
      log('handleUnlinkedMessage: failed: %O', error);
    }
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
    tenantId?: string;
  }): Promise<void> {
    const tail = params.activeAgentName
      ? `\n\n当前助手：${params.activeAgentName}`
      : '\n\n发送 /助手 可切换当前助手。';
    try {
      await this.sendDmText(params.platformUserId, `账号已关联。${tail}`);
    } catch (error) {
      log('notifyLinkSuccess: failed for %s: %O', params.platformUserId, error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = await getMessengerDingTalkConfig();
    if (!config) return;

    const api = new DingTalkApiClient(config.clientId, config.clientSecret);
    const { decoded, session, staffId } = resolveRobotTarget(chatId);

    try {
      if (isSessionWebhookLive(session) && session?.sessionWebhook) {
        const isGroup = Boolean(decoded.senderStaffId);
        const payload: Record<string, unknown> = {
          markdown: {
            text: isGroup && staffId ? `@${staffId} ${text}` : text,
            title: markdownTitle(text),
          },
          msgtype: 'markdown',
        };
        if (isGroup && staffId) payload.at = { atUserIds: [staffId] };
        await api.sendBySessionWebhook(session.sessionWebhook, payload);
        return;
      }

      const isGroup = Boolean(decoded.senderStaffId);
      if (isGroup) {
        const body = staffId ? `@${staffId} ${text}` : text;
        await api.sendGroupMessage({
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify({
            at: staffId ? { atUserIds: [staffId] } : undefined,
            text: body,
            title: markdownTitle(text),
          }),
          openConversationId: decoded.conversationId,
          robotCode: config.robotCode,
        });
        return;
      }

      await api.sendOtoMessage({
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content: text }),
        robotCode: config.robotCode,
        userIds: [staffId],
      });
    } catch (error) {
      log('sendDmText: failed to send to chat=%s: %O', chatId, error);
    }
  }

  async sendAgentPicker(
    chatId: string,
    params: { action?: MessengerPickerAction; entries: AgentPickerEntry[]; text: string },
  ): Promise<void> {
    const action = params.action ?? 'switch';
    const threadId = chatId.startsWith('dingtalk:') ? chatId : `dingtalk:${chatId}`;
    const { decoded } = resolveRobotTarget(chatId);
    const askerStaffId = decoded.senderStaffId || '';
    try {
      await sendDingTalkChoiceList({
        askerStaffId,
        entries: params.entries.map((entry) => ({
          command: `${CALLBACK_PREFIX}${action}:${entry.id}`,
          label: entry.isActive ? `${entry.title}（当前）` : entry.title,
        })),
        pageCommandPrefix: action === 'scope' ? 'messenger:scope:page:' : 'messenger:agents:page:',
        text: params.text,
        threadId,
        title: action === 'scope' ? '选择范围' : '选择助手',
      });
    } catch (error) {
      log('sendAgentPicker: failed for chat=%s: %O', chatId, error);
    }
  }

  async extractCallbackAction(req: Request): Promise<InboundCallbackAction | null> {
    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return null;
    }
    if (!body || typeof body !== 'object') return null;
    const payload = body as Record<string, unknown>;
    const outTrackId = typeof payload.outTrackId === 'string' ? payload.outTrackId : undefined;
    const userId = typeof payload.userId === 'string' ? payload.userId : undefined;
    const msgtype = typeof payload.msgtype === 'string' ? payload.msgtype : undefined;
    if (!outTrackId || !userId || msgtype) return null;
    const card = getDingTalkCard(outTrackId);
    if (!card) return null;
    if (card.askerStaffId && userId !== card.askerStaffId) {
      return {
        callbackId: outTrackId,
        chatId: card.threadId,
        data: 'messenger:not_asker',
        fromUserId: userId,
      };
    }
    return null;
  }

  async acknowledgeCallback(
    action: InboundCallbackAction,
    ack: CallbackAcknowledgement,
  ): Promise<void> {
    if (ack.updatedPicker) {
      await this.sendAgentPicker(action.chatId, {
        action: ack.updatedPicker.action,
        entries: ack.updatedPicker.entries,
        text: ack.updatedPicker.text,
      });
    }
    if (ack.toast) {
      await this.sendDmText(action.chatId, ack.toast);
    }
  }
}
