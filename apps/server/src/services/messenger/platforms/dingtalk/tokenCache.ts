import { createHash, randomUUID } from 'node:crypto';

import {
  DingTalkApiClient,
  type DingTalkApiClientOptions,
  type DingTalkCachedToken,
  type DingTalkTokenCache,
  type DingTalkTokenKind,
  setDingTalkStreamRequestHook,
} from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import { recordDingtalkHttpCall } from '@/server/enterprise/services/dingtalkWorkspace/apiCallStats';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:messenger:dingtalk:token-cache');

/** Drop the token this long before DingTalk's `expires_in` / `expireIn`. */
export const DINGTALK_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
/** Short NX lock so two processes don't both refresh. */
export const DINGTALK_TOKEN_LOCK_TTL_SECONDS = 8;
export const DINGTALK_TOKEN_LOCK_WAIT_MS = 50;
export const DINGTALK_TOKEN_LOCK_WAIT_MAX_MS = 2_000;

const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Cache identity is the credential pair, not the AppKey alone. AppKey is a
 * public client id; keying only on it let a caller with the org AppKey and
 * any secret read the org token.
 */
export const hashDingTalkCredential = (appKey: string, appSecret: string): string =>
  createHash('sha256').update(`${appKey}\0${appSecret}`).digest('hex');

/** Redis key: sha256(appKey + NUL + appSecret) + token kind. Raw credentials stay out of the key. */
export const dingtalkAppTokenRedisKey = (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
): string => `messenger:dingtalk:app-token:${hashDingTalkCredential(appKey, appSecret)}:${kind}`;

const lockKeyFor = (appKey: string, appSecret: string, kind: DingTalkTokenKind): string =>
  `messenger:dingtalk:app-token-lock:${hashDingTalkCredential(appKey, appSecret)}:${kind}`;

const scopeKeyFor = (appKey: string, appSecret: string, kind: DingTalkTokenKind): string =>
  `${hashDingTalkCredential(appKey, appSecret)}:${kind}`;

const memory = new Map<string, DingTalkCachedToken>();
const inflight = new Map<string, Promise<unknown>>();

const memoryKey = (appKey: string, appSecret: string, kind: DingTalkTokenKind): string =>
  `${hashDingTalkCredential(appKey, appSecret)}:${kind}`;

export const resetSharedDingTalkTokenCacheForTest = (): void => {
  memory.clear();
  inflight.clear();
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const ttlMsFor = (expiresInSec: number): number =>
  Math.max(0, expiresInSec * 1000 - DINGTALK_TOKEN_REFRESH_SKEW_MS);

const parseStored = (raw: string | null, now: number): DingTalkCachedToken | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { expiresAt?: unknown; token?: unknown };
    const token = typeof parsed.token === 'string' ? parsed.token : '';
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0;
    if (!token || expiresAt <= now) return null;
    return { expiresAt, token };
  } catch {
    return null;
  }
};

const readMemory = (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
  now: number,
): DingTalkCachedToken | null => {
  const hit = memory.get(memoryKey(appKey, appSecret, kind));
  if (!hit || hit.expiresAt <= now) return null;
  return hit;
};

const writeMemory = (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
  entry: DingTalkCachedToken,
): void => {
  memory.set(memoryKey(appKey, appSecret, kind), entry);
};

/**
 * Best-effort counter. Never throws and never awaits Redis (the recorder
 * already fires the increment in the background).
 */
export const recordDingTalkHttpCallSafely = (method: string, url: string): void => {
  try {
    recordDingtalkHttpCall(method, url);
  } catch (error) {
    log('recordDingTalkHttpCallSafely failed: %O', error);
  }
};

export const readSharedDingTalkTokenEntry = async (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
  now = Date.now(),
): Promise<DingTalkCachedToken | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(dingtalkAppTokenRedisKey(appKey, appSecret, kind));
      const parsed = parseStored(typeof raw === 'string' ? raw : null, now);
      if (parsed) {
        writeMemory(appKey, appSecret, kind, parsed);
        return parsed;
      }
    } catch (error) {
      log('readSharedDingTalkToken redis failed: %O', error);
    }
  }
  return readMemory(appKey, appSecret, kind, now);
};

export const readSharedDingTalkToken = async (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
  now = Date.now(),
): Promise<string | null> =>
  (await readSharedDingTalkTokenEntry(appKey, appSecret, kind, now))?.token ?? null;

export const writeSharedDingTalkToken = async (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
  token: string,
  expiresInSec: number,
  now = Date.now(),
): Promise<void> => {
  const ttlMs = ttlMsFor(expiresInSec);
  if (ttlMs <= 0 || !token) return;
  const entry = { expiresAt: now + ttlMs, token };
  writeMemory(appKey, appSecret, kind, entry);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
  try {
    await redis.set(
      dingtalkAppTokenRedisKey(appKey, appSecret, kind),
      JSON.stringify(entry),
      'EX',
      ttlSeconds,
    );
  } catch (error) {
    log('writeSharedDingTalkToken redis failed: %O', error);
  }
};

/** Write an absolute expiry (notify-app keeps its existing capped TTL). */
export const writeSharedDingTalkTokenAt = async (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
  token: string,
  expiresAt: number,
  now = Date.now(),
): Promise<void> => {
  const ttlMs = expiresAt - now;
  if (ttlMs <= 0 || !token) return;
  writeMemory(appKey, appSecret, kind, { expiresAt, token });
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
  try {
    await redis.set(
      dingtalkAppTokenRedisKey(appKey, appSecret, kind),
      JSON.stringify({ expiresAt, token }),
      'EX',
      ttlSeconds,
    );
  } catch (error) {
    log('writeSharedDingTalkTokenAt redis failed: %O', error);
  }
};

export const invalidateSharedDingTalkToken = async (
  appKey: string,
  appSecret: string,
  kind: DingTalkTokenKind,
): Promise<void> => {
  memory.delete(memoryKey(appKey, appSecret, kind));
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(dingtalkAppTokenRedisKey(appKey, appSecret, kind));
  } catch (error) {
    log('invalidateSharedDingTalkToken redis failed: %O', error);
  }
};

const acquireLock = async (
  lockKey: string,
): Promise<
  { status: 'acquired'; token: string } | { status: 'held' } | { status: 'unavailable' }
> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return { status: 'unavailable' };
  const token = randomUUID();
  try {
    const result = await redis.set(lockKey, token, 'EX', DINGTALK_TOKEN_LOCK_TTL_SECONDS, 'NX');
    return result === 'OK' ? { status: 'acquired', token } : { status: 'held' };
  } catch (error) {
    log('acquire token lock failed: %O', error);
    return { status: 'unavailable' };
  }
};

const releaseLock = async (lockKey: string, token: string): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
  } catch (error) {
    log('release token lock failed: %O', error);
  }
};

const waitAndReread = async <T>(reread: () => Promise<T | undefined>): Promise<T | undefined> => {
  const started = Date.now();
  while (Date.now() - started < DINGTALK_TOKEN_LOCK_WAIT_MAX_MS) {
    const hit = await reread();
    if (hit !== undefined) return hit;
    await sleep(DINGTALK_TOKEN_LOCK_WAIT_MS);
  }
  return reread();
};

/**
 * In-process promise dedupe plus a short Redis NX lock. Waiters re-read the
 * cache instead of fetching. Redis errors fall through to `run`.
 * `scopeKey` / `lockKey` must include the credential hash — callers with a
 * different secret must not join this flight.
 */
export const withDingTalkTokenSingleFlight = <T>(params: {
  lockKey: string;
  reread: () => Promise<T | undefined>;
  run: () => Promise<T>;
  scopeKey: string;
}): Promise<T> => {
  const existing = inflight.get(params.scopeKey);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    const again = await params.reread();
    if (again !== undefined) return again;
    const lock = await acquireLock(params.lockKey);
    if (lock.status === 'held') {
      const waited = await waitAndReread(params.reread);
      if (waited !== undefined) return waited;
    }
    try {
      return await params.run();
    } finally {
      if (lock.status === 'acquired') await releaseLock(params.lockKey, lock.token);
    }
  })().finally(() => {
    if (inflight.get(params.scopeKey) === promise) inflight.delete(params.scopeKey);
  });
  inflight.set(params.scopeKey, promise);
  return promise;
};

export const getOrRefreshSharedDingTalkToken = async (params: {
  appKey: string;
  appSecret: string;
  kind: DingTalkTokenKind;
  now?: number;
  refresh: () => Promise<{ expiresInSec: number; token: string }>;
  /**
   * Credential probes. Fetch with the presented secret and do not read the
   * cache or join an in-flight refresh (that flight may belong to another
   * secret, or may succeed before this secret has been checked).
   */
  skipCache?: boolean;
}): Promise<string> => {
  const now = () => params.now ?? Date.now();
  if (params.skipCache) {
    const fresh = await params.refresh();
    await writeSharedDingTalkToken(
      params.appKey,
      params.appSecret,
      params.kind,
      fresh.token,
      fresh.expiresInSec,
      now(),
    );
    return fresh.token;
  }
  const hit = await readSharedDingTalkToken(params.appKey, params.appSecret, params.kind, now());
  if (hit) return hit;
  return withDingTalkTokenSingleFlight({
    lockKey: lockKeyFor(params.appKey, params.appSecret, params.kind),
    reread: async () =>
      (await readSharedDingTalkToken(params.appKey, params.appSecret, params.kind, now())) ??
      undefined,
    run: async () => {
      const fresh = await params.refresh();
      await writeSharedDingTalkToken(
        params.appKey,
        params.appSecret,
        params.kind,
        fresh.token,
        fresh.expiresInSec,
        now(),
      );
      return fresh.token;
    },
    scopeKey: scopeKeyFor(params.appKey, params.appSecret, params.kind),
  });
};

export const createDingTalkRedisTokenCache = (
  appKey: string,
  appSecret: string,
): DingTalkTokenCache => ({
  delete: (kind) => invalidateSharedDingTalkToken(appKey, appSecret, kind),
  get: async (kind) => {
    const now = Date.now();
    const token = await readSharedDingTalkToken(appKey, appSecret, kind, now);
    if (!token) return null;
    return readMemory(appKey, appSecret, kind, now);
  },
  set: async (kind, token, ttlMs) => {
    if (ttlMs <= 0) return;
    const expiresInSec = Math.ceil((ttlMs + DINGTALK_TOKEN_REFRESH_SKEW_MS) / 1000);
    await writeSharedDingTalkToken(appKey, appSecret, kind, token, expiresInSec);
  },
});

export const createDingTalkApiClientOptions = (
  appKey: string,
  appSecret: string,
): DingTalkApiClientOptions => {
  const tokenCache = createDingTalkRedisTokenCache(appKey, appSecret);
  return {
    onRequest: (info) => {
      recordDingTalkHttpCallSafely(info.method, info.url);
    },
    singleFlight: (kind, task) =>
      withDingTalkTokenSingleFlight({
        lockKey: lockKeyFor(appKey, appSecret, kind),
        reread: async () => {
          const hit = await tokenCache.get(kind);
          return hit?.token;
        },
        run: task,
        scopeKey: scopeKeyFor(appKey, appSecret, kind),
      }),
    tokenCache,
  };
};

/** Counting hook only — no shared token cache and no shared single-flight. */
const uncachedDingTalkApiClientOptions = (): DingTalkApiClientOptions => ({
  onRequest: (info) => {
    recordDingTalkHttpCallSafely(info.method, info.url);
  },
});

const clients = new Map<string, DingTalkApiClient>();

const clientMapKey = (appKey: string, appSecret: string, robotCode: string): string =>
  createHash('sha256').update(`${appKey}\0${appSecret}\0${robotCode}`).digest('hex');

/**
 * One client per appKey + appSecret + robotCode. A different secret never
 * reuses this client or its token cache. `uncached` is for credential tests:
 * a fresh client that does not read the cache or join an in-flight refresh.
 */
export const sharedDingTalkApiClient = (params: {
  appKey: string;
  appSecret: string;
  robotCode: string;
  uncached?: boolean;
}): DingTalkApiClient => {
  if (params.uncached) {
    return new DingTalkApiClient(
      params.appKey,
      params.appSecret,
      uncachedDingTalkApiClientOptions(),
    );
  }
  const key = clientMapKey(params.appKey, params.appSecret, params.robotCode);
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new DingTalkApiClient(
    params.appKey,
    params.appSecret,
    createDingTalkApiClientOptions(params.appKey, params.appSecret),
  );
  clients.set(key, client);
  return client;
};

export const resetSharedDingTalkApiClientsForTest = (): void => {
  clients.clear();
};

/** Register the stream-gateway counter. Safe to call more than once. */
export const installDingTalkRequestAccounting = (): void => {
  setDingTalkStreamRequestHook((info) => {
    recordDingTalkHttpCallSafely(info.method, info.url);
  });
};

installDingTalkRequestAccounting();
