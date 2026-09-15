// @vitest-environment node
import { makeSignature } from 'better-auth/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMessengerDingTalkConfig = vi.fn();
const mockFindByEmail = vi.fn();
const mockFindFirst = vi.fn();
const mockCreateSession = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisEval = vi.fn();

const AUTH_SECRET = 'test-auth-secret-that-is-long-enough-32b';
const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: (...args: unknown[]) => mockGetMessengerDingTalkConfig(...args),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findByEmail: (...args: unknown[]) => mockFindByEmail(...args) },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({
    query: { users: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
  })),
}));

vi.mock('@/database/schemas', () => ({
  users: { email: 'users.email' },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({
    eval: mockRedisEval,
    get: mockRedisGet,
  })),
}));

vi.mock('@/auth', () => ({
  auth: {
    $context: Promise.resolve({
      authCookies: {
        sessionToken: {
          attributes: {
            httpOnly: true,
            maxAge: SESSION_MAX_AGE,
            path: '/',
            sameSite: 'lax',
            secure: true,
          },
          name: SESSION_COOKIE_NAME,
        },
      },
      internalAdapter: { createSession: (...args: unknown[]) => mockCreateSession(...args) },
      secret: AUTH_SECRET,
    }),
  },
}));

const {
  DINGTALK_CORP_ID_KEY,
  DINGTALK_GETUSERINFO_URL,
  DINGTALK_LEGACY_TOKEN_URL,
  DINGTALK_SSO_RATE_LIMIT_MAX,
  DINGTALK_SSO_TWO_FACTOR_SESSION_PATH,
  exchangeDingTalkSso,
  getDingTalkSsoConfig,
  isSafeDingTalkSsoRedirect,
  resetDingTalkSsoStateForTest,
  serializeDingTalkSsoSessionCookie,
} = await import('./sso');

const VALID_CONFIG = {
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'app_secret',
  corpId: 'ding42',
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  pushEnabled: true,
  robotCode: 'robot_1',
  selectCardTemplateId: null,
};

const jsonResponse = (body: unknown, ok = true) =>
  ({
    json: async () => body,
    ok,
  }) as Response;

beforeEach(() => {
  resetDingTalkSsoStateForTest();
  vi.clearAllMocks();
  mockGetMessengerDingTalkConfig.mockResolvedValue(VALID_CONFIG);
  mockFindByEmail.mockResolvedValue({ email: 'staff_1@dingtalk.jiefakj.com', id: 'user_1' });
  mockFindFirst.mockResolvedValue(undefined);
  mockCreateSession.mockResolvedValue({ id: 'sess_1', token: 'session-token-1', userId: 'user_1' });
  mockRedisGet.mockResolvedValue(null);
  mockRedisEval.mockRejectedValue(new Error('use memory limiter'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
        return jsonResponse({ access_token: 'legacy-token', errcode: 0 });
      }
      if (url.startsWith(DINGTALK_GETUSERINFO_URL)) {
        return jsonResponse({ errcode: 0, result: { userid: 'staff_1' } });
      }
      return jsonResponse({ errcode: 1 }, false);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DINGTALK_IDENTITY_EMAIL_DOMAIN;
});

describe('isSafeDingTalkSsoRedirect', () => {
  it.each(['/home', '/dingtalk/sso?x=1', '/settings/messenger'])('accepts %s', (path) => {
    expect(isSafeDingTalkSsoRedirect(path)).toBe(true);
  });

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil',
    '/%2f%2fevil.example',
    'home',
    '',
    'javascript:alert(1)',
  ])('rejects %s', (path) => {
    expect(isSafeDingTalkSsoRedirect(path)).toBe(false);
  });
});

describe('getDingTalkSsoConfig', () => {
  it('reports disabled when the connector is missing', async () => {
    mockGetMessengerDingTalkConfig.mockResolvedValueOnce(null);
    await expect(getDingTalkSsoConfig()).resolves.toEqual({ enabled: false });
  });

  it('prefers corpId from connector settings', async () => {
    await expect(getDingTalkSsoConfig()).resolves.toEqual({ corpId: 'ding42', enabled: true });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('falls back to Redis messenger:dingtalk:corp-id when settings omit corpId', async () => {
    mockGetMessengerDingTalkConfig.mockResolvedValueOnce({ ...VALID_CONFIG, corpId: null });
    mockRedisGet.mockResolvedValueOnce('ding-from-redis');
    await expect(getDingTalkSsoConfig()).resolves.toEqual({
      corpId: 'ding-from-redis',
      enabled: true,
    });
    expect(mockRedisGet).toHaveBeenCalledWith(DINGTALK_CORP_ID_KEY);
  });
});

describe('exchangeDingTalkSso', () => {
  it('creates a Better Auth session cookie and echoes the redirect', async () => {
    const result = await exchangeDingTalkSso({
      code: 'auth-code',
      ip: '203.0.113.10',
      redirect: '/home',
      userAgent: 'DingTalk',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.redirect).toBe('/home');
    expect(result.cookie.name).toBe(SESSION_COOKIE_NAME);
    const expectedSig = await makeSignature('session-token-1', AUTH_SECRET);
    expect(result.cookie.value).toBe(`session-token-1.${expectedSig}`);
    expect(serializeDingTalkSsoSessionCookie(result.cookie)).toContain(
      `${SESSION_COOKIE_NAME}=session-token-1.`,
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      'user_1',
      false,
      expect.objectContaining({ ipAddress: '203.0.113.10', userAgent: 'DingTalk' }),
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining(`${DINGTALK_LEGACY_TOKEN_URL}?`),
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining(`${DINGTALK_GETUSERINFO_URL}?`),
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('appkey=app_key');
  });

  it('returns user_not_found without creating a session', async () => {
    mockFindByEmail.mockResolvedValueOnce(undefined);
    mockFindFirst.mockResolvedValueOnce(undefined);

    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ ok: false, reason: 'user_not_found' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a non-path redirect', async () => {
    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: 'https://evil.test/' }),
    ).resolves.toEqual({ ok: false, reason: 'bad_redirect' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns disabled when the connector is off', async () => {
    mockGetMessengerDingTalkConfig.mockResolvedValueOnce(null);
    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ ok: false, reason: 'disabled' });
  });

  it('rate limits after 10 attempts per IP per minute', async () => {
    for (let i = 0; i < DINGTALK_SSO_RATE_LIMIT_MAX; i += 1) {
      const result = await exchangeDingTalkSso({
        code: 'auth-code',
        ip: '198.51.100.9',
        redirect: '/home',
      });
      expect(result.ok).toBe(true);
    }
    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '198.51.100.9', redirect: '/home' }),
    ).resolves.toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('returns user_not_found for an effectively banned user without leaking ban', async () => {
    mockFindByEmail.mockResolvedValueOnce({
      banExpires: null,
      banned: true,
      email: 'staff_1@dingtalk.jiefakj.com',
      id: 'user_1',
    });

    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ ok: false, reason: 'user_not_found' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('mints a session when a temporary ban has expired', async () => {
    mockFindByEmail.mockResolvedValueOnce({
      banExpires: new Date(Date.now() - 1000),
      banned: true,
      email: 'staff_1@dingtalk.jiefakj.com',
      id: 'user_1',
    });

    const result = await exchangeDingTalkSso({
      code: 'auth-code',
      ip: '1.1.1.1',
      redirect: '/home',
    });
    expect(result.ok).toBe(true);
    expect(mockCreateSession).toHaveBeenCalled();
  });

  it('mints a session for a 2FA-enabled user (DingTalk 免登 is IdP-delegated)', async () => {
    mockFindByEmail.mockResolvedValueOnce({
      banExpires: null,
      banned: false,
      email: 'staff_1@dingtalk.jiefakj.com',
      id: 'user_1',
      twoFactorEnabled: true,
    });

    const result = await exchangeDingTalkSso({
      code: 'auth-code',
      ip: '1.1.1.1',
      redirect: '/home',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(mockCreateSession).toHaveBeenCalled();
  });

  it('maps a FORBIDDEN APIError from createSession to exchange_failed without throwing', async () => {
    const { APIError } = await import('better-auth/api');
    mockCreateSession.mockRejectedValueOnce(
      new APIError('FORBIDDEN', { code: 'TWO_FACTOR_REQUIRED', message: 'totp' }),
    );

    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ httpStatus: 403, ok: false, reason: 'exchange_failed' });
  });

  it('maps an unexpected createSession throw to exchange_failed 502', async () => {
    mockCreateSession.mockRejectedValueOnce(new Error('adapter down'));

    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ httpStatus: 502, ok: false, reason: 'exchange_failed' });
  });

  it('caches the legacy app token per clientId', async () => {
    await exchangeDingTalkSso({ code: 'auth-code', ip: '10.0.0.1', redirect: '/home' });
    await exchangeDingTalkSso({ code: 'auth-code', ip: '10.0.0.2', redirect: '/home' });
    const gettokenCalls = vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).startsWith(DINGTALK_LEGACY_TOKEN_URL));
    expect(gettokenCalls).toHaveLength(1);

    mockGetMessengerDingTalkConfig.mockResolvedValue({ ...VALID_CONFIG, clientId: 'other_key' });
    await exchangeDingTalkSso({ code: 'auth-code', ip: '10.0.0.3', redirect: '/home' });
    const after = vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).startsWith(DINGTALK_LEGACY_TOKEN_URL));
    expect(after).toHaveLength(2);
  });
});

describe('DINGTALK_SSO_TWO_FACTOR_SESSION_PATH', () => {
  it('is an OAuth-callback path so the 2FA session gate allows 免登', () => {
    expect(DINGTALK_SSO_TWO_FACTOR_SESSION_PATH.startsWith('/callback/')).toBe(true);
  });
});
