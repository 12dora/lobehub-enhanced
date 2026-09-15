// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendOtoMessage = vi.fn();
const sendBySessionWebhook = vi.fn();
const createClient = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('@lobechat/chat-adapter-dingtalk', () => ({
  buildActionCardParam: vi.fn().mockImplementation((options: any) => ({
    msgKey: 'sampleActionCard2',
    msgParam: JSON.stringify({ title: options.title, text: options.text }),
  })),
  decodeDingTalkThreadId: (threadId: string) => {
    const rest = threadId.startsWith('dingtalk:') ? threadId.slice('dingtalk:'.length) : threadId;
    return { conversationId: rest };
  },
  DingTalkApiClient: vi.fn().mockImplementation(() => ({
    sendBySessionWebhook,
    sendOtoMessage,
  })),
  getDingTalkSession: vi.fn().mockReturnValue(undefined),
  isSessionWebhookLive: vi.fn().mockReturnValue(false),
}));

vi.mock('@/server/services/bot/platforms/dingtalk/client', () => ({
  DingTalkClientFactory: vi.fn().mockImplementation(() => ({ createClient })),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { MessengerDingTalkBinder } = await import('./binder');

const VALID_CONFIG = {
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'app_secret',
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  pushEnabled: true,
  robotCode: 'robot_1',
  selectCardTemplateId: null,
};

beforeEach(() => {
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(VALID_CONFIG as any);
  sendOtoMessage.mockResolvedValue({});
  sendBySessionWebhook.mockResolvedValue(undefined);
  createClient.mockReturnValue({ id: 'client' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerDingTalkBinder.sendDmText', () => {
  it('sends oTo batchSend with sampleText {content}', async () => {
    const binder = new MessengerDingTalkBinder();
    await binder.sendDmText('staff_1', 'hello');

    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: 'hello' }),
      robotCode: 'robot_1',
      userIds: ['staff_1'],
    });
  });

  it('no-ops when dingtalk is not configured', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce(null);
    await new MessengerDingTalkBinder().sendDmText('staff_1', 'hello');
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });
});

describe('MessengerDingTalkBinder.createClient', () => {
  it('builds a client via DingTalkClientFactory', async () => {
    const client = await new MessengerDingTalkBinder().createClient();
    expect(client).toEqual({ id: 'client' });
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app_key',
        credentials: { clientSecret: 'app_secret' },
        platform: 'dingtalk',
      }),
      { appUrl: 'https://app.example.com' },
    );
  });
});
