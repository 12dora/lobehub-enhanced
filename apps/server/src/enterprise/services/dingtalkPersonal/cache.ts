import { createHash } from 'node:crypto';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

export const DINGTALK_PERSONAL_CACHE_TTL_SEC = 60;
/** Group search and my-groups lists. */
export const DINGTALK_PERSONAL_GROUP_CACHE_TTL_SEC = 10 * 60;
/** Report template list and one template's fields. */
export const DINGTALK_PERSONAL_TEMPLATE_CACHE_TTL_SEC = 60 * 60;

/**
 * One op → TTL table. Group search and report templates keep their longer
 * windows; docs/sheets reads join the same map. Unlisted reads stay at 60s.
 */
const OP_TTL_SEC: Record<string, number> = {
  'aitable.bases': DINGTALK_PERSONAL_CACHE_TTL_SEC,
  'aitable.schema': 10 * 60,
  'chat.myGroups': DINGTALK_PERSONAL_GROUP_CACHE_TTL_SEC,
  'chat.searchGroups': DINGTALK_PERSONAL_GROUP_CACHE_TTL_SEC,
  'doc.info': 10 * 60,
  'doc.read': 5 * 60,
  'doc.search': DINGTALK_PERSONAL_CACHE_TTL_SEC,
  'drive.search': DINGTALK_PERSONAL_CACHE_TTL_SEC,
  'report.template': DINGTALK_PERSONAL_TEMPLATE_CACHE_TTL_SEC,
  'report.templates': DINGTALK_PERSONAL_TEMPLATE_CACHE_TTL_SEC,
  'sheet.info': 10 * 60,
  'sheet.list': 10 * 60,
  'wiki.spaces': 10 * 60,
};

/** Read-cache TTL for a broker op. Writes are not cached. */
export const dingtalkPersonalReadCacheTtlSec = (op: string): number =>
  OP_TTL_SEC[op] ?? DINGTALK_PERSONAL_CACHE_TTL_SEC;

/**
 * Redis generation key. It must outlive every entry: if it expires first, the
 * next read falls back to generation 0 and can serve a stale row.
 */
export const DINGTALK_PERSONAL_CACHE_GEN_TTL_SEC =
  Math.max(DINGTALK_PERSONAL_CACHE_TTL_SEC, ...Object.values(OP_TTL_SEC)) * 2;

export interface DingtalkPersonalRedisLike {
  del: (...keys: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  incr: (key: string) => Promise<number>;
  set: (
    key: string,
    value: string,
    ...args: Array<string | number>
  ) => Promise<'OK' | null | string>;
}

export const getDingtalkPersonalRedis = (): DingtalkPersonalRedisLike | null => {
  try {
    const client = getAgentRuntimeRedisClient();
    return client ? (client as unknown as DingtalkPersonalRedisLike) : null;
  } catch {
    return null;
  }
};

const stableStringify = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

export const hashDingtalkPersonalArgs = (args: Record<string, unknown>): string =>
  createHash('sha256').update(stableStringify(args)).digest('hex');

interface MemoryEntry {
  expiresAt: number;
  value: string;
}

const memory = new Map<string, MemoryEntry>();

interface MemoryGeneration {
  at: number;
  value: number;
}

const memoryGen = new Map<string, MemoryGeneration>();

/** In-memory fallback cap. Oldest insertions are evicted after expired rows are swept. */
export const DINGTALK_PERSONAL_MEMORY_CACHE_LIMIT = 500;
/** Drop a user's generation after this long without a read, write, or invalidation. */
export const DINGTALK_PERSONAL_MEMORY_GEN_TTL_MS = 10 * 60 * 1000;
/** Cap on users tracked by the in-memory generation map. */
export const DINGTALK_PERSONAL_MEMORY_GEN_LIMIT = 1000;

export const resetDingtalkPersonalCacheForTest = (): void => {
  memory.clear();
  memoryGen.clear();
};

export const dingtalkPersonalMemoryCacheSizeForTest = (): number => memory.size;

export const dingtalkPersonalMemoryGenSizeForTest = (): number => memoryGen.size;

export const dingtalkPersonalMemoryGenHasForTest = (userId: string): boolean =>
  memoryGen.has(userId);

const genKey = (userId: string) => `dingtalk-personal:cache-gen:${userId}`;

const entryKey = (userId: string, gen: string, op: string, hash: string) =>
  `dingtalk-personal:cache:${userId}:${gen}:${op}:${hash}`;

const memoryKey = (userId: string, gen: number, op: string, hash: string) =>
  `mem:${userId}:${gen}:${op}:${hash}`;

const dropUserMemory = (userId: string): void => {
  const prefix = `mem:${userId}:`;
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
};

const sweepGenerations = (now = Date.now()): void => {
  for (const [userId, entry] of memoryGen) {
    if (now - entry.at > DINGTALK_PERSONAL_MEMORY_GEN_TTL_MS) {
      memoryGen.delete(userId);
      dropUserMemory(userId);
    }
  }
};

const trimGenerations = (): void => {
  while (memoryGen.size > DINGTALK_PERSONAL_MEMORY_GEN_LIMIT) {
    const oldest = memoryGen.keys().next().value;
    if (oldest === undefined) return;
    memoryGen.delete(oldest);
    dropUserMemory(oldest);
  }
};

const rememberGeneration = (userId: string, value: number, now = Date.now()): number => {
  memoryGen.delete(userId);
  memoryGen.set(userId, { at: now, value });
  trimGenerations();
  return memoryGen.get(userId)?.value ?? value;
};

const currentGeneration = (userId: string): number => {
  sweepGenerations();
  const existing = memoryGen.get(userId);
  return rememberGeneration(userId, existing?.value ?? 0);
};

const readMemory = (userId: string, op: string, hash: string): unknown => {
  const gen = currentGeneration(userId);
  const row = memory.get(memoryKey(userId, gen, op, hash));
  if (!row) return undefined;
  if (row.expiresAt <= Date.now()) {
    memory.delete(memoryKey(userId, gen, op, hash));
    return undefined;
  }
  try {
    return (JSON.parse(row.value) as { data?: unknown }).data;
  } catch {
    return undefined;
  }
};

const sweepMemoryCache = (): void => {
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
};

const trimMemoryCache = (): void => {
  while (memory.size > DINGTALK_PERSONAL_MEMORY_CACHE_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) return;
    memory.delete(oldest);
  }
};

const writeMemory = (
  userId: string,
  op: string,
  hash: string,
  payload: string,
  generation?: string,
): void => {
  const current = currentGeneration(userId);
  if (generation !== undefined && String(current) !== generation) return;
  sweepMemoryCache();
  const key = memoryKey(userId, current, op, hash);
  memory.delete(key);
  memory.set(key, {
    expiresAt: Date.now() + dingtalkPersonalReadCacheTtlSec(op) * 1000,
    value: payload,
  });
  trimMemoryCache();
};

const invalidateMemory = (userId: string): void => {
  dropUserMemory(userId);
  sweepGenerations();
  const next = (memoryGen.get(userId)?.value ?? 0) + 1;
  rememberGeneration(userId, next);
};

export const readDingtalkPersonalCache = async (
  userId: string,
  op: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const hash = hashDingtalkPersonalArgs(args);
  const redis = getDingtalkPersonalRedis();
  if (!redis) return readMemory(userId, op, hash);
  try {
    const gen = (await redis.get(genKey(userId))) ?? '0';
    const raw = await redis.get(entryKey(userId, gen, op, hash));
    if (!raw) return undefined;
    return (JSON.parse(raw) as { data?: unknown }).data;
  } catch {
    return undefined;
  }
};

/** Generation observed before a broker read. Pass it back to the matching write. */
export const captureDingtalkPersonalCacheGeneration = async (userId: string): Promise<string> => {
  const redis = getDingtalkPersonalRedis();
  if (!redis) return String(currentGeneration(userId));
  try {
    return (await redis.get(genKey(userId))) ?? '0';
  } catch {
    return String(currentGeneration(userId));
  }
};

export const writeDingtalkPersonalCache = async (
  userId: string,
  op: string,
  args: Record<string, unknown>,
  data: unknown,
  generation?: string,
): Promise<void> => {
  const hash = hashDingtalkPersonalArgs(args);
  const payload = JSON.stringify({ data: data === undefined ? null : data });
  const redis = getDingtalkPersonalRedis();
  if (!redis) {
    writeMemory(userId, op, hash, payload, generation);
    return;
  }
  try {
    const current = (await redis.get(genKey(userId))) ?? '0';
    if (generation !== undefined && current !== generation) return;
    await redis.set(
      entryKey(userId, generation ?? current, op, hash),
      payload,
      'EX',
      dingtalkPersonalReadCacheTtlSec(op),
    );
  } catch {
    // A cache write must not fail the read that just succeeded.
  }
};

export const invalidateDingtalkPersonalCache = async (userId: string): Promise<void> => {
  invalidateMemory(userId);
  const redis = getDingtalkPersonalRedis();
  if (!redis) return;
  try {
    const key = genKey(userId);
    await redis.incr(key);
    await redis.expire(key, DINGTALK_PERSONAL_CACHE_GEN_TTL_SEC);
  } catch {
    // Memory generation already moved, so a later fallback cannot serve stale rows.
  }
};
