import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:messenger:push');

/**
 * Proactive (non-reply) message delivery to a user's linked IM account.
 *
 * Consumers (task reminders via `TaskNotificationService`) call `MessengerPushService.pushToUser`;
 * platform owners register a `MessengerPushProvider` (DingTalk registers itself from
 * `services/messenger/platforms/dingtalk`). Keeping the registry here means the notification
 * dispatcher compiles and degrades gracefully (`skipped: platform_unavailable`) before a
 * platform is wired in.
 */

export type MessengerPushPlatform = 'dingtalk';

export interface MessengerPushMessage {
  /** Label for `actionUrl`; the provider uses its own default when omitted. */
  actionLabel?: string;
  /** Absolute or app-relative URL ("/task/<id>") rendered as the primary action. */
  actionUrl?: string;
  /** Markdown body (provider converts to its dialect; DingTalk = sampleMarkdown / ActionCard). */
  markdown: string;
  /** Short title (notification headline / card title). */
  title: string;
}

export type MessengerPushSkipReason =
  | 'platform_unavailable'
  | 'platform_disabled'
  | 'push_disabled'
  | 'channel_disabled'
  | 'user_not_mapped';

export type MessengerPushResult =
  | { providerMessageId?: string; status: 'sent' }
  | { reason: MessengerPushSkipReason; status: 'skipped' }
  | { error: string; status: 'failed' };

export interface MessengerPushProvider {
  readonly platform: MessengerPushPlatform;
  /**
   * Deliver one message to one AIHub user. Must resolve the platform identity itself
   * (DingTalk: `messenger_account_links` row, else the `<staffId>@dingtalk.jiefakj.com` email
   * convention), honour the connector's `enabled` / `pushEnabled` flags, increment the daily
   * `messenger:<platform>:counter:pushes:<YYYY-MM-DD>` Redis counter on success, and never throw.
   */
  pushToUser: (params: {
    db: LobeChatDatabase;
    message: MessengerPushMessage;
    userId: string;
  }) => Promise<MessengerPushResult>;
}

const providers = new Map<MessengerPushPlatform, MessengerPushProvider>();

export const registerMessengerPushProvider = (provider: MessengerPushProvider): void => {
  providers.set(provider.platform, provider);
};

export const getMessengerPushProvider = (
  platform: MessengerPushPlatform,
): MessengerPushProvider | undefined => providers.get(platform);

/** Test helper. */
export const resetMessengerPushProvidersForTest = (): void => {
  providers.clear();
};

export class MessengerPushService {
  constructor(private readonly db: LobeChatDatabase) {}

  async pushToUser(params: {
    message: MessengerPushMessage;
    platform: MessengerPushPlatform;
    userId: string;
  }): Promise<MessengerPushResult> {
    const provider = providers.get(params.platform);
    if (!provider) {
      log('pushToUser: no provider registered for %s', params.platform);
      return { reason: 'platform_unavailable', status: 'skipped' };
    }
    try {
      return await provider.pushToUser({
        db: this.db,
        message: params.message,
        userId: params.userId,
      });
    } catch (error) {
      log('pushToUser: provider %s threw: %O', params.platform, error);
      return { error: error instanceof Error ? error.message : String(error), status: 'failed' };
    }
  }
}
