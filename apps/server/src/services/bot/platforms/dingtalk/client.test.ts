import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateDingTalkAdapter = vi.hoisted(() => vi.fn());
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const mockGetAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue('tok'));
const mockGatewayStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGatewayClose = vi.hoisted(() => vi.fn());

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
  DingTalkWSConnection: vi.fn().mockImplementation(() => ({
    close: mockGatewayClose,
    start: mockGatewayStart,
  })),
}));

const { DingTalkClientFactory } = await import('./client');

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validateCredentials calls the token endpoint via DingTalkApiClient', async () => {
    const factory = new DingTalkClientFactory();
    const result = await factory.validateCredentials(
      { clientSecret: 'sec' },
      {},
      'app_key',
      'dingtalk',
    );
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
    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledWith(expect.anything(), raw);
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
});
