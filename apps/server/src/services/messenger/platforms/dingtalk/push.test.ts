// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendOtoMessage = vi.fn();
const mockFindByPlatform = vi.fn();
const mockFindById = vi.fn();
const mockIncr = vi.fn();
const mockExpire = vi.fn();
const mockResolveDingTalkBrandingDisplayName = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    DingTalkApiClient: vi.fn().mockImplementation(() => ({ sendOtoMessage })),
  };
});

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation(() => ({
    findByPlatform: mockFindByPlatform,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({ expire: mockExpire, incr: mockIncr })),
}));

vi.mock('./branding', () => ({
  resolveDingTalkBrandingDisplayName: (...args: unknown[]) =>
    mockResolveDingTalkBrandingDisplayName(...args),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { resetMessengerPushProvidersForTest } = await import('../../push');
const { dingtalkMessengerPushProvider, registerDingTalkMessengerPushProvider } =
  await import('./push');

const VALID_CONFIG = {
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'app_secret',
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  pushEnabled: true,
  robotCode: 'robot_1',
};

beforeEach(() => {
  resetMessengerPushProvidersForTest();
  registerDingTalkMessengerPushProvider();
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(VALID_CONFIG as any);
  mockFindByPlatform.mockResolvedValue({ platformUserId: 'staff_1' });
  mockFindById.mockResolvedValue(undefined);
  sendOtoMessage.mockResolvedValue({});
  mockIncr.mockResolvedValue(1);
  mockExpire.mockResolvedValue(1);
  mockResolveDingTalkBrandingDisplayName.mockResolvedValue('AI平台');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DingTalkMessengerPushProvider', () => {
  it('skips when the connector is disabled', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce(null);
    const result = await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: { markdown: 'hi', title: 't' },
      userId: 'user_1',
    });
    expect(result).toEqual({ reason: 'platform_disabled', status: 'skipped' });
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('skips when pushEnabled is false', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce({
      ...VALID_CONFIG,
      pushEnabled: false,
    } as any);
    const result = await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: { markdown: 'hi', title: 't' },
      userId: 'user_1',
    });
    expect(result).toEqual({ reason: 'push_disabled', status: 'skipped' });
  });

  it('skips when the user is not mapped', async () => {
    mockFindByPlatform.mockResolvedValueOnce(undefined);
    mockFindById.mockResolvedValueOnce({ email: 'other@example.com' });
    const result = await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: { markdown: 'hi', title: 't' },
      userId: 'user_1',
    });
    expect(result).toEqual({ reason: 'user_not_mapped', status: 'skipped' });
  });

  it('sends sampleActionCard with branding label, SSO URL, and exact msgParam', async () => {
    const result = await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: {
        actionLabel: '打开',
        actionUrl: '/task/1',
        markdown: 'body',
        title: '提醒',
      },
      userId: 'user_1',
    });

    expect(result).toEqual({ status: 'sent' });
    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleActionCard',
      msgParam: JSON.stringify({
        title: '提醒',
        text: 'body',
        singleTitle: '在AI平台中查看',
        singleURL: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
      }),
      robotCode: 'robot_1',
      userIds: ['staff_1'],
    });
    const param = JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, unknown>;
    expect(param).not.toHaveProperty('actionTitle2');
    expect(param).not.toHaveProperty('actionURL2');
    expect(mockIncr).toHaveBeenCalled();
  });

  it('wraps an absolute same-origin actionUrl through the SSO bridge', async () => {
    await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: {
        actionUrl: 'https://app.example.com/task/1',
        markdown: 'body',
        title: '提醒',
      },
      userId: 'user_1',
    });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleActionCard',
        msgParam: JSON.stringify({
          title: '提醒',
          text: 'body',
          singleTitle: '在AI平台中查看',
          singleURL: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
        }),
      }),
    );
  });

  it('uses the branding fallback label when the display name is empty', async () => {
    mockResolveDingTalkBrandingDisplayName.mockResolvedValueOnce('AI 平台');
    await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: {
        actionUrl: '/task/1',
        markdown: 'body',
        title: '提醒',
      },
      userId: 'user_1',
    });
    const param = JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, string>;
    expect(param.singleTitle).toBe('在AI 平台中查看');
  });

  it('sends sampleMarkdown when there is no actionUrl', async () => {
    await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: { markdown: 'body', title: '提醒' },
      userId: 'user_1',
    });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgKey: 'sampleMarkdown' }),
    );
  });

  it('resolves staffId from the identity-email prefix when no link exists', async () => {
    mockFindByPlatform.mockResolvedValueOnce(undefined);
    mockFindById.mockResolvedValueOnce({ email: 'staff_9@dingtalk.jiefakj.com' });
    await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: { markdown: 'body', title: 't' },
      userId: 'user_1',
    });
    expect(sendOtoMessage.mock.calls[0][0].userIds).toEqual(['staff_9']);
  });
});
