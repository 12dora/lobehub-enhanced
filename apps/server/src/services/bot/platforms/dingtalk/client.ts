import {
  createDingTalkAdapter,
  decodeDingTalkThreadId,
  DingTalkApiClient,
  downloadMediaFromRawMessage,
  getDingTalkSession,
  isSessionWebhookLive,
} from '@lobechat/chat-adapter-dingtalk';
import type { Chat as ChatBot, Message } from 'chat';
import debug from 'debug';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { DingTalkWSConnection } from './gateway';
import { sendDingTalkAttachments } from './sendAttachments';

const log = debug('bot-platform:dingtalk:client');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000;

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

function resolveRobotCode(config: BotProviderConfig): string {
  return String(config.settings?.robotCode ?? '').trim();
}

function createMessenger(config: BotProviderConfig, platformThreadId: string): PlatformMessenger {
  const api = new DingTalkApiClient(config.applicationId, config.credentials.clientSecret);
  const decoded = decodeDingTalkThreadId(platformThreadId);
  const session =
    getDingTalkSession(platformThreadId) ?? getDingTalkSession(decoded.conversationId);
  const robotCode = session?.robotCode || resolveRobotCode(config);
  const isDm = decoded.senderStaffId === undefined;

  const sendText = async (text: string) => {
    const title =
      text
        .split('\n')
        .find((line) => line.trim())
        ?.slice(0, 32) || 'Reply';
    if (isSessionWebhookLive(session) && session?.sessionWebhook) {
      const payload: Record<string, unknown> = {
        markdown: { text, title },
        msgtype: 'markdown',
      };
      if (!isDm && (decoded.senderStaffId || session.senderStaffId)) {
        payload.at = { atUserIds: [decoded.senderStaffId || session.senderStaffId] };
      }
      await api.sendBySessionWebhook(session.sessionWebhook, payload);
      return;
    }

    const msgParamObj: Record<string, unknown> = { text, title };
    if (!isDm && (decoded.senderStaffId || session?.senderStaffId)) {
      msgParamObj.at = {
        atUserIds: [decoded.senderStaffId || session?.senderStaffId],
      };
    }
    const msgParam = JSON.stringify(msgParamObj);
    if (isDm) {
      const userId = session?.senderStaffId;
      if (!userId) throw new Error('DingTalk DM send requires senderStaffId');
      await api.sendOtoMessage({
        msgKey: 'sampleMarkdown',
        msgParam,
        robotCode,
        userIds: [userId],
      });
      return;
    }

    await api.sendGroupMessage({
      msgKey: 'sampleMarkdown',
      msgParam,
      openConversationId: decoded.conversationId,
      robotCode,
    });
  };

  return {
    createMessage: async (content) => {
      const text = messengerContentText(content);
      const attachments = typeof content === 'string' ? undefined : content.attachments;
      if (text.trim()) await sendText(text);
      if (attachments?.length) {
        await sendDingTalkAttachments(
          api,
          {
            openConversationId: isDm ? undefined : decoded.conversationId,
            robotCode,
            sessionWebhook: isSessionWebhookLive(session) ? session?.sessionWebhook : undefined,
            userIds: isDm && session?.senderStaffId ? [session.senderStaffId] : undefined,
          },
          attachments,
        );
      }
    },
    editMessage: async () => {
      // DingTalk robot messages are not editable.
    },
    removeReaction: () => Promise.resolve(),
  };
}

async function dingtalkExtractFiles(
  api: DingTalkApiClient,
  message: Message,
): Promise<AttachmentSource[] | undefined> {
  const raw = (message as any).raw as Parameters<typeof downloadMediaFromRawMessage>[1] | undefined;
  if (!raw) return undefined;

  const attachments = await downloadMediaFromRawMessage(api, raw, { warn: log });
  if (attachments.length === 0) return undefined;

  return attachments.map((att: any) => ({
    buffer: att.buffer,
    mimeType: att.mimeType,
    name: att.name,
    size: att.size,
  }));
}

class DingTalkWSClientImpl implements PlatformClient {
  readonly id = 'dingtalk';
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private gateway: DingTalkWSConnection | null = null;
  private bot: ChatBot<any> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private _api?: DingTalkApiClient;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
  }

  private get api(): DingTalkApiClient {
    if (!this._api) {
      this._api = new DingTalkApiClient(
        this.config.applicationId,
        this.config.credentials.clientSecret,
      );
    }
    return this._api;
  }

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting DingTalkClient (ws) appId=%s', this.applicationId);

    this.stopped = false;
    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const runtimeStatusTtlMs = durationMs + CONNECTED_STATUS_TTL_BUFFER_MS;
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.starting,
      },
      { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
    );

    try {
      if (this.bot) {
        await this.bot.shutdown().catch(() => {});
        this.bot = null;
      }

      const adapter = createDingTalkAdapter({
        aiCardTemplateId: this.config.settings?.aiCardTemplateId as string | undefined,
        clientId: this.config.applicationId,
        clientSecret: this.config.credentials.clientSecret,
        robotCode: resolveRobotCode(this.config),
        selectCardTemplateId: this.config.settings?.selectCardTemplateId as string | undefined,
      });

      const { Chat, ConsoleLogger } = await import('chat');
      const chatConfig: any = {
        adapters: { dingtalk: adapter },
        userName: `lobehub-gateway-${this.applicationId}`,
      };

      if (this.context.redisClient) {
        const { createIoRedisState } = await import('@chat-adapter/state-ioredis');
        chatConfig.state = createIoRedisState({
          client: this.context.redisClient as any,
          logger: new ConsoleLogger(),
        });
      }

      const bot = new Chat(chatConfig);
      this.bot = bot;
      await bot.initialize();

      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/dingtalk/${this.applicationId}`;

      this.gateway = new DingTalkWSConnection({
        clientId: this.config.applicationId,
        clientSecret: this.config.credentials.clientSecret,
        onStateChange: (state, error) => {
          if (this.stopped) return;
          const status =
            state === 'connected'
              ? BOT_RUNTIME_STATUSES.connected
              : state === 'error'
                ? BOT_RUNTIME_STATUSES.failed
                : state === 'connecting'
                  ? BOT_RUNTIME_STATUSES.starting
                  : BOT_RUNTIME_STATUSES.disconnected;
          void updateBotRuntimeStatus(
            {
              applicationId: this.applicationId,
              errorMessage: error ? getRuntimeStatusErrorMessage(error) : undefined,
              platform: this.id,
              status,
            },
            { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
          );
        },
        webhookUrl,
      });

      await this.gateway.start();

      if (this.gateway.state !== 'connected') {
        throw new Error(`DingTalk stream failed to connect (state=${this.gateway.state})`);
      }

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.stopped) return;
          log(
            'DingTalkClient appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.gateway?.close();
          this.start().catch((err) => {
            log('Failed to refresh DingTalkClient appId=%s: %O', this.applicationId, err);
          });
        }, durationMs);
      }

      await updateBotRuntimeStatus(
        {
          applicationId: this.applicationId,
          platform: this.id,
          status: BOT_RUNTIME_STATUSES.connected,
        },
        { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
      );

      log('DingTalkClient (ws) appId=%s started', this.applicationId);
    } catch (error) {
      // Close the stream and drop the bot before rethrowing so a discarded
      // client cannot keep reconnecting / writing Redis `connected`.
      await this.teardownRuntime();
      await updateBotRuntimeStatus(
        {
          applicationId: this.applicationId,
          errorMessage: getRuntimeStatusErrorMessage(error),
          platform: this.id,
          status: BOT_RUNTIME_STATUSES.failed,
        },
        { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    log('Stopping DingTalkClient (ws) appId=%s', this.applicationId);
    await this.teardownRuntime();
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.disconnected,
      },
      { redisClient: this.context.redisClient as any },
    );
  }

  private async teardownRuntime(): Promise<void> {
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.gateway?.close();
    this.gateway = null;
    if (this.bot) {
      await this.bot.shutdown().catch(() => {});
      this.bot = null;
    }
  }

  createAdapter(): Record<string, any> {
    return {
      dingtalk: createDingTalkAdapter({
        aiCardTemplateId: this.config.settings?.aiCardTemplateId as string | undefined,
        clientId: this.config.applicationId,
        clientSecret: this.config.credentials.clientSecret,
        robotCode: resolveRobotCode(this.config),
        selectCardTemplateId: this.config.settings?.selectCardTemplateId as string | undefined,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    return createMessenger(this.config, platformThreadId);
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return dingtalkExtractFiles(this.api, message);
  }

  extractChatId(platformThreadId: string): string {
    return decodeDingTalkThreadId(platformThreadId).conversationId;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class DingTalkClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new DingTalkWSClientImpl(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!applicationId) errors.push({ field: 'applicationId', message: 'Client ID is required' });
    if (!credentials.clientSecret) {
      errors.push({ field: 'clientSecret', message: 'Client Secret is required' });
    }

    if (errors.length > 0) return { errors, valid: false };

    try {
      const api = new DingTalkApiClient(applicationId!, credentials.clientSecret);
      await api.getAccessToken();
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'credentials', message: 'Failed to authenticate with DingTalk API' }],
        valid: false,
      };
    }
  }
}
