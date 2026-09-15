// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DINGTALK_JSAPI_SRC,
  DINGTALK_SSO_DIAG_ENDPOINT,
  type DingTalkJsApi,
  readRedirectParam,
  runDingTalkSso,
  sanitizeRedirect,
  sendDingTalkSsoDiag,
} from './bridge';

const loadScript = () => Promise.resolve();
const sendDiag = vi.fn();

const ddInside = (code = 'auth-code'): DingTalkJsApi => ({
  env: { platform: 'android' },
  ready: (callback) => callback(),
  runtime: { permission: { requestAuthCode: ({ onSuccess }) => onSuccess?.({ code }) } },
});

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  ({ json: () => Promise.resolve(body), ok, status }) as unknown as Response;

const configOk = () => jsonResponse({ corpId: 'ding-corp', enabled: true });

/** config + exchange, the two calls of a happy run. */
const happyFetch = (redirect = '/tasks/42') =>
  vi
    .fn()
    .mockResolvedValueOnce(configOk())
    .mockResolvedValueOnce(jsonResponse({ ok: true, redirect }));

const diagCalls = (stage?: string) =>
  sendDiag.mock.calls
    .map(([diag]) => diag as Record<string, unknown>)
    .filter((diag) => stage === undefined || diag.stage === stage);

beforeEach(() => {
  document.head.innerHTML = '';
  sendDiag.mockReset();
  // Nothing in this suite may reach the network, not even a fire-and-forget beacon.
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    '/%2f%2fevil.example',
    '/foo\r\nSet-Cookie: x',
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

describe('sendDingTalkSsoDiag', () => {
  it('posts a keepalive beacon that carries no auth code', () => {
    const fetchImpl = vi.fn().mockResolvedValue(undefined);

    sendDingTalkSsoDiag(
      { jsapi: 'getAuthCode', message: 'boom', platform: 'ios', stage: 'authcode_failed' },
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(DINGTALK_SSO_DIAG_ENDPOINT);
    expect(init).toMatchObject({ keepalive: true, method: 'POST' });
    expect(JSON.parse(init.body)).toEqual({
      jsapi: 'getAuthCode',
      message: 'boom',
      platform: 'ios',
      stage: 'authcode_failed',
    });
  });

  it('truncates long fields to 200 characters', () => {
    const fetchImpl = vi.fn().mockResolvedValue(undefined);

    sendDingTalkSsoDiag(
      { message: 'x'.repeat(500), stage: 'exchange_failed' },
      fetchImpl as unknown as typeof fetch,
    );

    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).message).toHaveLength(200);
  });

  it('swallows a rejected or throwing transport', () => {
    expect(() =>
      sendDingTalkSsoDiag({ stage: 'timeout' }, (() => {
        throw new Error('blocked');
      }) as unknown as typeof fetch),
    ).not.toThrow();

    expect(() =>
      sendDingTalkSsoDiag(
        { stage: 'timeout' },
        vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
      ),
    ).not.toThrow();
  });
});

describe('runDingTalkSso', () => {
  it('appends the pinned DingTalk JSAPI build', () => {
    // No `loadScript` injection here — this asserts the real loader's script tag, which is what
    // a CSP `script-src` has to allow.
    void runDingTalkSso({ fetchImpl: vi.fn() as unknown as typeof fetch, redirect: '/', sendDiag });

    expect(document.querySelector(`script[src="${DINGTALK_JSAPI_SRC}"]`)).toBeTruthy();
  });

  it('falls back when the JSAPI cannot be loaded', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadScript: () => Promise.reject(new Error('blocked')),
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'script_load_failed', status: 'fallback' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(diagCalls()).toEqual([
      { jsapi: undefined, message: 'blocked', platform: undefined, stage: 'script_load_failed' },
    ]);
  });

  it('falls back outside the DingTalk client without asking the server anything', async () => {
    const fetchImpl = vi.fn();

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: () => ({ env: { platform: 'notInDingTalk' } }),
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'not_in_dingtalk', status: 'fallback' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(diagCalls('not_in_dingtalk')[0]).toMatchObject({ platform: 'notInDingTalk' });
  });

  it('falls back when the global never appears', async () => {
    await expect(
      runDingTalkSso({
        fetchImpl: vi.fn() as unknown as typeof fetch,
        getDd: () => undefined,
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'not_in_dingtalk', status: 'fallback' });
    expect(diagCalls('not_in_dingtalk')[0]).toMatchObject({ message: 'no_dd_global' });
  });

  it('falls back when the config endpoint answers non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'config_failed', status: 'fallback' });
    expect(diagCalls('config_failed')[0]).toMatchObject({ message: 'http_503' });
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
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'config_disabled', status: 'fallback' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(diagCalls('config_disabled')[0]).toMatchObject({ message: 'disabled' });
  });

  it('falls back when no CorpId is known yet', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ corpId: null, enabled: true }));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'config_disabled', status: 'fallback' });
    expect(diagCalls('config_disabled')[0]).toMatchObject({ message: 'no_corp_id' });
  });

  describe('dd.ready', () => {
    it('does not ask for a code until ready fires', async () => {
      let fireReady: (() => void) | undefined;
      const getAuthCode = vi.fn(() => Promise.resolve({ code: 'ready-code' }));
      const fetchImpl = happyFetch();

      const outcome = runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: () => ({
          env: { platform: 'android' },
          getAuthCode,
          ready: (callback) => {
            fireReady = callback;
          },
        }),
        loadScript,
        redirect: '/tasks',
        sendDiag,
      });

      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      expect(getAuthCode).not.toHaveBeenCalled();

      fireReady!();
      await expect(outcome).resolves.toEqual({
        redirect: '/tasks/42',
        stage: 'success',
        status: 'signed-in',
      });
      expect(getAuthCode).toHaveBeenCalledTimes(1);
    });

    it('gives up with ready_timeout when ready never fires', async () => {
      const getAuthCode = vi.fn();
      const fetchImpl = vi.fn().mockResolvedValue(configOk());

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({ env: { platform: 'ios' }, getAuthCode, ready: () => {} }),
          loadScript,
          readyTimeoutMs: 10,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toEqual({ redirect: '/tasks', stage: 'ready_timeout', status: 'fallback' });
      expect(getAuthCode).not.toHaveBeenCalled();
      expect(diagCalls('ready_timeout')[0]).toMatchObject({
        message: 'ready_not_fired',
        platform: 'ios',
      });
    });

    it('proceeds when the build has no dd.ready at all', async () => {
      const fetchImpl = happyFetch();

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({
            env: { platform: 'android' },
            runtime: {
              permission: { requestAuthCode: ({ onSuccess }) => onSuccess?.({ code: 'legacy' }) },
            },
          }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toMatchObject({ stage: 'success', status: 'signed-in' });
    });

    it('reports a dd.ready that throws synchronously', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(configOk());

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({
            env: { platform: 'ios' },
            ready: () => {
              throw new Error('ready_boom');
            },
          }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toMatchObject({ stage: 'ready_timeout', status: 'fallback' });
      expect(diagCalls('ready_timeout')[0]).toMatchObject({ message: 'ready_boom' });
    });
  });

  describe('auth code', () => {
    it('prefers getAuthCode when it returns a promise', async () => {
      const fetchImpl = happyFetch();

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({
            env: { platform: 'android' },
            getAuthCode: ({ corpId }) => {
              expect(corpId).toBe('ding-corp');
              return Promise.resolve({ code: 'promise-code' });
            },
            ready: (callback) => callback(),
            runtime: { permission: { requestAuthCode: () => expect.unreachable() } },
          }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toMatchObject({ stage: 'success', status: 'signed-in' });

      expect(JSON.parse(fetchImpl.mock.calls[1]![1].body).code).toBe('promise-code');
      expect(diagCalls('success')[0]).toMatchObject({ jsapi: 'getAuthCode', platform: 'android' });
    });

    it('accepts the onSuccess callback style of getAuthCode', async () => {
      const fetchImpl = happyFetch();

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({
            env: { platform: 'ios' },
            getAuthCode: ({ onSuccess }) => {
              onSuccess?.({ code: 'callback-code' });
            },
            ready: (callback) => callback(),
          }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toMatchObject({ stage: 'success', status: 'signed-in' });

      expect(JSON.parse(fetchImpl.mock.calls[1]![1].body).code).toBe('callback-code');
    });

    it('reports the DingTalk error code when getAuthCode fails', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(configOk());

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({
            env: { platform: 'ios' },
            getAuthCode: ({ onFail }) => {
              onFail?.({ errorCode: '3', errorMessage: 'no permission' });
            },
            ready: (callback) => callback(),
            // Not tried: an answered-and-refused getAuthCode is a real answer, not an absence.
            runtime: { permission: { requestAuthCode: () => expect.unreachable() } },
          }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toEqual({ redirect: '/tasks', stage: 'authcode_failed', status: 'fallback' });
      expect(diagCalls('authcode_failed')[0]).toMatchObject({
        jsapi: 'getAuthCode',
        message: '3: no permission',
      });
      // The exchange must not be attempted without a code.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('falls back to requestAuthCode when getAuthCode throws synchronously', async () => {
      const fetchImpl = happyFetch();

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({
            env: { platform: 'android' },
            getAuthCode: () => {
              throw new TypeError('dd.getAuthCode is not implemented');
            },
            ready: (callback) => callback(),
            runtime: {
              permission: {
                requestAuthCode: ({ onSuccess }) => onSuccess?.({ code: 'legacy-code' }),
              },
            },
          }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toMatchObject({ stage: 'success', status: 'signed-in' });

      expect(JSON.parse(fetchImpl.mock.calls[1]![1].body).code).toBe('legacy-code');
      expect(diagCalls('success')[0]).toMatchObject({ jsapi: 'requestAuthCode' });
    });

    it('falls back to requestAuthCode when getAuthCode is absent', async () => {
      const fetchImpl = happyFetch();

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ddInside('legacy-only'),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toMatchObject({ stage: 'success', status: 'signed-in' });

      expect(JSON.parse(fetchImpl.mock.calls[1]![1].body).code).toBe('legacy-only');
      expect(diagCalls('success')[0]).toMatchObject({ jsapi: 'requestAuthCode' });
    });

    it('falls back when neither JSAPI exists', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(configOk());

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({ env: { platform: 'ios' } }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toEqual({ redirect: '/tasks', stage: 'authcode_failed', status: 'fallback' });
      expect(diagCalls('authcode_failed')[0]).toMatchObject({ message: 'jsapi_unavailable' });
    });

    it('falls back when the user refuses the JSAPI permission', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(configOk());

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ({
            env: { platform: 'ios' },
            ready: (callback) => callback(),
            runtime: {
              permission: { requestAuthCode: ({ onFail }) => onFail?.({ errorCode: 3 }) },
            },
          }),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toEqual({ redirect: '/tasks', stage: 'authcode_failed', status: 'fallback' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(diagCalls('authcode_failed')[0]).toMatchObject({ jsapi: 'requestAuthCode' });
    });

    it('treats an empty code as a failure', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(configOk());

      await expect(
        runDingTalkSso({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getDd: () => ddInside(''),
          loadScript,
          redirect: '/tasks',
          sendDiag,
        }),
      ).resolves.toMatchObject({ stage: 'authcode_failed', status: 'fallback' });
      expect(diagCalls('authcode_failed')[0]).toMatchObject({ message: 'empty_auth_code' });
    });
  });

  it('exchanges the auth code and follows the redirect the server answers with', async () => {
    const fetchImpl = happyFetch();

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: () => ddInside('code-42'),
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks/42', stage: 'success', status: 'signed-in' });

    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/auth/dingtalk/sso/config');
    const exchange = fetchImpl.mock.calls[1]!;
    expect(exchange[0]).toBe('/api/auth/dingtalk/sso');
    expect(exchange[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(exchange[1].body)).toEqual({ code: 'code-42', redirect: '/tasks' });
    // Exactly one beacon per run, and it never carries the code.
    expect(diagCalls()).toHaveLength(1);
    expect(JSON.stringify(diagCalls()[0])).not.toContain('code-42');
  });

  it('refuses an off-origin redirect handed back by the server', async () => {
    const fetchImpl = happyFetch('https://evil.example');

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/', stage: 'success', status: 'signed-in' });
  });

  it('falls back to / when the exchange rejects the redirect with 400', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(configOk())
      .mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'bad_redirect' }, false, 400));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/', stage: 'exchange_failed', status: 'fallback' });
    expect(diagCalls('exchange_failed')[0]).toMatchObject({ message: 'bad_redirect' });
  });

  it('falls back when the exchange is rejected, reporting reason and detail', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(configOk())
      .mockResolvedValueOnce(
        jsonResponse({ detail: '40078', ok: false, reason: 'exchange_failed' }),
      );

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'exchange_failed', status: 'fallback' });
    expect(diagCalls('exchange_failed')[0]).toMatchObject({
      jsapi: 'requestAuthCode',
      message: 'exchange_failed: 40078',
    });
  });

  it('falls back when the network drops mid-exchange', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(configOk())
      .mockRejectedValueOnce(new Error('offline'));

    await expect(
      runDingTalkSso({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getDd: ddInside,
        loadScript,
        redirect: '/tasks',
        sendDiag,
      }),
    ).resolves.toEqual({ redirect: '/tasks', stage: 'exchange_failed', status: 'fallback' });
    expect(diagCalls('exchange_failed')[0]).toMatchObject({ message: 'offline' });
  });
});
