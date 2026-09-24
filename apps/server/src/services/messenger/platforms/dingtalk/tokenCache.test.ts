// @vitest-environment node
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisEval = vi.fn();
const mockGetRedis = vi.fn();

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => mockGetRedis(),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/apiCallStats', () => ({
  recordDingtalkHttpCall: vi.fn(),
}));

const {
  dingtalkAppTokenRedisKey,
  getOrRefreshSharedDingTalkToken,
  hashDingTalkCredential,
  readSharedDingTalkToken,
  resetSharedDingTalkApiClientsForTest,
  resetSharedDingTalkTokenCacheForTest,
  sharedDingTalkApiClient,
  withDingTalkTokenSingleFlight,
  writeSharedDingTalkToken,
} = await import('./tokenCache');

const redisStore = new Map<string, string>();

const installRedis = () => {
  mockGetRedis.mockReturnValue({
    del: mockRedisDel.mockImplementation(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
    eval: mockRedisEval.mockImplementation(async () => 1),
    get: mockRedisGet.mockImplementation(async (key: string) => redisStore.get(key) ?? null),
    set: mockRedisSet.mockImplementation(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return 'OK';
    }),
  });
};

beforeEach(() => {
  redisStore.clear();
  resetSharedDingTalkTokenCacheForTest();
  resetSharedDingTalkApiClientsForTest();
  mockRedisGet.mockReset();
  mockRedisSet.mockReset();
  mockRedisDel.mockReset();
  mockRedisEval.mockReset();
  mockGetRedis.mockReset();
  installRedis();
});

afterEach(() => {
  resetSharedDingTalkTokenCacheForTest();
  resetSharedDingTalkApiClientsForTest();
  vi.unstubAllGlobals();
});

const jsonFetch = (body: unknown, ok = true) => ({
  json: async () => body,
  ok,
  status: ok ? 200 : 400,
  text: async () => JSON.stringify(body),
});

describe('shared DingTalk token cache', () => {
  it('keys Redis by sha256(appKey + NUL + appSecret) and kind, with TTL = expires_in − 5 min', async () => {
    const now = 1_000_000;
    await writeSharedDingTalkToken('notify-key', 'notify-secret', 'gettoken', 'tok', 7200, now);
    const expectedKey = `messenger:dingtalk:app-token:${hashDingTalkCredential('notify-key', 'notify-secret')}:gettoken`;
    expect(dingtalkAppTokenRedisKey('notify-key', 'notify-secret', 'gettoken')).toBe(expectedKey);
    expect(expectedKey).toBe(
      `messenger:dingtalk:app-token:${createHash('sha256').update('notify-key\0notify-secret').digest('hex')}:gettoken`,
    );
    expect(expectedKey).not.toContain('notify-key');
    expect(expectedKey).not.toContain('notify-secret');
    expect(hashDingTalkCredential('notify-key', 'notify-secret')).toHaveLength(64);
    expect(hashDingTalkCredential('notify-key', 'notify-secret')).not.toBe(
      hashDingTalkCredential('notify-key', 'other-secret'),
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      expectedKey,
      expect.stringContaining('"token":"tok"'),
      'EX',
      7200 - 300,
    );
    await expect(
      readSharedDingTalkToken('notify-key', 'notify-secret', 'gettoken', now + 1),
    ).resolves.toBe('tok');
    await expect(
      readSharedDingTalkToken('notify-key', 'notify-secret', 'accessToken', now + 1),
    ).resolves.toBeNull();
    await expect(
      readSharedDingTalkToken('notify-key', 'other-secret', 'gettoken', now + 1),
    ).resolves.toBeNull();
  });

  it('does not share a cached token across secrets for the same appKey', async () => {
    const seen: string[] = [];
    const refresh = (secret: string) => async () => {
      seen.push(secret);
      return { expiresInSec: 7200, token: `tok-${secret}` };
    };
    const right = await getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'right',
      kind: 'accessToken',
      refresh: refresh('right'),
    });
    const wrong = await getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'wrong',
      kind: 'accessToken',
      refresh: refresh('wrong'),
    });
    expect(right).toBe('tok-right');
    expect(wrong).toBe('tok-wrong');
    expect(seen).toEqual(['right', 'wrong']);
    await expect(
      getOrRefreshSharedDingTalkToken({
        appKey: 'app',
        appSecret: 'wrong',
        kind: 'accessToken',
        refresh: refresh('wrong-again'),
      }),
    ).resolves.toBe('tok-wrong');
    expect(seen).toEqual(['right', 'wrong']);
  });

  it('does not join an in-flight refresh that presented a different secret', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const right = getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'right',
      kind: 'gettoken',
      refresh: async () => {
        await gate;
        return { expiresInSec: 7200, token: 'org-token' };
      },
    });
    const wrong = await getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'wrong',
      kind: 'gettoken',
      refresh: async () => ({ expiresInSec: 7200, token: 'attacker-token' }),
    });
    expect(wrong).toBe('attacker-token');
    release();
    await expect(right).resolves.toBe('org-token');
  });

  it('skipCache fetches on its own and does not join an in-flight refresh', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let skipFetches = 0;
    const pending = getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'sec',
      kind: 'accessToken',
      refresh: async () => {
        await gate;
        return { expiresInSec: 7200, token: 'inflight' };
      },
    });
    const skipped = await getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'sec',
      kind: 'accessToken',
      refresh: async () => {
        skipFetches += 1;
        return { expiresInSec: 7200, token: 'fresh' };
      },
      skipCache: true,
    });
    expect(skipped).toBe('fresh');
    expect(skipFetches).toBe(1);
    release();
    // The in-flight caller may re-read the cache after its lock and pick up the
    // token the uncached call just stored for the same key + secret.
    await expect(pending).resolves.toMatch(/^(inflight|fresh)$/);
  });

  it('single-flights two concurrent refreshes into one fetch', async () => {
    let fetches = 0;
    const refresh = async () => {
      fetches += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 15);
      });
      return { expiresInSec: 7200, token: 'shared' };
    };
    const [a, b] = await Promise.all([
      getOrRefreshSharedDingTalkToken({
        appKey: 'app',
        appSecret: 'sec',
        kind: 'accessToken',
        refresh,
      }),
      getOrRefreshSharedDingTalkToken({
        appKey: 'app',
        appSecret: 'sec',
        kind: 'accessToken',
        refresh,
      }),
    ]);
    expect(a).toBe('shared');
    expect(b).toBe('shared');
    expect(fetches).toBe(1);
  });

  it('waits on a held Redis lock and re-reads instead of fetching', async () => {
    const lockKey = 'messenger:dingtalk:app-token-lock:test';
    redisStore.set(lockKey, 'other-process');
    let fetches = 0;
    const writeLater = (async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 30);
      });
      await writeSharedDingTalkToken('app', 'sec', 'gettoken', 'from-peer', 7200);
    })();
    const token = await withDingTalkTokenSingleFlight({
      lockKey,
      reread: async () => (await readSharedDingTalkToken('app', 'sec', 'gettoken')) ?? undefined,
      run: async () => {
        fetches += 1;
        return 'should-not-run';
      },
      scopeKey: 'lock-wait',
    });
    await writeLater;
    expect(token).toBe('from-peer');
    expect(fetches).toBe(0);
  });

  it('falls back to the in-process cache when Redis is unavailable', async () => {
    mockGetRedis.mockReturnValue(null);
    let fetches = 0;
    const token = await getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'sec',
      kind: 'gettoken',
      refresh: async () => {
        fetches += 1;
        return { expiresInSec: 7200, token: 'mem' };
      },
    });
    const again = await getOrRefreshSharedDingTalkToken({
      appKey: 'app',
      appSecret: 'sec',
      kind: 'gettoken',
      refresh: async () => {
        fetches += 1;
        return { expiresInSec: 7200, token: 'other' };
      },
    });
    expect(token).toBe('mem');
    expect(again).toBe('mem');
    expect(fetches).toBe(1);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('does not let a shared client with a different secret reuse the org token', async () => {
    const secrets: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { appSecret?: string };
        const secret = body.appSecret ?? '';
        secrets.push(secret);
        if (secret === 'wrong') {
          return jsonFetch({ code: 'InvalidAuthentication', message: 'bad secret' }, false);
        }
        return jsonFetch({ accessToken: `tok-${secret}`, expireIn: 7200 });
      }),
    );

    const right = sharedDingTalkApiClient({
      appKey: 'app',
      appSecret: 'right',
      robotCode: 'robot',
    });
    await expect(right.getAccessToken()).resolves.toBe('tok-right');

    const wrong = sharedDingTalkApiClient({
      appKey: 'app',
      appSecret: 'wrong',
      robotCode: 'robot',
    });
    await expect(wrong.getAccessToken()).rejects.toThrow(/InvalidAuthentication/);
    expect(secrets).toEqual(['right', 'wrong']);

    const uncached = sharedDingTalkApiClient({
      appKey: 'app',
      appSecret: 'right',
      robotCode: 'robot',
      uncached: true,
    });
    await expect(uncached.getAccessToken()).resolves.toBe('tok-right');
    expect(secrets).toEqual(['right', 'wrong', 'right']);
  });
});
