// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probeDingTalkCredentials } from './dingtalkProbe';

const jsonResponse = (body: unknown, status = 200) =>
  ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as const;

describe('probeDingTalkCredentials', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok when DingTalk issues an access token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ accessToken: 'tok', expireIn: 7200 }));

    const result = await probeDingTalkCredentials({
      clientId: 'app-key',
      clientSecret: 'app-secret',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.dingtalk.com/v1.0/oauth2/accessToken',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const init = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit | undefined]>)[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ appKey: 'app-key', appSecret: 'app-secret' });
    expect(result).toMatchObject({
      errorCode: null,
      errorMessage: null,
      ok: true,
      robotName: null,
    });
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('maps invalid appKey/secret codes to auth_failed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 'invalidParameter.idOrSecret.notFound', message: 'invalid' }, 400),
    );

    const result = await probeDingTalkCredentials({
      clientId: 'bad',
      clientSecret: 'bad',
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('auth_failed');
    expect(result.errorMessage).toBe('invalid');
    expect(result.robotName).toBeNull();
  });

  it('maps fetch failures to network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await probeDingTalkCredentials({
      clientId: 'app',
      clientSecret: 'secret',
      fetchImpl,
    });

    expect(result).toMatchObject({
      errorCode: 'network',
      errorMessage: 'fetch failed',
      ok: false,
      robotName: null,
    });
  });

  it('maps AbortError timeouts to network', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    });

    const result = await probeDingTalkCredentials({
      clientId: 'app',
      clientSecret: 'secret',
      fetchImpl,
    });

    expect(result.errorCode).toBe('network');
    expect(result.errorMessage).toBe('timeout');
    expect(result.ok).toBe(false);
  });

  it('maps unrecognized DingTalk codes to unknown', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 'InternalError', message: 'busy' }, 500),
    );

    const result = await probeDingTalkCredentials({
      clientId: 'app',
      clientSecret: 'secret',
      fetchImpl,
    });

    expect(result.errorCode).toBe('unknown');
    expect(result.errorMessage).toBe('busy');
    expect(result.ok).toBe(false);
  });

  it('always returns robotName null (no official robot-name endpoint)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ accessToken: 'tok' }));

    const result = await probeDingTalkCredentials({
      clientId: 'app',
      clientSecret: 'secret',
      fetchImpl,
    });

    expect(result.robotName).toBeNull();
  });
});
