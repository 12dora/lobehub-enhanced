// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendOtoMessage = vi.fn();
const mockFindByPlatform = vi.fn();
const mockFindById = vi.fn();
const mockIncr = vi.fn();
const mockExpire = vi.fn();
const mockRedisGet = vi.fn();
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
  getAgentRuntimeRedisClient: vi.fn(() => ({
    expire: mockExpire,
    get: mockRedisGet,
    incr: mockIncr,
  })),
}));

vi.mock('./branding', () => ({
  resolveDingTalkBrandingDisplayName: (...args: unknown[]) =>
    mockResolveDingTalkBrandingDisplayName(...args),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { resetMessengerPushProvidersForTest } = await import('../../push');
const {
  buildDingTalkOpenAppUrl,
  dingtalkMessengerPushProvider,
  registerDingTalkMessengerPushProvider,
} = await import('./push');

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
  mockRedisGet.mockResolvedValue(null);
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

  it('does not double-wrap an already-SSO relative redirect', async () => {
    await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: {
        actionUrl: '/dingtalk/sso?redirect=%2Ftask%2F1',
        markdown: 'body',
        title: '提醒',
      },
      userId: 'user_1',
    });
    const param = JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, string>;
    expect(sendOtoMessage.mock.calls[0][0].msgKey).toBe('sampleActionCard');
    expect(param.singleURL).toBe('https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1');
    expect(param.singleURL).not.toContain('redirect=%2Fdingtalk%2Fsso');
  });

  it('does not double-wrap an already-SSO same-origin absolute URL', async () => {
    await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: {
        actionUrl: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
        markdown: 'body',
        title: '提醒',
      },
      userId: 'user_1',
    });
    const param = JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, string>;
    expect(param.singleURL).toBe('https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1');
  });

  it('omits the button for a protocol-relative actionUrl', async () => {
    const result = await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: {
        actionUrl: '//evil.example/phish',
        markdown: 'body',
        title: '提醒',
      },
      userId: 'user_1',
    });
    expect(result).toEqual({ status: 'sent' });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgKey: 'sampleMarkdown' }),
    );
    const param = JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, unknown>;
    expect(JSON.stringify(param)).not.toContain('evil.example');
  });

  it('omits the button for a cross-origin already-SSO actionUrl', async () => {
    await dingtalkMessengerPushProvider.pushToUser({
      db: {} as any,
      message: {
        actionUrl: 'https://evil.example/dingtalk/sso?redirect=https://evil.example',
        markdown: 'body',
        title: '提醒',
      },
      userId: 'user_1',
    });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgKey: 'sampleMarkdown' }),
    );
    const param = JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, unknown>;
    expect(JSON.stringify(param)).not.toContain('evil.example');
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

describe('buildDingTalkOpenAppUrl', () => {
  it('builds a work_platform openapp URL with urlencoded redirect_url', () => {
    const httpsSso = 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1';
    expect(
      buildDingTalkOpenAppUrl({
        agentId: '4617854000',
        corpId: 'ding42',
        url: httpsSso,
      }),
    ).toBe(
      `dingtalk://dingtalkclient/action/openapp?corpid=ding42&container_type=work_platform&app_id=0_4617854000&redirect_type=jump&redirect_url=${encodeURIComponent(httpsSso)}`,
    );
  });

  it('strips a pasted 0_ prefix so app_id is not 0_0_…', () => {
    const httpsSso = 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1';
    expect(
      buildDingTalkOpenAppUrl({
        agentId: '0_4617854000',
        corpId: 'ding42',
        url: httpsSso,
      }),
    ).toBe(
      `dingtalk://dingtalkclient/action/openapp?corpid=ding42&container_type=work_platform&app_id=0_4617854000&redirect_type=jump&redirect_url=${encodeURIComponent(httpsSso)}`,
    );
  });
});

describe('DingTalkMessengerPushProvider openapp deep link', () => {
  const HTTPS_SSO = 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1';

  it('uses the openapp deep link when agentId and settings.corpId are known', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce({
      ...VALID_CONFIG,
      agentId: '4617854000',
      corpId: 'ding42',
    } as any);

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
    expect(param.singleURL).toBe(
      buildDingTalkOpenAppUrl({
        agentId: '4617854000',
        corpId: 'ding42',
        url: HTTPS_SSO,
      }),
    );
    expect(param.singleURL.startsWith('dingtalk://dingtalkclient/action/openapp?')).toBe(true);
    expect(param.singleURL).toContain(`redirect_url=${encodeURIComponent(HTTPS_SSO)}`);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('uses Redis corpId when settings omit corpId but agentId is set', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce({
      ...VALID_CONFIG,
      agentId: '4617854000',
      corpId: null,
    } as any);
    mockRedisGet.mockResolvedValueOnce('ding-from-redis');

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
    expect(param.singleURL).toBe(
      buildDingTalkOpenAppUrl({
        agentId: '4617854000',
        corpId: 'ding-from-redis',
        url: HTTPS_SSO,
      }),
    );
    expect(mockRedisGet).toHaveBeenCalledWith('messenger:dingtalk:corp-id');
  });

  it('falls back to the plain https SSO url when agentId is missing', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce({
      ...VALID_CONFIG,
      agentId: null,
      corpId: 'ding42',
    } as any);

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
    expect(param.singleURL).toBe(HTTPS_SSO);
  });

  it('falls back to the plain https SSO url when corpId is unknown', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce({
      ...VALID_CONFIG,
      agentId: '4617854000',
      corpId: null,
    } as any);
    mockRedisGet.mockResolvedValueOnce(null);

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
    expect(param.singleURL).toBe(HTTPS_SSO);
  });
});
