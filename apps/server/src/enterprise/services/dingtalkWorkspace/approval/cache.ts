import { randomUUID } from 'node:crypto';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { INSTANCE_DETAIL_CACHE_TTL_MS, SCAN_TIME_BUDGET_MS } from './types';

/** Reject a single JSON payload above this size instead of storing it. */
export const APPROVAL_CACHE_MAX_BYTES = 1_048_576;
/** In-process fallback cap used only while Redis is unavailable. */
export const APPROVAL_CACHE_MEMORY_LIMIT = 200;
/** Covers a full template scan so the lock outlives the work it guards. */
export const APPROVAL_SWEEP_LOCK_TTL_MS = SCAN_TIME_BUDGET_MS + 10_000;
/**
 * A waiter waits until the lock key is gone or this long has passed.
 * The bound matches the lock TTL (scan budget + 10 s). A 2 s poll let the
 * waiter start a second sweep and bump the epoch out from under the holder.
 */
export const APPROVAL_SWEEP_LOCK_WAIT_MS = APPROVAL_SWEEP_LOCK_TTL_MS;
export const APPROVAL_SWEEP_LOCK_POLL_MS = 200;

export type ApprovalSweepLockMode = 'refresh' | 'scan';

export type ApprovalSweepLock =
  | { kind: 'acquired'; release: () => Promise<void> }
  | { kind: 'busy'; mode: ApprovalSweepLockMode }
  | { kind: 'down' };

interface ApprovalRedis {
  del: (...keys: string[]) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  incr: (key: string) => Promise<number>;
  set: (
    key: string,
    value: string,
    expiryMode?: 'EX' | 'PX',
    ttl?: number,
    exclusive?: 'NX',
  ) => Promise<'OK' | null | string>;
}

interface MemoryEntry {
  expiresAt: number;
  value: unknown;
}

const EPOCH_KEY = 'dingtalk-approval:epoch';
const memory = new Map<string, MemoryEntry>();
const memoryGen = new Map<string, number>();
const memoryInstanceGen = new Map<string, number>();
const pendingBumps = new Map<string, Promise<void>>();
const pendingInstanceDeletes = new Map<string, Promise<void>>();

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      const unref = Reflect.get(timer, 'unref');
      if (typeof unref === 'function') unref.call(timer);
    }
  });

let sweepLockWaitMs = APPROVAL_SWEEP_LOCK_WAIT_MS;
let sweepLockPollMs = APPROVAL_SWEEP_LOCK_POLL_MS;
let sleepFn: (ms: number) => Promise<void> = defaultSleep;

const client = (): ApprovalRedis | null => {
  try {
    const redis = getAgentRuntimeRedisClient();
    return redis ? (redis as unknown as ApprovalRedis) : null;
  } catch {
    return null;
  }
};

const enc = (value: string): string => encodeURIComponent(value);

const genKey = (userId: string): string => `dingtalk-approval:gen:${enc(userId)}`;

const cacheKey = (
  epoch: string,
  userId: string,
  staffId: string,
  generation: string,
  suffix: string,
): string =>
  `dingtalk-approval:cache:${epoch}:${enc(userId)}:${enc(staffId)}:${generation}:${enc(suffix)}`;

const instanceKey = (processInstanceId: string): string =>
  `dingtalk-approval:instance:${enc(processInstanceId)}`;

/** Bumped on invalidate so a fetch that started earlier cannot write stale detail back. */
const instanceGenKey = (processInstanceId: string): string =>
  `dingtalk-approval:instance-gen:${enc(processInstanceId)}`;

export const approvalSweepLockKey = (userId: string, staffId: string): string =>
  `dingtalk-approval:sweep-lock:${enc(userId)}:${enc(staffId)}`;

const sweepEpochKey = (userId: string, staffId: string): string =>
  `dingtalk-approval:sweep-epoch:${enc(userId)}:${enc(staffId)}`;

const memoryKey = (userId: string, staffId: string, suffix: string): string =>
  `${userId}:${staffId}:${suffix}`;

const keyBelongsToUser = (key: string, userId: string): boolean =>
  key.startsWith(`${userId}:`) || key.includes(`:${userId}:`);

const dropMemoryForUser = (userId: string): void => {
  for (const key of memory.keys()) {
    if (keyBelongsToUser(key, userId)) memory.delete(key);
  }
};

const sweepExpiredMemory = (now: number): void => {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
};

const trimMemory = (): void => {
  while (memory.size > APPROVAL_CACHE_MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) return;
    memory.delete(oldest);
  }
};

const readMemory = <T>(
  userId: string,
  staffId: string,
  suffix: string,
  now: number,
): T | undefined => {
  const key = memoryKey(userId, staffId, suffix);
  const entry = memory.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    memory.delete(key);
    return undefined;
  }
  return entry.value as T;
};

const writeMemory = <T>(
  userId: string,
  staffId: string,
  suffix: string,
  value: T,
  ttlMs: number,
  now: number,
  generation: string,
): void => {
  if (String(memoryGen.get(userId) ?? 0) !== generation) return;
  sweepExpiredMemory(now);
  const key = memoryKey(userId, staffId, suffix);
  memory.delete(key);
  memory.set(key, { expiresAt: now + ttlMs, value });
  trimMemory();
};

const awaitPending = async (bucket: Map<string, Promise<void>>, id: string): Promise<void> => {
  const pending = bucket.get(id);
  if (pending) await pending;
};

const ttlSec = (ttlMs: number): number => Math.max(1, Math.ceil(ttlMs / 1000));

const payloadOf = (value: unknown): string | undefined => {
  try {
    const json = JSON.stringify(value);
    if (!json || json.length > APPROVAL_CACHE_MAX_BYTES) return undefined;
    return json;
  } catch {
    return undefined;
  }
};

/**
 * Generation captured before a DingTalk read. Pass it back to the matching write
 * so an invalidate that landed during the read cannot be overwritten.
 */
export const captureApprovalCacheGeneration = async (userId: string): Promise<string> => {
  await awaitPending(pendingBumps, userId);
  const redis = client();
  if (redis) {
    try {
      return (await redis.get(genKey(userId))) ?? '0';
    } catch {
      // Redis blip: the in-process generation still orders this process's writes.
    }
  }
  return String(memoryGen.get(userId) ?? 0);
};

export const readApprovalScopedCache = async <T>(
  userId: string,
  staffId: string,
  suffix: string,
  now: number,
): Promise<T | undefined> => {
  await awaitPending(pendingBumps, userId);
  const redis = client();
  if (redis) {
    try {
      const epoch = (await redis.get(EPOCH_KEY)) ?? '0';
      const generation = (await redis.get(genKey(userId))) ?? '0';
      const raw = await redis.get(cacheKey(epoch, userId, staffId, generation, suffix));
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    } catch {
      // Redis is down for this call. Serve the in-process copy if we still have one.
    }
  }
  return readMemory<T>(userId, staffId, suffix, now);
};

export const writeApprovalScopedCache = async <T>(input: {
  generation: string;
  now: number;
  staffId: string;
  suffix: string;
  ttlMs: number;
  userId: string;
  value: T;
}): Promise<void> => {
  const json = payloadOf(input.value);
  if (!json) return;
  await awaitPending(pendingBumps, input.userId);
  const redis = client();
  if (redis) {
    try {
      const epoch = (await redis.get(EPOCH_KEY)) ?? '0';
      const generation = (await redis.get(genKey(input.userId))) ?? '0';
      if (generation !== input.generation) return;
      await redis.set(
        cacheKey(epoch, input.userId, input.staffId, generation, input.suffix),
        json,
        'EX',
        ttlSec(input.ttlMs),
      );
      return;
    } catch {
      // Fall through and keep a process-local copy so the next read still hits.
    }
  }
  writeMemory(
    input.userId,
    input.staffId,
    input.suffix,
    input.value,
    input.ttlMs,
    input.now,
    input.generation,
  );
};

/**
 * Awaited generation bump. Refresh calls this before it captures a generation
 * so an in-flight list on another replica cannot write its rows back over the
 * refresh. Never throws.
 */
export const bumpApprovalUserGeneration = async (userId: string): Promise<void> => {
  try {
    const id = userId.trim();
    if (!id) return;
    await awaitPending(pendingBumps, id);
    memoryGen.set(id, (memoryGen.get(id) ?? 0) + 1);
    dropMemoryForUser(id);
    const redis = client();
    if (!redis) return;
    await redis.incr(genKey(id));
  } catch {
    // best-effort: a missed bump only lets a stale write land
  }
};

/** Drop one user's pending, initiated, template, and sweep entries. Never throws. */
export const invalidateApprovalUserCache = (userId: string): void => {
  try {
    const id = userId.trim();
    if (!id) return;
    memoryGen.set(id, (memoryGen.get(id) ?? 0) + 1);
    dropMemoryForUser(id);
    const redis = client();
    if (!redis) return;
    const task = redis
      .incr(genKey(id))
      .then(() => undefined)
      .catch(() => undefined);
    const prev = pendingBumps.get(id) ?? Promise.resolve();
    const next = prev.then(() => task);
    pendingBumps.set(id, next);
    void next.finally(() => {
      if (pendingBumps.get(id) === next) pendingBumps.delete(id);
    });
  } catch {
    // best-effort
  }
};

/** Drop every user's list cache. Instance details stay until their own invalidate or TTL. */
export const invalidateAllApprovalListCaches = (): void => {
  try {
    memory.clear();
    memoryGen.clear();
    const redis = client();
    if (!redis) return;
    void redis.incr(EPOCH_KEY).catch(() => undefined);
  } catch {
    // best-effort
  }
};

interface InstanceCacheEnvelope<T> {
  generation: string;
  value: T;
}

const parseInstanceEnvelope = <T>(raw: string): InstanceCacheEnvelope<T> | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<InstanceCacheEnvelope<T>>;
    if (!parsed || typeof parsed.generation !== 'string' || !('value' in parsed)) return undefined;
    return { generation: parsed.generation, value: parsed.value as T };
  } catch {
    return undefined;
  }
};

const readInstanceGeneration = async (id: string): Promise<string> => {
  const redis = client();
  if (redis) {
    try {
      return (await redis.get(instanceGenKey(id))) ?? '0';
    } catch {
      // Redis blip: the in-process generation still orders this process's writes.
    }
  }
  return String(memoryInstanceGen.get(id) ?? 0);
};

/**
 * Generation captured before a process-instance GET. Pass it to
 * {@link writeApprovalInstanceCache} so an invalidate during the fetch wins.
 */
export const captureApprovalInstanceGeneration = async (
  processInstanceId: string,
): Promise<string> => {
  const id = processInstanceId.trim();
  if (!id) return '0';
  await awaitPending(pendingInstanceDeletes, id);
  return readInstanceGeneration(id);
};

export const readApprovalInstanceCache = async <T>(
  processInstanceId: string,
): Promise<T | undefined> => {
  const id = processInstanceId.trim();
  if (!id) return undefined;
  await awaitPending(pendingInstanceDeletes, id);
  const redis = client();
  if (!redis) return undefined;
  try {
    const generation = await readInstanceGeneration(id);
    const raw = await redis.get(instanceKey(id));
    if (!raw) return undefined;
    const envelope = parseInstanceEnvelope<T>(raw);
    if (!envelope || envelope.generation !== generation) return undefined;
    return envelope.value;
  } catch {
    return undefined;
  }
};

export const writeApprovalInstanceCache = async (
  processInstanceId: string,
  value: unknown,
  generation?: string,
): Promise<void> => {
  const id = processInstanceId.trim();
  if (!id) return;
  await awaitPending(pendingInstanceDeletes, id);
  const expected = generation ?? (await readInstanceGeneration(id));
  const json = payloadOf({ generation: expected, value });
  if (!json) return;
  const redis = client();
  if (!redis) return;
  try {
    const current = await readInstanceGeneration(id);
    if (current !== expected) return;
    await redis.set(instanceKey(id), json, 'EX', ttlSec(INSTANCE_DETAIL_CACHE_TTL_MS));
  } catch {
    // A missed detail cache only costs another GET later.
  }
};

/** Drop one process instance's detail cache. Never throws. Redis-only (no in-process copy). */
export const invalidateApprovalInstanceCache = (processInstanceId: string): void => {
  try {
    const id = processInstanceId.trim();
    if (!id) return;
    memoryInstanceGen.set(id, (memoryInstanceGen.get(id) ?? 0) + 1);
    const redis = client();
    if (!redis) return;
    const task = redis
      .incr(instanceGenKey(id))
      .then(() => redis.del(instanceKey(id)))
      .then(() => undefined)
      .catch(() => undefined);
    const prev = pendingInstanceDeletes.get(id) ?? Promise.resolve();
    const next = prev.then(() => task);
    pendingInstanceDeletes.set(id, next);
    void next.finally(() => {
      if (pendingInstanceDeletes.get(id) === next) pendingInstanceDeletes.delete(id);
    });
  } catch {
    // best-effort
  }
};

const parseLock = (
  raw: string | null,
): { mode: ApprovalSweepLockMode; token: string } | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { mode?: string; token?: string };
    if ((parsed.mode !== 'refresh' && parsed.mode !== 'scan') || !parsed.token) return undefined;
    return { mode: parsed.mode, token: parsed.token };
  } catch {
    return undefined;
  }
};

/**
 * Cross-process single-flight for the template sweep. `down` means Redis cannot
 * answer: the caller must compute (the in-process flight map still dedupes locally).
 */
export const acquireApprovalSweepLock = async (
  userId: string,
  staffId: string,
  mode: ApprovalSweepLockMode,
): Promise<ApprovalSweepLock> => {
  const redis = client();
  if (!redis) return { kind: 'down' };
  const key = approvalSweepLockKey(userId, staffId);
  const token = randomUUID();
  try {
    const result = await redis.set(
      key,
      JSON.stringify({ mode, token }),
      'PX',
      APPROVAL_SWEEP_LOCK_TTL_MS,
      'NX',
    );
    if (result !== 'OK') {
      let held: ApprovalSweepLockMode = 'scan';
      try {
        held = parseLock(await redis.get(key))?.mode ?? 'scan';
      } catch {
        return { kind: 'down' };
      }
      return { kind: 'busy', mode: held };
    }
  } catch {
    return { kind: 'down' };
  }

  return {
    kind: 'acquired',
    release: async () => {
      try {
        const current = parseLock(await redis.get(key));
        if (current?.token === token) await redis.del(key);
      } catch {
        // PX drops a lock this process could not release.
      }
    },
  };
};

/**
 * Latest sweep epoch, so an older replica cannot cache over a newer scan.
 * Undefined when Redis is down.
 */
export const bumpApprovalSweepEpoch = async (
  userId: string,
  staffId: string,
): Promise<string | undefined> => {
  const redis = client();
  if (!redis) return undefined;
  try {
    return String(await redis.incr(sweepEpochKey(userId, staffId)));
  } catch {
    return undefined;
  }
};

export const approvalSweepEpochIsCurrent = async (
  userId: string,
  staffId: string,
  epoch: string,
): Promise<boolean> => {
  const redis = client();
  if (!redis) return true;
  try {
    return ((await redis.get(sweepEpochKey(userId, staffId))) ?? '0') === epoch;
  } catch {
    return true;
  }
};

const sweepLockHeld = async (userId: string, staffId: string): Promise<boolean> => {
  const redis = client();
  if (!redis) return false;
  try {
    return Boolean(await redis.get(approvalSweepLockKey(userId, staffId)));
  } catch {
    return false;
  }
};

/**
 * Wait until the sweep lock is released or its wait bound passes, then read
 * the published sweep. A value that is already cached while the lock is still
 * held is the pre-refresh sweep — do not return it. After the bound (the lock
 * TTL), return whatever is visible now.
 */
export const waitForApprovalScopedCache = async <T>(
  userId: string,
  staffId: string,
  suffix: string,
): Promise<T | undefined> => {
  const deadline = Date.now() + sweepLockWaitMs;
  const maxAttempts = Math.ceil(sweepLockWaitMs / Math.max(sweepLockPollMs, 1)) + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const lockHeld = await sweepLockHeld(userId, staffId);
    if (!lockHeld) {
      const value = await readApprovalScopedCache<T>(userId, staffId, suffix, Date.now());
      if (value !== undefined) return value;
    }
    if (Date.now() >= deadline) break;
    await sleepFn(sweepLockPollMs);
  }
  return readApprovalScopedCache<T>(userId, staffId, suffix, Date.now());
};

export const setApprovalSweepLockTimingForTest = (
  timing: {
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    waitMs?: number;
  } | null,
): void => {
  sweepLockWaitMs = timing?.waitMs ?? APPROVAL_SWEEP_LOCK_WAIT_MS;
  sweepLockPollMs = timing?.pollMs ?? APPROVAL_SWEEP_LOCK_POLL_MS;
  sleepFn = timing?.sleep ?? defaultSleep;
};

export const resetApprovalCacheForTest = (): void => {
  memory.clear();
  memoryGen.clear();
  memoryInstanceGen.clear();
  pendingBumps.clear();
  pendingInstanceDeletes.clear();
  setApprovalSweepLockTimingForTest(null);
};

export const approvalMemoryCacheSizeForTest = (): number => memory.size;
