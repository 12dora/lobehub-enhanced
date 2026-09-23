import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { scrubRuntimeErrorMessage } from './runtimeErrors';

/**
 * In-process worker liveness. Memory is the local view; Redis (when enabled)
 * lets whichever replica serves getStatus see the latest tick. Never throws.
 */
export const WORKER_HEARTBEAT_NAMES = [
  'approval_worker',
  'directory_sync',
  'dingtalk_stream',
  'document_render',
  'reminder',
  'task_scheduler',
  'task_sweep',
  'task_watchdog',
] as const;

export type WorkerHeartbeatName = (typeof WORKER_HEARTBEAT_NAMES)[number];

const INDEX_KEY = 'platform:worker-heartbeat:index';
const hashKey = (name: string): string => `platform:worker-heartbeat:${name}`;

export interface WorkerBeat {
  failed: boolean;
  intervalMs: number;
  lastError?: string;
  lastTickAt?: number;
  startedAt?: number;
}

export interface WorkerHeartbeatStore {
  expire: (key: string, seconds: number) => Promise<unknown>;
  hgetall: (key: string) => Promise<Record<string, string> | null>;
  hset: (key: string, field: string, value: string) => Promise<unknown>;
  sadd: (key: string, member: string) => Promise<unknown>;
  smembers: (key: string) => Promise<string[]>;
}

const memory = new Map<string, WorkerBeat>();
let storeOverride: WorkerHeartbeatStore | null | undefined;

export const setWorkerHeartbeatStoreForTest = (
  store: WorkerHeartbeatStore | null | undefined,
): void => {
  storeOverride = store;
};

export const resetWorkerHeartbeatForTest = (): void => {
  memory.clear();
  storeOverride = undefined;
};

export const readWorkerHeartbeatMemory = (): Map<string, WorkerBeat> => new Map(memory);

const resolveStore = (): WorkerHeartbeatStore | null => {
  if (storeOverride === null) return null;
  if (storeOverride) return storeOverride;
  try {
    const redis = getAgentRuntimeRedisClient();
    return redis ?? null;
  } catch {
    return null;
  }
};

const ttlSeconds = (intervalMs: number): number => {
  const fromInterval = Math.ceil((Math.max(intervalMs, 1) * 3) / 1000);
  return Math.min(7 * 24 * 60 * 60, Math.max(120, fromInterval));
};

const persist = (name: string, beat: WorkerBeat): void => {
  const store = resolveStore();
  if (!store) return;
  void (async () => {
    const key = hashKey(name);
    if (beat.startedAt !== undefined) await store.hset(key, 'startedAt', String(beat.startedAt));
    if (beat.lastTickAt !== undefined) await store.hset(key, 'lastTickAt', String(beat.lastTickAt));
    await store.hset(key, 'intervalMs', String(beat.intervalMs || 0));
    await store.hset(key, 'failed', beat.failed ? '1' : '0');
    await store.hset(key, 'lastError', beat.lastError ?? '');
    await store.expire(key, ttlSeconds(beat.intervalMs));
    await store.sadd(INDEX_KEY, name);
    await store.expire(INDEX_KEY, 7 * 24 * 60 * 60);
  })().catch(() => undefined);
};

const remember = (name: string, beat: WorkerBeat): void => {
  memory.set(name, beat);
  persist(name, beat);
};

export const markWorkerStarted = (name: WorkerHeartbeatName, intervalMs?: number): void => {
  try {
    const prev = memory.get(name);
    remember(name, {
      failed: false,
      intervalMs: intervalMs || prev?.intervalMs || 0,
      lastTickAt: prev?.lastTickAt,
      startedAt: prev?.startedAt ?? Date.now(),
    });
  } catch {
    // liveness must not take down the worker
  }
};

export const markWorkerTick = (name: WorkerHeartbeatName, intervalMs: number): void => {
  try {
    const prev = memory.get(name);
    const now = Date.now();
    remember(name, {
      failed: false,
      intervalMs: intervalMs > 0 ? intervalMs : prev?.intervalMs || 0,
      lastTickAt: now,
      startedAt: prev?.startedAt ?? now,
    });
  } catch {
    // ignore
  }
};

export const markWorkerFailed = (name: WorkerHeartbeatName, error: unknown): void => {
  try {
    const prev = memory.get(name);
    const text = error instanceof Error ? error.message : String(error ?? '');
    const lastError = scrubRuntimeErrorMessage(text) || undefined;
    remember(name, {
      failed: true,
      intervalMs: prev?.intervalMs || 0,
      ...(lastError ? { lastError } : {}),
      lastTickAt: prev?.lastTickAt,
      startedAt: prev?.startedAt,
    });
  } catch {
    // ignore
  }
};

const parseBeat = (hash: Record<string, string>): WorkerBeat | null => {
  const startedAt = Number(hash.startedAt);
  const lastTickAt = Number(hash.lastTickAt);
  const intervalMs = Number(hash.intervalMs);
  if (!Number.isFinite(startedAt) && hash.failed !== '1') return null;
  const lastError = hash.lastError?.trim() ? hash.lastError : undefined;
  return {
    failed: hash.failed === '1',
    intervalMs: Number.isFinite(intervalMs) ? intervalMs : 0,
    ...(lastError ? { lastError } : {}),
    ...(Number.isFinite(lastTickAt) ? { lastTickAt } : {}),
    ...(Number.isFinite(startedAt) ? { startedAt } : {}),
  };
};

const newer = (left: WorkerBeat | undefined, right: WorkerBeat): WorkerBeat => {
  if (!left) return right;
  const leftAt = left.lastTickAt ?? left.startedAt ?? 0;
  const rightAt = right.lastTickAt ?? right.startedAt ?? 0;
  if (rightAt > leftAt) return right;
  if (right.failed && !left.failed && rightAt === leftAt) return right;
  return left;
};

/** Local memory merged with Redis. Redis wins when its tick is newer. */
export const readWorkerBeats = async (): Promise<Map<string, WorkerBeat>> => {
  const merged = new Map(memory);
  try {
    const store = resolveStore();
    if (!store) return merged;
    const names = await store.smembers(INDEX_KEY);
    for (const name of names) {
      const hash = (await store.hgetall(hashKey(name))) ?? {};
      if (Object.keys(hash).length === 0) continue;
      const beat = parseBeat(hash);
      if (!beat) continue;
      merged.set(name, newer(merged.get(name), beat));
    }
  } catch {
    return merged;
  }
  return merged;
};
