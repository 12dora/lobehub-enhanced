import {
  buildActionCardParam,
  decodeDingTalkThreadId,
  DingTalkApiClient,
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
import { DINGTALK_UNKNOWN_USER_REPLY } from './const';

const log = debug('lobe-server:messenger:dingtalk');

const CALLBACK_PREFIX = 'messenger:';

const markdownTitle = (text: string): string => {
  const line = text.split('\n').find((item) => item.trim());
  if (!line) return 'Reply';
  return line.replace(/^#+\s*/, '').slice(0, 32) || 'Reply';
};

const resolveRobotTarget = (chatId: string) => {
  const session = getDingTalkSession(chatId) ?? getDingTalkSession(`dingtalk:${chatId}`);
  const decoded = decodeDingTalkThreadId(
    chatId.startsWith('dingtalk:') ? chatId : `dingtalk:${chatId}`,
  );
  const staffId = session?.senderStaffId || decoded.senderStaffId || chatId;
  return { session, staffId };
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
      await this.sendDmText(ctx.chatId, DINGTALK_UNKNOWN_USER_REPLY);
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
    const { session, staffId } = resolveRobotTarget(chatId);

    try {
      if (isSessionWebhookLive(session) && session?.sessionWebhook) {
        await api.sendBySessionWebhook(session.sessionWebhook, {
          markdown: { text, title: markdownTitle(text) },
          msgtype: 'markdown',
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
    const config = await getMessengerDingTalkConfig();
    if (!config) return;

    const action = params.action ?? 'switch';
    const buttons = params.entries.map((entry) => ({
      command: `${CALLBACK_PREFIX}${action}:${entry.id}`,
      label: entry.isActive ? `✓ ${entry.title}` : entry.title,
    }));
    const card = buildActionCardParam({
      buttons,
      text: params.text,
      title: action === 'scope' ? '选择范围' : '选择助手',
    });

    try {
      await this.sendRobotCard(
        chatId,
        config.clientId,
        config.clientSecret,
        config.robotCode,
        card,
      );
    } catch (error) {
      log('sendAgentPicker: failed for chat=%s: %O', chatId, error);
    }
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

  private async sendRobotCard(
    chatId: string,
    clientId: string,
    clientSecret: string,
    robotCode: string,
    card: { msgKey: string; msgParam: string },
  ): Promise<void> {
    const api = new DingTalkApiClient(clientId, clientSecret);
    const { session, staffId } = resolveRobotTarget(chatId);

    if (isSessionWebhookLive(session) && session?.sessionWebhook) {
      // sessionWebhook speaks native robot JSON, not msgKey. ActionCard
      // buttons stay on the oto API so dtmd URLs keep working.
    }

    await api.sendOtoMessage({
      msgKey: card.msgKey,
      msgParam: card.msgParam,
      robotCode,
      userIds: [staffId],
    });
  }
}
