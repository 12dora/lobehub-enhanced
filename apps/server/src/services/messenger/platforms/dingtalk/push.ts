import { DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

import type { MessengerPushMessage, MessengerPushProvider, MessengerPushResult } from '../../push';
import { registerMessengerPushProvider } from '../../push';
import { resolveDingTalkIdentityEmailDomain } from './const';
import { incrementDingTalkDailyCounter } from './redis';

const log = debug('lobe-server:messenger:dingtalk:push');

const DEFAULT_ACTION_LABEL = '查看';

const toAbsoluteUrl = (actionUrl: string): string => {
  if (/^https?:\/\//i.test(actionUrl)) return actionUrl;
  const base = (appEnv.APP_URL || '').replace(/\/$/, '');
  if (!base) return actionUrl;
  return `${base}${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`;
};

const emailStaffId = (email: string | null | undefined): string | null => {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = email.slice(at + 1);
  const expected = resolveDingTalkIdentityEmailDomain();
  if (domain.toLowerCase() !== expected.toLowerCase()) return null;
  const local = email.slice(0, at).trim();
  return local.length > 0 ? local : null;
};

const resolveStaffId = async (db: LobeChatDatabase, userId: string): Promise<string | null> => {
  const link = await new MessengerAccountLinkModel(db, userId).findByPlatform('dingtalk', '');
  if (link?.platformUserId) return link.platformUserId;

  const user = await UserModel.findById(db, userId);
  return emailStaffId(user?.email ?? null);
};

class DingTalkMessengerPushProvider implements MessengerPushProvider {
  readonly platform = 'dingtalk' as const;

  async pushToUser(params: {
    db: LobeChatDatabase;
    message: MessengerPushMessage;
    userId: string;
  }): Promise<MessengerPushResult> {
    const config = await getMessengerDingTalkConfig();
    if (!config) return { reason: 'platform_disabled', status: 'skipped' };
    if (!config.pushEnabled) return { reason: 'push_disabled', status: 'skipped' };

    const staffId = await resolveStaffId(params.db, params.userId);
    if (!staffId) return { reason: 'user_not_mapped', status: 'skipped' };

    const api = new DingTalkApiClient(config.clientId, config.clientSecret);
    const { actionLabel, actionUrl, markdown, title } = params.message;

    try {
      if (actionUrl) {
        const absolute = toAbsoluteUrl(actionUrl);
        await api.sendOtoMessage({
          msgKey: 'sampleActionCard2',
          msgParam: JSON.stringify({
            actionTitle1: actionLabel || DEFAULT_ACTION_LABEL,
            actionURL1: absolute,
            text: markdown,
            title,
          }),
          robotCode: config.robotCode,
          userIds: [staffId],
        });
      } else {
        await api.sendOtoMessage({
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify({ text: markdown, title }),
          robotCode: config.robotCode,
          userIds: [staffId],
        });
      }
      await incrementDingTalkDailyCounter('pushes');
      return { status: 'sent' };
    } catch (error) {
      log('pushToUser failed user=%s: %O', params.userId, error);
      return { error: error instanceof Error ? error.message : String(error), status: 'failed' };
    }
  }
}

export const dingtalkMessengerPushProvider = new DingTalkMessengerPushProvider();

export const registerDingTalkMessengerPushProvider = (): void => {
  registerMessengerPushProvider(dingtalkMessengerPushProvider);
};

registerDingTalkMessengerPushProvider();
