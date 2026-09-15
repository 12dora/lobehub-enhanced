import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateDingTalkAdapter = vi.hoisted(() => vi.fn());
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const mockGetAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue('tok'));
const mockGatewayStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGatewayClose = vi.hoisted(() => vi.fn());
const mockGatewayState = vi.hoisted(() => ({ value: 'connected' as string }));
const mockGatewayCtorOptions = vi.hoisted(() => ({ last: undefined as any }));

vi.mock('@lobechat/chat-adapter-dingtalk', () => ({
  createDingTalkAdapter: mockCreateDingTalkAdapter,
  decodeDingTalkThreadId: (threadId: string) => {
    const rest = threadId.startsWith('dingtalk:') ? threadId.slice('dingtalk:'.length) : threadId;
    const last = rest.lastIndexOf(':');
    if (last === -1) return { conversationId: rest };
    return { conversationId: rest.slice(0, last), senderStaffId: rest.slice(last + 1) };
  },
  DingTalkApiClient: vi.fn().mockImplementation(() => ({
    getAccessToken: mockGetAccessToken,
    sendBySessionWebhook: vi.fn(),
    sendGroupMessage: vi.fn(),
    sendOtoMessage: vi.fn(),
  })),
  downloadMediaFromRawMessage: mockDownloadMediaFromRawMessage,
  getDingTalkSession: vi.fn(),
  isSessionWebhookLive: vi.fn().mockReturnValue(false),
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => String(e?.message ?? e),
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./gateway', () => ({
  DingTalkWSConnection: vi.fn().mockImplementation((options: any) => {
    mockGatewayCtorOptions.last = options;
    return {
      close: mockGatewayClose,
      start: mockGatewayStart,
      get state() {
        return mockGatewayState.value;
      },
    };
  }),
}));

vi.mock('chat', () => ({
  Chat: class {
    async initialize() {}
    async shutdown() {}
  },
  ConsoleLogger: class {},
}));

const { DingTalkClientFactory } = await import('./client');
const { DingTalkWSConnection } = await import('./gateway');
const { updateBotRuntimeStatus } = await import('@/server/services/gateway/runtimeStatus');

describe('DingTalkClientFactory', () => {
  const createClient = () =>
    new DingTalkClientFactory().createClient(
      {
        applicationId: 'app_key',
        credentials: { clientSecret: 'sec' },
        platform: 'dingtalk',
        settings: { robotCode: 'robot_1' },
      },
      { appUrl: 'https://example.com' },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayState.value = 'connected';
    mockGatewayStart.mockResolvedValue(undefined);
    mockCreateDingTalkAdapter.mockReturnValue({ name: 'dingtalk' });
    vi.mocked(DingTalkWSConnection).mockImplementation((options: any) => {
      mockGatewayCtorOptions.last = options;
      return {
        close: mockGatewayClose,
        start: mockGatewayStart,
        get state() {
          return mockGatewayState.value;
        },
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validateCredentials calls the token endpoint via DingTalkApiClient', async () => {
    const factory = new DingTalkClientFactory();
    const result = await factory.validateCredentials({ clientSecret: 'sec' }, {}, 'app_key');
    expect(mockGetAccessToken).toHaveBeenCalled();
    expect(result.valid).toBe(true);
  });

  it('extractFiles delegates to downloadMediaFromRawMessage', async () => {
    const buffer = Buffer.from('img');
    mockDownloadMediaFromRawMessage.mockResolvedValue([
      { buffer, mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' },
    ]);
    const client = createClient();
    const raw = {
      content: { downloadCode: 'dl' },
      msgId: 'm1',
      msgtype: 'picture',
      robotCode: 'robot_1',
    };
    const result = await client.extractFiles!({ id: 'm1', raw } as any);
    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledWith(
      expect.anything(),
      raw,
      expect.objectContaining({ warn: expect.any(Function) }),
    );
    expect(result).toEqual([
      { buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
    ]);
  });

  it('createAdapter exposes a dingtalk adapter', () => {
    mockCreateDingTalkAdapter.mockReturnValue({ name: 'dingtalk' });
    const client = createClient();
    const adapters = client.createAdapter();
    expect(adapters.dingtalk).toEqual({ name: 'dingtalk' });
    expect(mockCreateDingTalkAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'app_key',
        clientSecret: 'sec',
        robotCode: 'robot_1',
      }),
    );
  });

  it('start() records failed and throws when the first stream connect fails', async () => {
    mockGatewayStart.mockRejectedValueOnce(new Error('DingTalk gateway open failed: 401'));
    const client = createClient();
    await expect(client.start({ durationMs: 1000 })).rejects.toThrow(/401/);
    const statuses = vi.mocked(updateBotRuntimeStatus).mock.calls.map((call) => call[0].status);
    expect(statuses).toContain('starting');
    expect(statuses).toContain('failed');
    expect(statuses).not.toContain('connected');
  });

  it('start() wires onStateChange and does not mark connected unless the stream is connected', async () => {
    mockGatewayState.value = 'error';
    mockGatewayStart.mockResolvedValueOnce(undefined);
    const client = createClient();
    await expect(client.start({ durationMs: 1000 })).rejects.toThrow(/failed to connect/);
    const statuses = vi.mocked(updateBotRuntimeStatus).mock.calls.map((call) => call[0].status);
    expect(statuses).not.toContain('connected');
    expect(mockGatewayCtorOptions.last.onStateChange).toBeTypeOf('function');
  });
});
