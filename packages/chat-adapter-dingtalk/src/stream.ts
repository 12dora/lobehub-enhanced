import https from 'node:https';
import os from 'node:os';

import WebSocket from 'ws';

import type {
  DingTalkAck,
  DingTalkCardCallback,
  DingTalkRobotMessage,
  DingTalkStreamState,
} from './types';
import { DINGTALK_GATEWAY_URL, TOPIC_CARD, TOPIC_ROBOT } from './types';

export interface DingTalkStreamFrame {
  data: string;
  headers: {
    contentType?: string;
    eventType?: string;
    messageId: string;
    topic: string;
    [key: string]: string | undefined;
  };
  specVersion?: string;
  type: 'SYSTEM' | 'EVENT' | 'CALLBACK' | string;
}

export interface DingTalkStreamOptions {
  clientId: string;
  clientSecret: string;
  /** @internal test hook */
  fetchImpl?: typeof fetch;
  onCardCallback?: (payload: DingTalkCardCallback, ack: DingTalkAck) => void | Promise<void>;
  onRobotMessage?: (payload: DingTalkRobotMessage, ack: DingTalkAck) => void | Promise<void>;
  onStateChange?: (state: DingTalkStreamState, error?: Error) => void;
  /** @internal test hook — default 1000 */
  reconnectBaseIntervalMs?: number;
  /** @internal test hook — default 60_000 */
  reconnectMaxIntervalMs?: number;
  ua?: string;
  /** @internal test hook */
  WebSocketImpl?: typeof WebSocket;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;

const getLocalIp = (): string => {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * DingTalk Stream Mode client. Ports the official `dingtalk-stream` protocol
 * (open-gateway → WebSocket + SYSTEM/CALLBACK frames) onto the `ws` package
 * and global `fetch`.
 *
 * CALLBACK frames are acked immediately (DingTalk retries after 60s if the
 * client is silent) and only then handed to `onRobotMessage` / `onCardCallback`.
 */
export class DingTalkStreamConnection {
  private readonly options: DingTalkStreamOptions;
  private readonly WS: typeof WebSocket;
  private readonly fetchFn: typeof fetch;

  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private userDisconnect = false;
  private connecting = false;
  private currentState: DingTalkStreamState = 'disconnected';

  constructor(options: DingTalkStreamOptions) {
    this.options = options;
    this.WS = options.WebSocketImpl ?? WebSocket;
    this.fetchFn = options.fetchImpl ?? fetch;
  }

  get state(): DingTalkStreamState {
    return this.currentState;
  }

  async connect(): Promise<void> {
    if (this.connecting) return;
    this.userDisconnect = false;
    this.connecting = true;
    this.setState('connecting');

    try {
      this.cleanupSocket();
      const dwUrl = await this.openGateway();
      if (this.userDisconnect) return;
      await this.openSocket(dwUrl);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.setState('error', err);
      this.connecting = false;
      if (!this.userDisconnect) {
        this.reconnectAttempts += 1;
        this.scheduleReconnect();
      }
      return;
    } finally {
      this.connecting = false;
    }
  }

  disconnect(): void {
    this.userDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
    this.cleanupSocket();
    this.setState('disconnected');
  }

  /** @internal used by tests to inject a frame without a live socket */
  handleFrame(raw: string | DingTalkStreamFrame): void {
    const msg: DingTalkStreamFrame =
      typeof raw === 'string' ? (JSON.parse(raw) as DingTalkStreamFrame) : raw;
    switch (msg.type) {
      case 'SYSTEM': {
        this.onSystem(msg);
        break;
      }
      case 'CALLBACK': {
        this.onCallback(msg);
        break;
      }
      default: {
        break;
      }
    }
  }

  private setState(state: DingTalkStreamState, error?: Error): void {
    this.currentState = state;
    this.options.onStateChange?.(state, error);
  }

  private async openGateway(): Promise<string> {
    const response = await this.fetchFn(DINGTALK_GATEWAY_URL, {
      body: JSON.stringify({
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
        localIp: getLocalIp(),
        subscriptions: [
          { topic: TOPIC_ROBOT, type: 'CALLBACK' },
          { topic: TOPIC_CARD, type: 'CALLBACK' },
        ],
        ua: this.options.ua ?? '',
      }),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DingTalk gateway open failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { endpoint?: string; ticket?: string };
    if (!data.endpoint || !data.ticket) {
      throw new Error('DingTalk gateway open failed: missing endpoint or ticket');
    }
    return `${data.endpoint}?ticket=${data.ticket}`;
  }

  private openSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const clientOptions: WebSocket.ClientOptions = { rejectUnauthorized: true };
      if (process.env.NODE_USE_ENV_PROXY === '1') {
        clientOptions.agent = new https.Agent({ proxyEnv: process.env } as https.AgentOptions);
      }

      try {
        this.socket = new this.WS(url, clientOptions);
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;

      this.socket.on('open', () => {
        this.reconnectAttempts = 0;
        this.setState('connected');
        settled = true;
        resolve();
      });

      this.socket.on('message', (data) => {
        const text = typeof data === 'string' ? data : data.toString();
        try {
          this.handleFrame(text);
        } catch {
          // malformed frame — ignore
        }
      });

      this.socket.on('close', () => {
        if (this.currentState !== 'disconnected') {
          this.setState('disconnected');
        }
        if (settled && !this.userDisconnect) {
          this.scheduleReconnect();
        }
      });

      this.socket.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.socket?.terminate();
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  private onSystem(frame: DingTalkStreamFrame): void {
    switch (frame.headers.topic) {
      case 'ping': {
        this.socket?.send(
          JSON.stringify({
            code: 200,
            data: frame.data,
            headers: frame.headers,
            message: 'OK',
          }),
        );
        break;
      }
      case 'disconnect': {
        this.cleanupSocket();
        if (!this.userDisconnect) this.scheduleReconnect();
        break;
      }
      default: {
        break;
      }
    }
  }

  private onCallback(frame: DingTalkStreamFrame): void {
    let acked = false;
    const ack: DingTalkAck = (result) => {
      if (acked) return;
      acked = true;
      this.sendAck(frame.headers.messageId, result ?? {});
    };

    // Ack before any slow handler work so DingTalk does not retry (60s).
    ack({});

    const payload = parseJson(frame.data);
    const topic = frame.headers.topic;

    if (topic === TOPIC_ROBOT) {
      void this.options.onRobotMessage?.(payload as DingTalkRobotMessage, ack);
      return;
    }
    if (topic === TOPIC_CARD) {
      void this.options.onCardCallback?.(payload as DingTalkCardCallback, ack);
    }
  }

  private sendAck(messageId: string, result: unknown): void {
    this.socket?.send(
      JSON.stringify({
        code: 200,
        data: JSON.stringify(result ?? {}),
        headers: { contentType: 'application/json', messageId },
        message: 'OK',
      }),
    );
  }

  private scheduleReconnect(): void {
    if (this.userDisconnect || this.connecting) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const base = this.options.reconnectBaseIntervalMs ?? RECONNECT_BASE_MS;
    const max = this.options.reconnectMaxIntervalMs ?? RECONNECT_MAX_MS;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, max);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectAttempts += 1;
      void this.connect();
    }, delay);
  }

  private cleanupSocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    const OPEN = this.WS.OPEN ?? 1;
    const CONNECTING = this.WS.CONNECTING ?? 0;
    if (this.socket.readyState === OPEN || this.socket.readyState === CONNECTING) {
      this.socket.terminate();
    }
    this.socket = undefined;
  }
}
