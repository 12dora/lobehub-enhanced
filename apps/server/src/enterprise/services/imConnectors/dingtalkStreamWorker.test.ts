// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ModuleSettingsModule from '@/server/enterprise/services/moduleSettings';
import type * as TokenCacheModule from '@/server/services/messenger/platforms/dingtalk/tokenCache';

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
let capturedOptions: any;

const streamAccounting = vi.hoisted(() => ({
  recordDingTalkHttpCallSafely: vi.fn(),
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/tokenCache', async (importOriginal) => {
  const actual = await importOriginal<typeof TokenCacheModule>();
  return {
    ...actual,
    recordDingTalkHttpCallSafely: (method: string, url: string) => {
      streamAccounting.recordDingTalkHttpCallSafely(method, url);
    },
  };
});

const mockWebhookHandler = vi.fn();
const mockGetWebhookHandler = vi.fn(() => mockWebhookHandler);
const mockIsModuleEnabled = vi.hoisted(() => vi.fn(async (_id: string) => true));

vi.mock('@/server/enterprise/services/moduleSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof ModuleSettingsModule>();
  return {
    ...actual,
    isModuleEnabled: (id: string) => mockIsModuleEnabled(id),
  };
});

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return {
    ...actual,
    buildDingTalkForwardHeaders: vi.fn(actual.buildDingTalkForwardHeaders),
    DingTalkStreamConnection: vi.fn().mockImplementation((options: any) => {
      capturedOptions = options;
      return {
        connect: mockConnect,
        disconnect: mockDisconnect,
        lastFrameAt: 1_715_000_000_000,
      };
    }),
  };
});

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@/server/services/messenger', () => ({
  getMessengerRouter: () => ({
    getWebhookHandler: mockGetWebhookHandler,
  }),
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/push', () => ({
  registerDingTalkMessengerPushProvider: vi.fn(),
}));

const writeDingTalkStreamStatus = vi.fn().mockResolvedValue(undefined);
const rememberDingTalkCorpId = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/services/messenger/platforms/dingtalk/redis', () => ({
  rememberDingTalkCorpId: (...args: unknown[]) => rememberDingTalkCorpId(...args),
  writeDingTalkStreamStatus: (...args: unknown[]) => writeDingTalkStreamStatus(...args),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { buildDingTalkForwardHeaders, verifyDingTalkForwardHeaders } =
  await import('@lobechat/chat-adapter-dingtalk');
const { DingTalkStreamWorker } = await import('./dingtalkStreamWorker');

const VALID_CONFIG = {
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'secret',
  robotCode: 'robot_1',
};

const readRequest = async (request: Request) => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    body: await request.json(),
    headers,
    method: request.method,
    url: request.url,
  };
};

beforeEach(() => {
  mockIsModuleEnabled.mockImplementation(async () => true);
  capturedOptions = undefined;
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(VALID_CONFIG as any);
  mockConnect.mockReset();
  mockConnect.mockResolvedValue(undefined);
  mockDisconnect.mockClear();
  writeDingTalkStreamStatus.mockClear();
  rememberDingTalkCorpId.mockClear();
  mockWebhookHandler.mockReset();
  mockWebhookHandler.mockResolvedValue(new Response('ok', { status: 200 }));
  mockGetWebhookHandler.mockClear();
  vi.mocked(buildDingTalkForwardHeaders).mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DingTalkStreamWorker', () => {
  it('connects while enabled && chatEnabled and writes status JSON', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(writeDingTalkStreamStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFrameAt: null, state: 'connecting' }),
    );
    expect(writeDingTalkStreamStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastFrameAt: new Date(1_715_000_000_000).toISOString(),
      }),
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

  it('skips a tick while the previous is still running and does not queue', async () => {
    let release!: () => void;
    mockConnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const worker = new DingTalkStreamWorker();
    const first = worker.tickForTest();
    await vi.waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));

    const second = worker.tickForTest();
    await second;
    expect(mockConnect).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(worker.connectionForTest).not.toBeNull();
  });

  it('aborts an in-flight connect when config changes and reconnects', async () => {
    let rejectConnect!: (error: Error) => void;
    mockConnect.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectConnect = reject;
        }),
    );
    mockDisconnect.mockImplementationOnce(() => {
      rejectConnect(new Error('DingTalk stream disconnected before socket open'));
    });

    const worker = new DingTalkStreamWorker();
    const first = worker.tickForTest();
    await vi.waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));

    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue({
      ...VALID_CONFIG,
      chatEnabled: true,
      clientSecret: 'rotated',
    } as any);

    const second = worker.tickForTest();
    await Promise.all([first, second]);

    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(worker.connectionForTest).not.toBeNull();
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

  it('stops the connection when dingtalkChat turns off and writes disabled', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    mockIsModuleEnabled.mockImplementation(async (id: string) => id !== 'dingtalkChat');
    await worker.tickForTest();

    expect(mockDisconnect).toHaveBeenCalled();
    expect(writeDingTalkStreamStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'disabled' }),
    );
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

  it('dispatches robot messages in-process with forward-auth headers and acks immediately', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();

    const ack = vi.fn();
    const payload = { conversationId: 'cid', msgId: 'm1', msgtype: 'text' };
    await capturedOptions.onRobotMessage(payload, ack);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    expect(ack).toHaveBeenCalled();
    expect(buildDingTalkForwardHeaders).toHaveBeenCalledWith({
      appId: 'app_key',
      clientSecret: 'secret',
    });
    expect(mockGetWebhookHandler).toHaveBeenCalledWith('dingtalk');
    expect(mockWebhookHandler).toHaveBeenCalledTimes(1);

    const request = mockWebhookHandler.mock.calls[0][0] as Request;
    const forwarded = await readRequest(request);
    expect(forwarded.method).toBe('POST');
    expect(forwarded.url).toMatch(/\/api\/agent\/messenger\/webhooks\/dingtalk$/);
    expect(forwarded.body).toEqual(payload);
    expect(forwarded.headers['content-type']).toBe('application/json');
    expect(forwarded.headers['x-dingtalk-event']).toBe('im.bot.message');
    expect(
      verifyDingTalkForwardHeaders(request.headers, {
        appId: 'app_key',
        clientSecret: 'secret',
      }),
    ).toBe(true);
  });

  it('writes chatbotCorpId ?? senderCorpId to Redis on each inbound robot message', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();

    await capturedOptions.onRobotMessage(
      {
        chatbotCorpId: 'corp_from_bot',
        conversationId: 'cid',
        msgId: 'm1',
        msgtype: 'text',
        senderCorpId: 'corp_from_sender',
      },
      vi.fn(),
    );
    expect(rememberDingTalkCorpId).toHaveBeenCalledWith('corp_from_bot');

    rememberDingTalkCorpId.mockClear();
    await capturedOptions.onRobotMessage(
      {
        conversationId: 'cid',
        msgId: 'm2',
        msgtype: 'text',
        senderCorpId: 'corp_from_sender',
      },
      vi.fn(),
    );
    expect(rememberDingTalkCorpId).toHaveBeenCalledWith('corp_from_sender');

    rememberDingTalkCorpId.mockClear();
    await capturedOptions.onRobotMessage(
      { conversationId: 'cid', msgId: 'm3', msgtype: 'text' },
      vi.fn(),
    );
    expect(rememberDingTalkCorpId).not.toHaveBeenCalled();
  });

  it('does not capture corpId from card callbacks', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    await capturedOptions.onCardCallback(
      { corpId: 'corp_card', outTrackId: 'out_1', userId: 'staff_1' },
      vi.fn(),
    );
    expect(rememberDingTalkCorpId).not.toHaveBeenCalled();
  });

  it('forwards card callbacks with the adapter marker header', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    await capturedOptions.onCardCallback({ outTrackId: 'out_1', userId: 'staff_1' }, vi.fn());

    expect(mockGetWebhookHandler).toHaveBeenCalledWith('dingtalk');
    const request = mockWebhookHandler.mock.calls[0][0] as Request;
    expect(request.headers.get('X-DingTalk-Event')).toBe('card.callback');
  });

  it('warns when the in-process handler returns 401 because the frame is already acked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockWebhookHandler.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();
    await capturedOptions.onRobotMessage({ msgId: 'm1', msgtype: 'text' }, vi.fn());

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/webhook handler returned 401.*unauthorized/),
    );
    warn.mockRestore();
  });

  it('counts the stream gateway open on the connection', async () => {
    const worker = new DingTalkStreamWorker();
    await worker.tickForTest();

    expect(capturedOptions.onRequest).toBeTypeOf('function');
    capturedOptions.onRequest({
      method: 'POST',
      url: 'https://api.dingtalk.com/v1.0/gateway/connections/open',
    });
    expect(streamAccounting.recordDingTalkHttpCallSafely).toHaveBeenCalledWith(
      'POST',
      'https://api.dingtalk.com/v1.0/gateway/connections/open',
    );
  });
});
