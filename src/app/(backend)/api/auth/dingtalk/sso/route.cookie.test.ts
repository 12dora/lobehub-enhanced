// @vitest-environment node
import { makeSignature } from 'better-auth/crypto';
import { NextRequest } from 'next/server';
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

vi.mock('@/server/services/messenger/platforms/dingtalk/provision', () => ({
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

const { POST } = await import('./route');
const { DINGTALK_GETUSERINFO_URL, DINGTALK_LEGACY_TOKEN_URL, resetDingTalkSsoStateForTest } =
  await import('@/server/services/messenger/platforms/dingtalk/sso');

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

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('https://app.example.test/api/auth/dingtalk/sso', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
        ...headers,
      },
      method: 'POST',
    }),
  );

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
});

describe('POST /api/auth/dingtalk/sso cookie', () => {
  it('sets a Better Auth session cookie whose name and HMAC match ctx.authCookies / makeSignature', async () => {
    const response = await post({ code: 'auth-code', redirect: '/home' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, redirect: '/home' });

    const { auth } = await import('@/auth');
    const ctx = await auth.$context;
    const setCookie = response.headers
      .getSetCookie()
      .find((entry) => entry.startsWith(`${ctx.authCookies.sessionToken.name}=`));
    expect(setCookie).toBeTruthy();

    const [pair] = setCookie!.split(';');
    const eq = pair!.indexOf('=');
    const name = pair!.slice(0, eq);
    const value = pair!.slice(eq + 1);
    expect(name).toBe(ctx.authCookies.sessionToken.name);

    const dot = value.lastIndexOf('.');
    const token = value.slice(0, dot);
    const signature = value.slice(dot + 1);
    expect(token).toBe('session-token-1');
    expect(signature).toBe(await makeSignature(token, ctx.secret));
  });

  it('returns 429 when Redis eval reports the IP is over the window', async () => {
    mockRedisEval.mockResolvedValueOnce(11);

    const response = await post({ code: 'auth-code', redirect: '/home' });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
