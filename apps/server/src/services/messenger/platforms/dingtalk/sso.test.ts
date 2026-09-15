// @vitest-environment node
import { makeSignature } from 'better-auth/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMessengerDingTalkConfig = vi.fn();
const mockEnsureDingTalkUser = vi.fn();
const mockCreateSession = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisEval = vi.fn();

const AUTH_SECRET = 'test-auth-secret-that-is-long-enough-32b';
const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: (...args: unknown[]) => mockGetMessengerDingTalkConfig(...args),
}));

vi.mock('./provision', () => ({
  ensureDingTalkUser: (...args: unknown[]) => mockEnsureDingTalkUser(...args),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
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

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    json: async () => body,
    ok,
    status,
  }) as Response;

beforeEach(() => {
  resetDingTalkSsoStateForTest();
  vi.clearAllMocks();
  mockGetMessengerDingTalkConfig.mockResolvedValue(VALID_CONFIG);
  mockEnsureDingTalkUser.mockResolvedValue({ email: 'staff_1@dingtalk.jiefakj.com', id: 'user_1' });
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
    mockEnsureDingTalkUser.mockResolvedValueOnce(null);

    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ ok: false, reason: 'user_not_found' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('provisions a missing user then mints a session', async () => {
    mockEnsureDingTalkUser.mockResolvedValueOnce({
      email: 'staff_1@dingtalk.jiefakj.com',
      id: 'user_new',
    });

    const result = await exchangeDingTalkSso({
      code: 'auth-code',
      ip: '1.1.1.1',
      redirect: '/home',
    });
    expect(result.ok).toBe(true);
    expect(mockEnsureDingTalkUser).toHaveBeenCalledWith(expect.anything(), { staffId: 'staff_1' });
    expect(mockCreateSession).toHaveBeenCalledWith(
      'user_new',
      false,
      expect.objectContaining({ ipAddress: '1.1.1.1' }),
    );
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
    mockEnsureDingTalkUser.mockResolvedValueOnce({
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
    mockEnsureDingTalkUser.mockResolvedValueOnce({
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
    mockEnsureDingTalkUser.mockResolvedValueOnce({
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

  it.each([
    { errcode: 40078, errmsg: '不合法的临时授权码' },
    { errcode: 40014, errmsg: '不合法的access_token' },
  ])(
    'returns exchange_failed with detail and warns errcode/errmsg/status for requestAuthCode $errcode',
    async ({ errcode, errmsg }) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const secretCode = 'secret-jsapi-auth-code';
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = String(input);
          if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
            return jsonResponse({ access_token: 'legacy-token', errcode: 0 });
          }
          return jsonResponse({ errcode, errmsg });
        }),
      );

      await expect(
        exchangeDingTalkSso({ code: secretCode, ip: '1.1.1.1', redirect: '/home' }),
      ).resolves.toEqual({ detail: String(errcode), ok: false, reason: 'exchange_failed' });

      const logged = warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
      expect(logged).toContain('[dingtalk-sso] requestAuthCode');
      expect(logged).toContain('status=200');
      expect(logged).toContain(`errcode=${errcode}`);
      expect(logged).toContain(errmsg);
      expect(logged).not.toContain(secretCode);
      expect(logged).not.toContain('app_secret');
      expect(logged).not.toContain('legacy-token');
      warn.mockRestore();
    },
  );

  it('returns exchange_failed with detail and warns when gettoken returns 40014', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ errcode: 40014, errmsg: '不合法的access_token' })),
    );

    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ detail: '40014', ok: false, reason: 'exchange_failed' });

    const logged = warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(logged).toContain('[dingtalk-sso] gettoken');
    expect(logged).toContain('errcode=40014');
    expect(logged).toContain('不合法的access_token');
    expect(logged).not.toContain('app_secret');
    warn.mockRestore();
  });

  it('evicts the cached legacy token when getuserinfo returns 40014', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let gettokenCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
          gettokenCount += 1;
          return jsonResponse({ access_token: `legacy-token-${gettokenCount}`, errcode: 0 });
        }
        if (url.includes('access_token=legacy-token-1')) {
          return jsonResponse({ errcode: 40014, errmsg: '不合法的access_token' });
        }
        return jsonResponse({ errcode: 0, result: { userid: 'staff_1' } });
      }),
    );

    await expect(
      exchangeDingTalkSso({ code: 'auth-code', ip: '1.1.1.1', redirect: '/home' }),
    ).resolves.toEqual({ detail: '40014', ok: false, reason: 'exchange_failed' });
    expect(gettokenCount).toBe(1);

    const retry = await exchangeDingTalkSso({
      code: 'auth-code',
      ip: '1.1.1.2',
      redirect: '/home',
    });
    expect(retry.ok).toBe(true);
    expect(gettokenCount).toBe(2);
    expect(
      vi.mocked(fetch).mock.calls.some((call) => String(call[0]).includes('legacy-token-2')),
    ).toBe(true);
    warn.mockRestore();
  });
});

describe('DINGTALK_SSO_TWO_FACTOR_SESSION_PATH', () => {
  it('is an OAuth-callback path so the 2FA session gate allows 免登', () => {
    expect(DINGTALK_SSO_TWO_FACTOR_SESSION_PATH.startsWith('/callback/')).toBe(true);
  });
});
