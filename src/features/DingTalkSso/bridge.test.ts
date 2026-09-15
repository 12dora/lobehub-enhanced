// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DINGTALK_JSAPI_SRC,
  type DingTalkJsApi,
  readRedirectParam,
  runDingTalkSso,
  sanitizeRedirect,
} from './bridge';

const loadScript = () => Promise.resolve();

const ddInside = (code = 'auth-code'): DingTalkJsApi => ({
  env: { platform: 'android' },
  runtime: { permission: { requestAuthCode: ({ onSuccess }) => onSuccess?.({ code }) } },
});

const jsonResponse = (body: unknown, ok = true) =>
  ({ json: () => Promise.resolve(body), ok }) as unknown as Response;

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('sanitizeRedirect', () => {
  it.each([
    ['/tasks', '/tasks'],
    ['/agent?id=1#top', '/agent?id=1#top'],
    ['/', '/'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(sanitizeRedirect(input)).toBe(expected);
  });

  it.each([
    // An open redirect is the whole risk here: the value arrives from a query string.
    '//evil.example/steal',
    String.raw`/\evil.example`,
    'https://evil.example',
    'javascript:alert(1)',
    'tasks',
    '',
  ])('refuses %s', (input) => {
    expect(sanitizeRedirect(input)).toBe('/');
  });

  it('refuses a missing or non-string value', () => {
    expect(sanitizeRedirect(null)).toBe('/');
    expect(sanitizeRedirect(undefined)).toBe('/');
  });

  it('reads the redirect out of a search string, defaulting to the root', () => {
    expect(readRedirectParam('?redirect=%2Ftasks%2F42')).toBe('/tasks/42');
    expect(readRedirectParam('?other=1')).toBe('/');
    expect(readRedirectParam('?redirect=https%3A%2F%2Fevil.example')).toBe('/');
  });
});

describe('runDingTalkSso', () => {
  it('appends the pinned DingTalk JSAPI build', () => {
    // No `loadScript` injection here — this asserts the real loader's script tag, which is what
    // a CSP `script-src` has to allow.
    void runDingTalkSso({ fetchImpl: vi.fn() as unknown as typeof fetch, redirect: '/' });

    expect(document.querySelector(`script[src="${DINGTALK_JSAPI_SRC}"]`)).toBeTruthy();
  });

  it('falls back when the JSAPI cannot be loaded', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadScript: () => Promise.reject(new Error('blocked')),
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back outside the DingTalk client without asking the server anything', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: () => ({ env: { platform: 'notInDingTalk' } }),
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back when the global never appears', async () => {
    await expect(
      runDingTalkSso({
        fetchImpl: vi.fn() as unknown as typeof fetch,
        getDd: () => undefined,
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
  });

  it('falls back when the connector is switched off', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ corpId: 'ding-corp', enabled: false }));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back when no CorpId is known yet', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ corpId: null, enabled: true }));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
  });

  it('falls back when the user refuses the JSAPI permission', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ corpId: 'ding-corp', enabled: true }));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: () => ({
          env: { platform: 'ios' },
          runtime: { permission: { requestAuthCode: ({ onFail }) => onFail?.({ errorCode: 3 }) } },
        }),
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
    // The exchange must not be attempted without a code.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exchanges the auth code and follows the redirect the server answers with', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ corpId: 'ding-corp', enabled: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, redirect: '/tasks/42' }));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: () => ddInside('code-42'),
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks/42', status: 'signed-in' });

    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/auth/dingtalk/sso/config');
    const exchange = fetchImpl.mock.calls[1]!;
    expect(exchange[0]).toBe('/api/auth/dingtalk/sso');
    expect(exchange[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(exchange[1].body)).toEqual({ code: 'code-42', redirect: '/tasks' });
  });

  it('refuses an off-origin redirect handed back by the server', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ corpId: 'ding-corp', enabled: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, redirect: 'https://evil.example' }));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/', status: 'signed-in' });
  });

  it('falls back when the exchange is rejected', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ corpId: 'ding-corp', enabled: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'user_not_found' }));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
  });

  it('falls back when the network drops mid-exchange', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ corpId: 'ding-corp', enabled: true }))
      .mockRejectedValueOnce(new Error('offline'));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
      }),
    ).resolves.toEqual({ redirect: '/tasks', status: 'fallback' });
  });
});
