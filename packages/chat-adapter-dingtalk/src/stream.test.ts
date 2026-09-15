import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

import { DingTalkStreamConnection } from './stream';
import {
  DINGTALK_GATEWAY_OPEN_TIMEOUT_MS,
  DINGTALK_GATEWAY_URL,
  DINGTALK_SOCKET_OPEN_TIMEOUT_MS,
  DINGTALK_STREAM_FRAME_SILENCE_MS,
  DINGTALK_STREAM_WS_PING_INTERVAL_MS,
  DINGTALK_STREAM_WS_PONG_TIMEOUT_MS,
  TOPIC_ROBOT,
} from './types';

class MockSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  autoPong = true;
  pingCalls = 0;
  readyState = MockSocket.CONNECTING;
  sent: string[] = [];
  terminated = false;
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    queueMicrotask(() => {
      if (this.readyState === MockSocket.CLOSED) return;
      this.readyState = MockSocket.OPEN;
      this.emit('open');
    });
  }

  ping() {
    this.pingCalls += 1;
    if (this.autoPong) {
      queueMicrotask(() => this.emit('pong'));
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  terminate() {
    this.terminated = true;
    this.readyState = MockSocket.CLOSED;
    this.emit('close');
  }

  close() {
    this.terminate();
  }
}

describe('DingTalkStreamConnection', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let lastSocket: MockSocket | undefined;
  const connections: DingTalkStreamConnection[] = [];

  const createWsCtor = (bucket: MockSocket[]): typeof WebSocket => {
    const ctor = vi.fn((url: string) => {
      const socket = new MockSocket(url);
      bucket.push(socket);
      lastSocket = socket;
      return socket;
    });
    Object.assign(ctor, {
      CLOSED: 3,
      CLOSING: 2,
      CONNECTING: 0,
      OPEN: 1,
    });
    return ctor as unknown as typeof WebSocket;
  };

  const create = (
    overrides?: Partial<ConstructorParameters<typeof DingTalkStreamConnection>[0]>,
  ) => {
    const conn = new DingTalkStreamConnection({
      WebSocketImpl: MockSocket as unknown as typeof WebSocket,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl: fetchMock,
      ua: 'test-ua',
      ...overrides,
    });
    connections.push(conn);
    return conn;
  };

  beforeEach(() => {
    lastSocket = undefined;
    connections.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ endpoint: 'ws://stream.dingtalk.test/connect', ticket: 'tix' }),
          { status: 200 },
        ),
    );
  });

  afterEach(() => {
    for (const conn of connections) conn.disconnect();
    connections.length = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens the gateway then the websocket', async () => {
    const sockets: MockSocket[] = [];
    const conn = create({ WebSocketImpl: createWsCtor(sockets) });
    await conn.connect();
    expect(conn.state).toBe('connected');
    expect(conn.lastFrameAt).toEqual(expect.any(Number));
    expect(fetchMock).toHaveBeenCalledWith(
      DINGTALK_GATEWAY_URL,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.clientId).toBe('cid');
    expect(body.subscriptions).toEqual([
      { topic: '/v1.0/im/bot/messages/get', type: 'CALLBACK' },
      { topic: '/v1.0/card/instances/callback', type: 'CALLBACK' },
    ]);
    expect(sockets[0].url).toContain('ticket=tix');
  });

  it('encodes the gateway ticket in the websocket URL', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ endpoint: 'ws://stream.dingtalk.test/connect', ticket: 'ti x/+=?' }),
        { status: 200 },
      ),
    );
    const sockets: MockSocket[] = [];
    const conn = create({ WebSocketImpl: createWsCtor(sockets) });
    await conn.connect();
    expect(sockets[0].url).toBe(
      `ws://stream.dingtalk.test/connect?ticket=${encodeURIComponent('ti x/+=?')}`,
    );
  });

  it('rejects the first connect on gateway 401 and does not mark connected', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    const conn = create();
    await expect(conn.connect()).rejects.toThrow(/401/);
    expect(conn.state).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects gateway open when the request exceeds the abort timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const conn = create();
    const pending = conn.connect();
    const assertion = expect(pending).rejects.toThrow(/gateway open timed out/);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DINGTALK_GATEWAY_OPEN_TIMEOUT_MS - 1);
    expect(conn.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(conn.state).toBe('error');
  });

  it('rejects openSocket when the socket closes before open', async () => {
    class ClosingSocket extends EventEmitter {
      static CLOSED = 3;
      static CLOSING = 2;
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = ClosingSocket.CONNECTING;
      sent: string[] = [];
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        queueMicrotask(() => {
          this.readyState = ClosingSocket.CLOSED;
          this.emit('close');
        });
      }
      ping() {}
      send() {}
      terminate() {
        this.emit('close');
      }
    }
    let socket: ClosingSocket | undefined;
    const ctor = vi.fn((url: string) => {
      socket = new ClosingSocket(url);
      return socket;
    });
    Object.assign(ctor, { CLOSED: 3, CLOSING: 2, CONNECTING: 0, OPEN: 1 });
    const conn = create({ WebSocketImpl: ctor as unknown as typeof WebSocket });
    await expect(conn.connect()).rejects.toThrow(/closed before open/);
    expect(conn.state).toBe('error');
    expect(socket).toBeDefined();
    expect(socket!.listenerCount('open')).toBe(0);
    expect(socket!.listenerCount('close')).toBe(0);
    expect(socket!.listenerCount('message')).toBe(0);
    expect(socket!.listenerCount('error')).toBe(0);
  });

  it('rejects + cleans up when the websocket never opens', async () => {
    vi.useFakeTimers();
    class HungSocket extends EventEmitter {
      static CLOSED = 3;
      static CLOSING = 2;
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = HungSocket.CONNECTING;
      terminated = false;
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
      }
      ping() {}
      send() {}
      terminate() {
        this.terminated = true;
        this.readyState = HungSocket.CLOSED;
      }
    }
    let socket: HungSocket | undefined;
    const ctor = vi.fn((url: string) => {
      socket = new HungSocket(url);
      return socket;
    });
    Object.assign(ctor, { CLOSED: 3, CLOSING: 2, CONNECTING: 0, OPEN: 1 });
    const conn = create({ WebSocketImpl: ctor as unknown as typeof WebSocket });
    const pending = conn.connect();
    const assertion = expect(pending).rejects.toThrow(/socket open timed out/);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DINGTALK_SOCKET_OPEN_TIMEOUT_MS - 1);
    expect(conn.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(conn.state).toBe('error');
    expect(socket?.terminated).toBe(true);
    expect(socket!.listenerCount('open')).toBe(0);
  });

  it('cleans up a connecting socket before connect() throws on socket error', async () => {
    class ErrorSocket extends EventEmitter {
      static CLOSED = 3;
      static CLOSING = 2;
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = ErrorSocket.CONNECTING;
      sent: string[] = [];
      terminated = false;
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        queueMicrotask(() => {
          this.emit('error', new Error('socket boom'));
        });
      }
      ping() {}
      send() {}
      terminate() {
        this.terminated = true;
        this.readyState = ErrorSocket.CLOSED;
      }
    }
    let socket: ErrorSocket | undefined;
    const ctor = vi.fn((url: string) => {
      socket = new ErrorSocket(url);
      return socket;
    });
    Object.assign(ctor, { CLOSED: 3, CLOSING: 2, CONNECTING: 0, OPEN: 1 });
    const conn = create({ WebSocketImpl: ctor as unknown as typeof WebSocket });
    await expect(conn.connect()).rejects.toThrow(/socket boom/);
    expect(conn.state).toBe('error');
    expect(socket?.terminated).toBe(true);
    expect(socket!.listenerCount('error')).toBe(0);
    expect(socket!.listenerCount('close')).toBe(0);
  });

  it('echoes SYSTEM ping data', async () => {
    const sockets: MockSocket[] = [];
    const conn = create({ WebSocketImpl: createWsCtor(sockets) });
    await conn.connect();
    const socket = sockets[0];
    const before = conn.lastFrameAt;
    socket.emit(
      'message',
      JSON.stringify({
        data: '{"ping":true}',
        headers: { messageId: 'm1', topic: 'ping' },
        type: 'SYSTEM',
      }),
    );
    expect(socket.sent).toHaveLength(1);
    const echo = JSON.parse(socket.sent[0]);
    expect(echo).toMatchObject({
      code: 200,
      data: '{"ping":true}',
      message: 'OK',
    });
    expect(echo.headers.topic).toBe('ping');
    expect(conn.lastFrameAt).toBeGreaterThanOrEqual(before ?? 0);
  });

  it('acks CALLBACK frames immediately with messageId before the handler runs', async () => {
    const sockets: MockSocket[] = [];
    let handlerStarted = false;
    const order: string[] = [];
    const conn = create({
      WebSocketImpl: createWsCtor(sockets),
      onRobotMessage: () => {
        handlerStarted = true;
        order.push('handler');
      },
    });
    await conn.connect();
    const socket = sockets[0];
    const originalSend = socket.send.bind(socket);
    socket.send = (data: string) => {
      order.push('ack');
      originalSend(data);
    };

    socket.emit(
      'message',
      JSON.stringify({
        data: JSON.stringify({ conversationId: 'c', msgId: 'm', msgtype: 'text' }),
        headers: { messageId: 'mid-1', topic: TOPIC_ROBOT },
        type: 'CALLBACK',
      }),
    );

    expect(handlerStarted).toBe(true);
    expect(order[0]).toBe('ack');
    const ack = JSON.parse(socket.sent[0]);
    expect(ack).toEqual({
      code: 200,
      data: '{}',
      headers: { contentType: 'application/json', messageId: 'mid-1' },
      message: 'OK',
    });
  });

  it('sets state to error on close and reconnects with exponential backoff', async () => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [];
    const states: string[] = [];
    const conn = create({
      WebSocketImpl: createWsCtor(sockets),
      onStateChange: (state) => states.push(state),
      reconnectBaseIntervalMs: 1000,
      reconnectMaxIntervalMs: 60_000,
    });
    await conn.connect();
    expect(sockets).toHaveLength(1);
    expect(conn.state).toBe('connected');

    const connectSpy = vi.spyOn(conn, 'connect');
    lastSocket?.terminate();
    expect(conn.state).toBe('error');
    expect(states).toContain('error');
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));

    await vi.advanceTimersByTimeAsync(999);
    expect(connectSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it('watchdog terminates a silent socket and reconnects', async () => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [];
    const conn = create({
      WebSocketImpl: createWsCtor(sockets),
      logger: { warn: vi.fn() },
      reconnectBaseIntervalMs: 1000,
    });
    await conn.connect();
    expect(sockets).toHaveLength(1);
    expect(conn.state).toBe('connected');

    await vi.advanceTimersByTimeAsync(DINGTALK_STREAM_FRAME_SILENCE_MS - 1);
    expect(conn.state).toBe('connected');
    expect(sockets[0].terminated).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(conn.state).toBe('error');
    expect(sockets[0].terminated).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    expect(conn.state).toBe('connected');
    expect(conn.state).toBe('connected');
  });

  it('terminates when a protocol ping is not answered with pong', async () => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [];
    const conn = create({
      WebSocketImpl: createWsCtor(sockets),
      frameSilenceTimeoutMs: 60 * 60_000,
      logger: { warn: vi.fn() },
      reconnectBaseIntervalMs: 60_000,
    });
    await conn.connect();
    sockets[0].autoPong = false;

    await vi.advanceTimersByTimeAsync(DINGTALK_STREAM_WS_PING_INTERVAL_MS);
    expect(sockets[0].pingCalls).toBe(1);
    expect(conn.state).toBe('connected');

    await vi.advanceTimersByTimeAsync(DINGTALK_STREAM_WS_PONG_TIMEOUT_MS - 1);
    expect(conn.state).toBe('connected');

    await vi.advanceTimersByTimeAsync(1);
    expect(conn.state).toBe('error');
    expect(sockets[0].terminated).toBe(true);
  });

  it('logs malformed frames instead of swallowing them', async () => {
    const warn = vi.fn();
    const sockets: MockSocket[] = [];
    const conn = create({
      WebSocketImpl: createWsCtor(sockets),
      logger: { warn },
    });
    await conn.connect();
    sockets[0].emit('message', 'not-json{');
    expect(warn).toHaveBeenCalledWith('DingTalk stream malformed frame', expect.anything());
  });
});
