import { createHash } from 'node:crypto';

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

import { getMessengerDingTalkConfig, type MessengerDingTalkConfig } from '@/config/messenger';
import {
  DINGTALK_CARD_CALLBACK_EVENT,
  DINGTALK_ROBOT_MESSAGE_EVENT,
} from '@/server/services/messenger/platforms/dingtalk/const';
import { registerDingTalkMessengerPushProvider } from '@/server/services/messenger/platforms/dingtalk/push';
import { writeDingTalkStreamStatus } from '@/server/services/messenger/platforms/dingtalk/redis';

registerDingTalkMessengerPushProvider();

const log = debug('lobe-server:messenger:dingtalk-stream');

const POLL_INTERVAL_MS = 30_000;
const WEBHOOK_TIMEOUT_MS = 30_000;

/** Equality fingerprint — includes the secret. Never log this string. */
const configFingerprint = (config: MessengerDingTalkConfig | null): string => {
  if (!config) return 'disabled';
  return [config.clientId, config.clientSecret, config.robotCode, String(config.chatEnabled)].join(
    '|',
  );
};

/** Log-safe fingerprint: clientId, robotCode, chatEnabled, sha256(secret).slice(0, 8). */
const configFingerprintLog = (config: MessengerDingTalkConfig | null): string => {
  if (!config) return 'disabled';
  const secretHash = createHash('sha256').update(config.clientSecret).digest('hex').slice(0, 8);
  return [config.clientId, config.robotCode, String(config.chatEnabled), secretHash].join('|');
};

const resolveWebhookUrl = (): string => {
  const port = process.env.PORT || '3010';
  return `http://127.0.0.1:${port}/api/agent/messenger/webhooks/dingtalk`;
};

const mapStreamState = (
  state: DingTalkStreamState,
  enabled: boolean,
): 'disabled' | 'connecting' | 'connected' | 'error' => {
  if (!enabled) return 'disabled';
  if (state === 'connected') return 'connected';
  if (state === 'connecting') return 'connecting';
  if (state === 'error') return 'error';
  return 'connecting';
};

export class DingTalkStreamWorker {
  private connection: DingTalkStreamConnection | null = null;
  private fingerprint = 'disabled';
  private fingerprintLog = 'disabled';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  /** Serializes ticks so overlapping interval/test calls cannot connect twice. */
  private tickLock: Promise<void> = Promise.resolve();

  private connectedAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;
  private lastEventAt: string | null = null;
  private statusState: 'disabled' | 'connecting' | 'connected' | 'error' = 'disabled';

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.tick();
    this.pollTimer = setInterval(() => {
      this.tick().catch((error) => {
        log('tick failed: %O', error);
      });
    }, POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.disconnect();
    this.statusState = 'disabled';
    await this.flushStatus();
  }

  /** @internal test helper */
  async tickForTest(): Promise<void> {
    this.stopped = false;
    await this.tick();
  }

  /** @internal test helper */
  get connectionForTest(): DingTalkStreamConnection | null {
    return this.connection;
  }

  private async tick(): Promise<void> {
    let release!: () => void;
    const previous = this.tickLock;
    this.tickLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (this.stopped) return;
      await this.runTick();
    } finally {
      release();
    }
  }

  private async runTick(): Promise<void> {
    const config = await getMessengerDingTalkConfig();
    const enabled = Boolean(config?.chatEnabled);
    const nextConfig = enabled ? config : null;
    const next = configFingerprint(nextConfig);
    const nextLog = configFingerprintLog(nextConfig);

    if (next !== this.fingerprint) {
      log('config changed (%s → %s), restarting connection', this.fingerprintLog, nextLog);
      this.disconnect();
      this.fingerprint = next;
      this.fingerprintLog = nextLog;
      if (enabled && config) {
        await this.connect(config);
      } else {
        this.statusState = 'disabled';
        this.connectedAt = null;
        await this.flushStatus();
      }
      return;
    }

    // A failed first connect disposes the connection (see `connect`); retry on every tick
    // until the stream opens once, after which the connection reconnects by itself.
    if (enabled && config && !this.connection) {
      await this.connect(config);
      return;
    }

    await this.flushStatus();
  }

  private async connect(config: MessengerDingTalkConfig): Promise<void> {
    this.statusState = 'connecting';
    await this.flushStatus();

    const webhookUrl = resolveWebhookUrl();
    this.connection = new DingTalkStreamConnection({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      onCardCallback: async (payload, ack) => {
        ack({});
        this.lastEventAt = new Date().toISOString();
        await this.forward(DINGTALK_CARD_CALLBACK_EVENT, payload, webhookUrl, config);
      },
      onRobotMessage: async (payload, ack) => {
        ack({});
        this.lastEventAt = new Date().toISOString();
        await this.forward(DINGTALK_ROBOT_MESSAGE_EVENT, payload, webhookUrl, config);
      },
      onStateChange: (state, error) => {
        this.statusState = mapStreamState(state, true);
        if (state === 'connected') {
          this.connectedAt = this.connectedAt ?? new Date().toISOString();
          this.lastError = null;
        }
        if (state === 'error') {
          this.lastError = error?.message ?? 'stream error';
          this.lastErrorAt = new Date().toISOString();
        }
        void this.flushStatus();
      },
    });

    try {
      await this.connection.connect();
    } catch (error) {
      this.statusState = 'error';
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastErrorAt = new Date().toISOString();
      await this.flushStatus();
      log('connect failed, will retry on the next tick: %O', error);
      this.connection?.disconnect();
      this.connection = null;
    }
  }

  private disconnect(): void {
    this.connection?.disconnect();
    this.connection = null;
    this.connectedAt = null;
  }

  private async forward(
    eventType: string,
    data: DingTalkRobotMessage | DingTalkCardCallback,
    webhookUrl: string,
    config: MessengerDingTalkConfig,
  ): Promise<void> {
    try {
      const request = new Request(webhookUrl, {
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
          'X-DingTalk-Event': eventType,
          // Same HMAC pair the chat-sdk adapter verifies in handleWebhook.
          ...buildDingTalkForwardHeaders({
            appId: config.clientId,
            clientSecret: config.clientSecret,
          }),
        },
        method: 'POST',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      // Lazy import: MessengerRouter pulls AgentBridge / binders; a static import
      // would cycle through messenger platforms that load this worker's push side-effect.
      const { getMessengerRouter } = await import('@/server/services/messenger');
      const response = await getMessengerRouter().getWebhookHandler('dingtalk')(request);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // Frame is already acked — a 401/404/500 must be visible without DEBUG=.
        console.warn(
          `[dingtalk-stream] webhook handler returned ${response.status} for event ${eventType}: ${body}`,
        );
      }
    } catch (error) {
      console.warn(`[dingtalk-stream] failed to dispatch event ${eventType}`, error);
    }
  }

  private async flushStatus(): Promise<void> {
    await writeDingTalkStreamStatus({
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastEventAt: this.lastEventAt,
      state: this.statusState,
    });
  }
}

let singleton: DingTalkStreamWorker | undefined;

const shouldRunDingTalkStreamWorker = (): boolean => {
  const isDev = process.env.NODE_ENV !== 'production';
  return Boolean(
    process.env.DATABASE_URL &&
    !process.env.VERCEL_ENV &&
    (!isDev || process.env.ENABLE_BOT_IN_DEV === '1'),
  );
};

export const startDingTalkStreamWorker = async (): Promise<void> => {
  if (!shouldRunDingTalkStreamWorker()) return;
  if (!singleton) singleton = new DingTalkStreamWorker();
  await singleton.start();
};

export const stopDingTalkStreamWorker = async (): Promise<void> => {
  if (!singleton) return;
  await singleton.stop();
  singleton = undefined;
};

export const resetDingTalkStreamWorkerForTest = (): void => {
  singleton = undefined;
};
