import type {
  DingTalkCardCallback,
  DingTalkRobotMessage,
  DingTalkStreamState,
} from '@lobechat/chat-adapter-dingtalk';
import {
  buildDingTalkForwardHeaders,
  DingTalkStreamConnection,
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
    } catch (err) {
      log('Failed to forward event %s to webhook: %O', eventType, err);
    }
  }
}
