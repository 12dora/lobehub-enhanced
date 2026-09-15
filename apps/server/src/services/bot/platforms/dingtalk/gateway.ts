import type { DingTalkCardCallback, DingTalkRobotMessage } from '@lobechat/chat-adapter-dingtalk';
import { DingTalkStreamConnection } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

const log = debug('bot-platform:dingtalk:gateway');

export interface DingTalkWSOptions {
  clientId: string;
  clientSecret: string;
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

  async start(): Promise<void> {
    this.stream = new DingTalkStreamConnection({
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      onCardCallback: async (payload, ack) => {
        ack({});
        await this.forward('card.callback', payload);
      },
      onRobotMessage: async (payload, ack) => {
        ack({});
        await this.forward('im.bot.message', payload);
      },
      ua: this.options.ua,
    });
    await this.stream.connect();
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
      await fetch(this.options.webhookUrl, {
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json', 'X-DingTalk-Event': eventType },
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      log('Failed to forward event %s to webhook: %O', eventType, err);
    }
  }
}
