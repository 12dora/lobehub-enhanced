// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
let capturedOptions: any;

vi.mock('@lobechat/chat-adapter-dingtalk', () => ({
  buildDingTalkForwardHeaders: ({ appId }: { appId: string }) => ({
    'x-lobe-dingtalk-forward': `hmac-${appId}`,
    'x-lobe-dingtalk-forward-ts': '1',
  }),
  DingTalkStreamConnection: vi.fn().mockImplementation((options: any) => {
    capturedOptions = options;
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
    };
  }),
}));

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/push', () => ({
  registerDingTalkMessengerPushProvider: vi.fn(),
}));

const writeDingTalkStreamStatus = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/services/messenger/platforms/dingtalk/redis', () => ({
  writeDingTalkStreamStatus: (...args: unknown[]) => writeDingTalkStreamStatus(...args),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { DingTalkStreamWorker } = await import('./dingtalkStreamWorker');

const VALID_CONFIG = {
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'secret',
  robotCode: 'robot_1',
};

beforeEach(() => {
  capturedOptions = undefined;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(VALID_CONFIG as any);
  mockConnect.mockClear();
  mockDisconnect.mockClear();
  writeDingTalkStreamStatus.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('DingTalkStreamWorker', () => {
  it('connects while enabled && chatEnabled and writes status JSON', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(writeDingTalkStreamStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'connecting' }),
    );
  });

  it('retries a failed first connect on the next tick without a config change', async () => {
    mockConnect.mockRejectedValueOnce(new Error('gateway 401'));
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(worker.connectionForTest).toBeNull();
    expect(writeDingTalkStreamStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastError: 'gateway 401', state: 'error' }),
    );

    await worker.tickForTest();
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(worker.connectionForTest).not.toBeNull();

    // once open, later ticks do not re-create the connection
    await worker.tickForTest();
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('reconnects when credentials change', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue({
      ...VALID_CONFIG,
      clientSecret: 'rotated',
    } as any);
    await worker.tickForTest();

    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('stops the connection when chatEnabled becomes false and writes disabled', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue({
      ...VALID_CONFIG,
      chatEnabled: false,
    } as any);
    await worker.tickForTest();

    expect(mockDisconnect).toHaveBeenCalled();
    expect(writeDingTalkStreamStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'disabled' }),
    );
  });

  it('forwards robot messages to the messenger webhook and acks immediately', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();

    const ack = vi.fn();
    const payload = { conversationId: 'cid', msgId: 'm1', msgtype: 'text' };
    await capturedOptions.onRobotMessage(payload, ack);

    expect(ack).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/agent\/messenger\/webhooks\/dingtalk$/),
      expect.objectContaining({
        body: JSON.stringify(payload),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-DingTalk-Event': 'im.bot.message',
          'x-lobe-dingtalk-forward': expect.any(String),
          'x-lobe-dingtalk-forward-ts': expect.any(String),
        }),
        method: 'POST',
      }),
    );
  });

  it('forwards card callbacks with the adapter marker header', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    await capturedOptions.onCardCallback({ outTrackId: 'out_1', userId: 'staff_1' }, vi.fn());

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-DingTalk-Event': 'card.callback' }),
      }),
    );
  });
});
