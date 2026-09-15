import https from 'node:https';
import os from 'node:os';

import WebSocket from 'ws';

import type {
  DingTalkAck,
  DingTalkCardCallback,
  DingTalkRobotMessage,
  DingTalkStreamState,
} from './types';
import {
  DINGTALK_GATEWAY_OPEN_TIMEOUT_MS,
  DINGTALK_GATEWAY_URL,
  DINGTALK_SOCKET_OPEN_TIMEOUT_MS,
  DINGTALK_STREAM_FRAME_SILENCE_MS,
  DINGTALK_STREAM_WATCHDOG_INTERVAL_MS,
  DINGTALK_STREAM_WS_PING_INTERVAL_MS,
  DINGTALK_STREAM_WS_PONG_TIMEOUT_MS,
  TOPIC_CARD,
  TOPIC_ROBOT,
} from './types';

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
  /** @internal test hook — default 180_000 */
  frameSilenceTimeoutMs?: number;
  /** @internal test hook — default 15_000 */
  gatewayOpenTimeoutMs?: number;
  logger?: { warn?: (...args: unknown[]) => void };
  onCardCallback?: (payload: DingTalkCardCallback, ack: DingTalkAck) => void | Promise<void>;
  onRobotMessage?: (payload: DingTalkRobotMessage, ack: DingTalkAck) => void | Promise<void>;
  onStateChange?: (state: DingTalkStreamState, error?: Error) => void;
  /** @internal test hook — default 1000 */
  reconnectBaseIntervalMs?: number;
  /** @internal test hook — default 60_000 */
  reconnectMaxIntervalMs?: number;
  /** @internal test hook — default 15_000 */
  socketOpenTimeoutMs?: number;
  ua?: string;
  /** @internal test hook — default 30_000 */
  watchdogIntervalMs?: number;
  /** @internal test hook */
  WebSocketImpl?: typeof WebSocket;
  /** @internal test hook — default 30_000 */
  wsPingIntervalMs?: number;
  /** @internal test hook — default 10_000 */
  wsPongTimeoutMs?: number;
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

const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  return name === 'AbortError' || name === 'TimeoutError';
};

/**
 * DingTalk Stream Mode client. Ports the official `dingtalk-stream` protocol
 * (open-gateway → WebSocket + SYSTEM/CALLBACK frames) onto the `ws` package
 * and global `fetch`.
 *
 * CALLBACK frames are acked immediately (DingTalk retries after 60s if the
 * client is silent) and only then handed to `onRobotMessage` / `onCardCallback`.
 *
 * Liveness: any application frame updates `lastFrameAt`. A watchdog terminates
 * a silent socket after 3 minutes (configurable). Protocol-level `ws` ping
 * every 30s terminates if `pong` does not arrive within 10s. Gateway and
 * WebSocket open are bounded at 15s so a hung attempt can never block forever.
 *
 * Ping stays at 30s (official `dingtalk-stream` uses 8s): fewer false kills
 * through HTTP(S)_PROXY, still far faster than the 180s frame watchdog that
 * left a half-open socket up for ~17 minutes.
 */
export class DingTalkStreamConnection {
  private readonly options: DingTalkStreamOptions;
  private readonly WS: typeof WebSocket;
  private readonly fetchFn: typeof fetch;

  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private watchdogTimer?: ReturnType<typeof setInterval>;
  private wsPingTimer?: ReturnType<typeof setInterval>;
  private pongTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private userDisconnect = false;
  private connecting = false;
  /** True after the first successful socket open — background reconnect is allowed only then. */
  private hasOpened = false;
  private currentState: DingTalkStreamState = 'disconnected';
  private connectAbort?: AbortController;
  private lastFrameAtMs: number | null = null;
  private socketDead = false;
  private awaitingPong = false;

  constructor(options: DingTalkStreamOptions) {
    this.options = options;
    this.WS = options.WebSocketImpl ?? WebSocket;
    this.fetchFn = options.fetchImpl ?? fetch;
  }

  get state(): DingTalkStreamState {
    return this.currentState;
  }

  /** Epoch ms of the last application frame (or socket open). `null` before the first open. */
  get lastFrameAt(): number | null {
    return this.lastFrameAtMs;
  }

  async connect(): Promise<void> {
    if (this.connecting) return;
    this.userDisconnect = false;
    this.connecting = true;
    this.connectAbort = new AbortController();
    this.setState('connecting');

    let shouldReconnect = false;
    try {
      this.cleanupSocket();
      const dwUrl = await this.openGateway();
      if (this.userDisconnect || this.connectAbort.signal.aborted) {
        this.setState('disconnected');
        throw new Error('DingTalk stream disconnected before socket open');
      }
      await this.openSocket(dwUrl);
    } catch (error) {
      this.stopLiveness();
      this.cleanupSocket();
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.userDisconnect) {
        this.setState('disconnected');
      } else {
        this.setState('error', err);
        shouldReconnect = this.hasOpened;
      }
      throw err;
    } finally {
      this.connecting = false;
      if (shouldReconnect) this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.userDisconnect = true;
    this.connectAbort?.abort();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
    this.hasOpened = false;
    this.stopLiveness();
    this.cleanupSocket();
    this.setState('disconnected');
  }

  /** @internal used by tests to inject a frame without a live socket */
  handleFrame(raw: string | DingTalkStreamFrame): void {
    this.touchFrame();
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

  private touchFrame(): void {
    this.lastFrameAtMs = Date.now();
  }

  private warn(...args: unknown[]): void {
    if (this.options.logger?.warn) {
      this.options.logger.warn(...args);
    } else {
      console.warn(...args);
    }
  }

  private async openGateway(): Promise<string> {
    const timeoutMs = this.options.gatewayOpenTimeoutMs ?? DINGTALK_GATEWAY_OPEN_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onUserAbort = () => controller.abort();
    this.connectAbort?.signal.addEventListener('abort', onUserAbort);
    if (this.connectAbort?.signal.aborted) controller.abort();

    try {
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
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`DingTalk gateway open failed: ${response.status} ${text}`);
      }

      const data = (await response.json()) as { endpoint?: string; ticket?: string };
      if (!data.endpoint || !data.ticket) {
        throw new Error('DingTalk gateway open failed: missing endpoint or ticket');
      }
      return `${data.endpoint}?ticket=${encodeURIComponent(data.ticket)}`;
    } catch (error) {
      if (this.userDisconnect || this.connectAbort?.signal.aborted) {
        throw new Error('DingTalk stream disconnected before socket open', { cause: error });
      }
      if (controller.signal.aborted || isAbortError(error)) {
        throw new Error('DingTalk gateway open timed out', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.connectAbort?.signal.removeEventListener('abort', onUserAbort);
    }
  }

  private openSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const clientOptions: WebSocket.ClientOptions = { rejectUnauthorized: true };
      if (process.env.NODE_USE_ENV_PROXY === '1') {
        clientOptions.agent = new https.Agent({ proxyEnv: process.env });
      }

      this.socketDead = false;

      try {
        this.socket = new this.WS(url, clientOptions);
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      const timeoutMs = this.options.socketOpenTimeoutMs ?? DINGTALK_SOCKET_OPEN_TIMEOUT_MS;
      const openTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.connectAbort?.signal.removeEventListener('abort', onAbort);
        this.cleanupSocket();
        reject(new Error('DingTalk stream socket open timed out'));
      }, timeoutMs);

      const settleOpen = () => {
        if (settled) return false;
        settled = true;
        clearTimeout(openTimer);
        this.connectAbort?.signal.removeEventListener('abort', onAbort);
        return true;
      };

      const onAbort = () => {
        if (!settleOpen()) return;
        this.cleanupSocket();
        reject(new Error('DingTalk stream disconnected before socket open'));
      };
      this.connectAbort?.signal.addEventListener('abort', onAbort);
      if (this.connectAbort?.signal.aborted) {
        onAbort();
        return;
      }

      this.socket.on('open', () => {
        if (!settleOpen()) return;
        this.reconnectAttempts = 0;
        this.hasOpened = true;
        this.socketDead = false;
        this.touchFrame();
        this.startLiveness();
        this.setState('connected');
        resolve();
      });

      this.socket.on('message', (data) => {
        this.touchFrame();
        const text = typeof data === 'string' ? data : data.toString();
        try {
          this.handleFrame(text);
        } catch (error) {
          this.warn('DingTalk stream malformed frame', error);
        }
      });

      this.socket.on('pong', () => {
        this.awaitingPong = false;
        if (this.pongTimer) {
          clearTimeout(this.pongTimer);
          this.pongTimer = undefined;
        }
      });

      this.socket.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(openTimer);
          this.connectAbort?.signal.removeEventListener('abort', onAbort);
          reject(new Error('DingTalk stream socket closed before open'));
          return;
        }
        this.markSocketDead(new Error('DingTalk stream socket closed'));
      });

      this.socket.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.socket?.terminate();
        if (!settled) {
          settled = true;
          clearTimeout(openTimer);
          this.connectAbort?.signal.removeEventListener('abort', onAbort);
          reject(error);
          return;
        }
        this.markSocketDead(error);
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
        this.markSocketDead(new Error('DingTalk stream server disconnect'));
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

  private startLiveness(): void {
    this.stopLiveness();
    const watchdogMs = this.options.watchdogIntervalMs ?? DINGTALK_STREAM_WATCHDOG_INTERVAL_MS;
    const silenceMs = this.options.frameSilenceTimeoutMs ?? DINGTALK_STREAM_FRAME_SILENCE_MS;
    this.watchdogTimer = setInterval(() => {
      if (this.lastFrameAtMs == null) return;
      const silence = Date.now() - this.lastFrameAtMs;
      if (silence >= silenceMs) {
        this.warn('DingTalk stream watchdog: no frame for', silence, 'ms');
        this.markSocketDead(new Error('DingTalk stream watchdog: no frame'));
      }
    }, watchdogMs);

    // 30s ping / 10s pong (not the official 8s heartbeat): see class doc.
    const pingMs = this.options.wsPingIntervalMs ?? DINGTALK_STREAM_WS_PING_INTERVAL_MS;
    const pongMs = this.options.wsPongTimeoutMs ?? DINGTALK_STREAM_WS_PONG_TIMEOUT_MS;
    this.wsPingTimer = setInterval(() => {
      this.sendWsPing(pongMs);
    }, pingMs);
  }

  private sendWsPing(pongTimeoutMs: number): void {
    const socket = this.socket;
    if (!socket) return;
    const OPEN = this.WS.OPEN ?? 1;
    if (socket.readyState !== OPEN) return;
    if (typeof socket.ping !== 'function') return;

    this.awaitingPong = true;
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      if (!this.awaitingPong) return;
      this.warn('DingTalk stream pong timeout');
      this.markSocketDead(new Error('DingTalk stream pong timeout'));
    }, pongTimeoutMs);

    try {
      socket.ping();
    } catch (error) {
      this.warn('DingTalk stream ping failed', error);
      this.markSocketDead(new Error('DingTalk stream ping failed'));
    }
  }

  private stopLiveness(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    if (this.wsPingTimer) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = undefined;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
    this.awaitingPong = false;
  }

  /**
   * Socket died (close / error / watchdog / pong timeout / server disconnect).
   * State becomes `error` immediately — never stays `connected`. Background
   * reconnect is scheduled when the socket had opened at least once.
   */
  private markSocketDead(error: Error): void {
    if (this.userDisconnect || this.socketDead) return;
    this.socketDead = true;
    this.stopLiveness();
    this.setState('error', error);
    this.cleanupSocket();
    if (this.hasOpened && !this.connecting) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.userDisconnect || this.connecting) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const base = this.options.reconnectBaseIntervalMs ?? RECONNECT_BASE_MS;
    const max = this.options.reconnectMaxIntervalMs ?? RECONNECT_MAX_MS;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, max);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => {
        // First-open failures throw; after hasOpened, connect() already scheduled the next try.
      });
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
