import type {
  DingTalkCardCallback,
  DingTalkRobotMessage,
  DingTalkStreamState,
} from '@lobechat/chat-adapter-dingtalk';
import {
  buildDingTalkForwardHeaders,
  DINGTALK_NOT_ASKER_REPLY,
  DingTalkApiClient,
  DingTalkStreamConnection,
  getDingTalkCard,
  getDingTalkSession,
  isSessionWebhookLive,
} from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

const log = debug('bot-platform:dingtalk:gateway');

export interface DingTalkWSOptions {
  clientId: string;
  clientSecret: string;
  onStateChange?: (state: DingTalkStreamState, error?: Error) => void;
  ua?: string;
  webhookUrl: string;
}

/**
 * Owns a `DingTalkStreamConnection` and forwards inbound robot / card frames
 * as HTTP POSTs to `/api/agent/webhooks/dingtalk/:appId`, matching the Feishu
 * gateway pattern so the existing webhook pipeline can run.
 */
export class DingTalkWSConnection {
  private readonly options: DingTalkWSOptions;
  private stream: DingTalkStreamConnection | null = null;

  constructor(options: DingTalkWSOptions) {
    this.options = options;
  }

  get state(): DingTalkStreamState {
    return this.stream?.state ?? 'disconnected';
  }

  async start(): Promise<void> {
    this.stream = new DingTalkStreamConnection({
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      logger: { warn: (...args: unknown[]) => log('stream: %O', args) },
      onCardCallback: async (payload, ack) => {
        ack({});
        await this.forward('card.callback', payload);
      },
      onRobotMessage: async (payload, ack) => {
        ack({});
        await this.forward('im.bot.message', payload);
      },
      onStateChange: this.options.onStateChange,
      ua: this.options.ua,
    });
    await this.stream.connect();
    if (this.stream.state !== 'connected') {
      throw new Error(`DingTalk stream failed to connect (state=${this.stream.state})`);
    }
    log('DingTalk stream started appId=%s', this.options.clientId);
  }

  close(): void {
    this.stream?.disconnect();
    this.stream = null;
    log('DingTalk stream closed');
  }

  private async forward(
    eventType: string,
    data: DingTalkRobotMessage | DingTalkCardCallback,
  ): Promise<void> {
    try {
      const response = await fetch(this.options.webhookUrl, {
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
          'X-DingTalk-Event': eventType,
          ...buildDingTalkForwardHeaders({
            appId: this.options.clientId,
            clientSecret: this.options.clientSecret,
          }),
        },
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
      log(
        'forward %s ok=%s status=%d url=%s',
        eventType,
        response.ok,
        response.status,
        this.options.webhookUrl,
      );
      if (eventType === 'card.callback') {
        await this.maybeReplyNotAsker(data as DingTalkCardCallback, response);
      }
    } catch (err) {
      log('Failed to forward event %s to webhook: %O', eventType, err);
    }
  }

  private async maybeReplyNotAsker(
    payload: DingTalkCardCallback,
    response: Response,
  ): Promise<void> {
    let body: { ignored?: string; replied?: boolean };
    try {
      body = (await response.json()) as { ignored?: string; replied?: boolean };
    } catch {
      return;
    }
    if (body.ignored !== 'not_asker' || body.replied === true) return;

    const card = payload.outTrackId ? getDingTalkCard(payload.outTrackId) : undefined;
    const session = card
      ? (getDingTalkSession(card.threadId) ?? getDingTalkSession(card.conversationId))
      : undefined;
    const api = new DingTalkApiClient(this.options.clientId, this.options.clientSecret);
    const atUserIds = payload.userId ? [payload.userId] : [];
    const text = payload.userId
      ? `@${payload.userId} ${DINGTALK_NOT_ASKER_REPLY}`
      : DINGTALK_NOT_ASKER_REPLY;

    try {
      if (isSessionWebhookLive(session) && session?.sessionWebhook) {
        const webhookPayload: Record<string, unknown> = {
          markdown: { text, title: DINGTALK_NOT_ASKER_REPLY },
          msgtype: 'markdown',
        };
        if (atUserIds.length > 0) webhookPayload.at = { atUserIds };
        await api.sendBySessionWebhook(session.sessionWebhook, webhookPayload);
        return;
      }

      const robotCode = session?.robotCode;
      if (!robotCode) return;
      const msgParam = JSON.stringify({ text, title: DINGTALK_NOT_ASKER_REPLY });
      const isDm = (card?.conversationType ?? session?.conversationType) === '1';
      if (isDm) {
        const userId = payload.userId || session?.senderStaffId;
        if (!userId) return;
        await api.sendOtoMessage({
          msgKey: 'sampleMarkdown',
          msgParam,
          robotCode,
          userIds: [userId],
        });
        return;
      }
      const openConversationId = card?.conversationId;
      if (!openConversationId) return;
      await api.sendGroupMessage({
        msgKey: 'sampleMarkdown',
        msgParam,
        openConversationId,
        robotCode,
      });
    } catch (error) {
      log('maybeReplyNotAsker: failed: %O', error);
    }
  }
}
