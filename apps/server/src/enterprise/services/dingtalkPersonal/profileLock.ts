import { createHash, randomBytes } from 'node:crypto';

import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { DingtalkPersonalError } from './errors';

const log = debug('lobe-server:dingtalk-personal');

/** Redis lock lifetime. Long enough for a broker logout (45s) plus the claim. */
export const DINGTALK_PERSONAL_PROFILE_LOCK_TTL_MS = 60_000;
export const DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS = 200;
export const DINGTALK_PERSONAL_PROFILE_LOCK_WAIT_MS = 15_000;

const RELEASE_PROFILE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

interface ProfileLockRedis {
  del: (key: string) => Promise<number>;
  eval?: (script: string, numKeys: number, ...args: string[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    exclusive: 'NX',
  ) => Promise<'OK' | null | string>;
}

interface LockSlot {
  depth: number;
  tail: Promise<void>;
}

const slots = new Map<string, LockSlot>();

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let nowFn: () => number = () => Date.now();
let sleepFn: (ms: number) => Promise<void> = defaultSleep;
let retryMs = DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS;
let waitMs = DINGTALK_PERSONAL_PROFILE_LOCK_WAIT_MS;

export const setDingtalkPersonalProfileLockTimingForTest = (
  timing: {
    now?: () => number;
    retryMs?: number;
    sleep?: (ms: number) => Promise<void>;
    waitMs?: number;
  } | null,
): void => {
  nowFn = timing?.now ?? (() => Date.now());
  sleepFn = timing?.sleep ?? defaultSleep;
  retryMs = timing?.retryMs ?? DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS;
  waitMs = timing?.waitMs ?? DINGTALK_PERSONAL_PROFILE_LOCK_WAIT_MS;
};

export const resetDingtalkPersonalProfileLockForTest = (): void => {
  slots.clear();
  setDingtalkPersonalProfileLockTimingForTest(null);
};

/** sha256 prefix only — the raw corpId:staffId never becomes a Redis key. */
export const dingtalkPersonalProfileLockKey = (profile: string): string => {
  const digest = createHash('sha256').update(profile).digest('hex').slice(0, 24);
  return `dingtalk-personal:profile-lock:${digest}`;
};

export const dingtalkPersonalProfileLockDepthForTest = (profile: string): number =>
  slots.get(dingtalkPersonalProfileLockKey(profile))?.depth ?? 0;

const readRedis = (): ProfileLockRedis | null => {
  try {
    const client = getAgentRuntimeRedisClient();
    return client ? (client as unknown as ProfileLockRedis) : null;
  } catch {
    return null;
  }
};

const withMemoryLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const previous = slots.get(key)?.tail ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  const depth = (slots.get(key)?.depth ?? 0) + 1;
  slots.set(key, { depth, tail });
  try {
    await previous;
    return await fn();
  } finally {
    release();
    // No `return` in here: it would swallow fn's error and replace its result.
    const current = slots.get(key);
    if (current?.tail === tail) slots.delete(key);
    else if (current) current.depth = Math.max(0, current.depth - 1);
  }
};

const acquireRedis = async (
  redis: ProfileLockRedis,
  key: string,
  token: string,
): Promise<'down' | 'ok'> => {
  const started = nowFn();
  let responded = false;
  let attempts = 0;
  const maxAttempts = Math.ceil(waitMs / Math.max(retryMs, 1)) + 1;
  for (;;) {
    attempts += 1;
    try {
      const result = await redis.set(key, token, 'PX', DINGTALK_PERSONAL_PROFILE_LOCK_TTL_MS, 'NX');
      responded = true;
      if (result === 'OK') return 'ok';
    } catch {
      // A client that cannot answer the first command is down. Later errors
      // mean the lock is still contested, so keep waiting and fail closed.
      if (!responded) return 'down';
    }
    const elapsed = nowFn() - started;
    if (elapsed >= waitMs || attempts > maxAttempts) {
      log('profile lock wait exceeded for %s', key);
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_TIMEOUT');
    }
    await sleepFn(Math.min(retryMs, Math.max(0, waitMs - elapsed)));
  }
};

const releaseRedis = async (redis: ProfileLockRedis, key: string, token: string): Promise<void> => {
  try {
    if (typeof redis.eval === 'function') {
      await redis.eval(RELEASE_PROFILE_LOCK_SCRIPT, 1, key, token);
      return;
    }
  } catch {
    // EVAL missing or rejected — compare-and-delete below.
  }
  try {
    const current = await redis.get(key);
    if (current === token) await redis.del(key);
  } catch {
    // The PX ttl drops a lock this process could not release.
  }
};

const runLocked = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const redis = readRedis();
  if (!redis) return fn();
  const token = randomBytes(16).toString('hex');
  const acquired = await acquireRedis(redis, key, token);
  if (acquired === 'down') return fn();
  try {
    return await fn();
  } finally {
    await releaseRedis(redis, key, token);
  }
};

/**
 * Mutex for one DingTalk profile, shared by revoke and login claim.
 * Callers in this process queue on an in-process chain. When Redis is up,
 * the holder also sets NX PX and deletes the key only if the token matches.
 */
export const withDingtalkPersonalProfileLock = async <T>(
  profile: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const key = dingtalkPersonalProfileLockKey(profile);
  return withMemoryLock(key, () => runLocked(key, fn));
};
