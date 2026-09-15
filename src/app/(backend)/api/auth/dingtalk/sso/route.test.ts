// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const exchangeDingTalkSso = vi.hoisted(() => vi.fn());
const serializeDingTalkSsoSessionCookie = vi.hoisted(() =>
  vi.fn(
    (cookie: { name: string; value: string }) =>
      `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax; Secure`,
  ),
);

vi.mock('@/server/services/messenger/platforms/dingtalk/sso', () => ({
  exchangeDingTalkSso,
  serializeDingTalkSsoSessionCookie,
}));

const cookie = {
  attributes: {
    httpOnly: true,
    maxAge: 604800,
    path: '/',
    sameSite: 'lax' as const,
    secure: true,
  },
  name: '__Secure-better-auth.session_token',
  value: 'session-token-1.signature',
};

const post = (body: unknown, ip = '203.0.113.10') =>
  POST(
    new NextRequest('https://app.example.test/api/auth/dingtalk/sso', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
      },
      method: 'POST',
    }),
  );

beforeEach(() => {
  exchangeDingTalkSso.mockReset();
  serializeDingTalkSsoSessionCookie.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/dingtalk/sso', () => {
  it('sets the session cookie header and echoes the redirect', async () => {
    exchangeDingTalkSso.mockResolvedValueOnce({ cookie, ok: true, redirect: '/home' });

    const response = await post({ code: 'auth-code', redirect: '/home' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, redirect: '/home' });
    expect(response.headers.getSetCookie().some((entry) => entry.includes(cookie.name))).toBe(true);
    expect(serializeDingTalkSsoSessionCookie).toHaveBeenCalledWith(cookie);
  });

  it('maps unknown user to 404', async () => {
    exchangeDingTalkSso.mockResolvedValueOnce({ ok: false, reason: 'user_not_found' });

    const response = await post({ code: 'auth-code', redirect: '/home' });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'user_not_found' });
  });

  it('maps a bad redirect to 400', async () => {
    exchangeDingTalkSso.mockResolvedValueOnce({ ok: false, reason: 'bad_redirect' });

    const response = await post({ code: 'auth-code', redirect: 'https://evil.test/' });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'bad_redirect' });
  });

  it('maps rate limiting to 429', async () => {
    exchangeDingTalkSso.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });

    const response = await post({ code: 'auth-code', redirect: '/home' });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('maps disabled to 404-style JSON', async () => {
    exchangeDingTalkSso.mockResolvedValueOnce({ ok: false, reason: 'disabled' });

    const response = await post({ code: 'auth-code', redirect: '/home' });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'disabled' });
  });
});
