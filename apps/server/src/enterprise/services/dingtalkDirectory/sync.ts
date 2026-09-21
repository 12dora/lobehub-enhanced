import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import type { DingTalkDirectoryReplaceAllInput } from '@/server/services/messenger/platforms/dingtalk/notifyApp';
import {
  fetchDirectoryReplaceAllInput,
  resolveNotifyAppConfig,
} from '@/server/services/messenger/platforms/dingtalk/notifyApp';

const log = debug('lobe-server:messenger:dingtalk:directory-sync');

export const DINGTALK_DIRECTORY_STATUS_KEY = 'messenger:dingtalk:directory-status';
export const DINGTALK_DIRECTORY_SYNC_LOCK_KEY = 'messenger:dingtalk:directory-sync-lock';
export const DINGTALK_DIRECTORY_SYNC_LOCK_TTL_SECONDS = 30 * 60;
export const DINGTALK_DIRECTORY_SYNC_BOOT_DELAY_MS = 60_000;
/** Periodic walk. Miss-triggered refresh is capped separately at 1 h. */
export const DINGTALK_DIRECTORY_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS = 60 * 60 * 1000;
export const DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_KEY =
  'messenger:dingtalk:directory-sync-miss-cooldown';

export const RELEASE_DIRECTORY_SYNC_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type DingTalkDirectorySyncState = 'idle' | 'running' | 'ok' | 'error';

export interface DingTalkDirectoryStatus {
  departments: number;
  lastError: string | null;
  lastRunAt: string | null;
  state: DingTalkDirectorySyncState;
  users: number;
}

export interface DingTalkDirectorySyncResult {
  departments: number;
  durationMs: number;
  users: number;
}

export interface DingTalkDirectoryModelLike {
  replaceAll: (input: DingTalkDirectoryReplaceAllInput) => Promise<unknown>;
  stats: () => Promise<{
    departments: number;
    lastSyncedAt: Date | string | null;
    users: number;
  }>;
}

export interface DingTalkDirectorySyncDeps {
  createDirectoryModel?: (db: LobeChatDatabase) => Promise<DingTalkDirectoryModelLike>;
  fetchDirectory?: typeof fetchDirectoryReplaceAllInput;
  getNotifyApp?: typeof resolveNotifyAppConfig;
  now?: () => Date;
}

const idleStatus = (): DingTalkDirectoryStatus => ({
  departments: 0,
  lastError: null,
  lastRunAt: null,
  state: 'idle',
  users: 0,
});

const parseStatus = (raw: string | null | undefined): DingTalkDirectoryStatus | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DingTalkDirectoryStatus>;
    if (
      parsed.state !== 'idle' &&
      parsed.state !== 'running' &&
      parsed.state !== 'ok' &&
      parsed.state !== 'error'
    ) {
      return null;
    }
    return {
      departments: typeof parsed.departments === 'number' ? parsed.departments : 0,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null,
      state: parsed.state,
      users: typeof parsed.users === 'number' ? parsed.users : 0,
    };
  } catch {
    return null;
  }
};

export const writeDingTalkDirectoryStatus = async (
  status: DingTalkDirectoryStatus,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.set(DINGTALK_DIRECTORY_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    log('writeDingTalkDirectoryStatus failed: %O', error);
  }
};

const statsToStatus = (stats: {
  departments: number;
  lastSyncedAt: Date | string | null;
  users: number;
}): DingTalkDirectoryStatus => {
  const lastSyncedAt = stats.lastSyncedAt;
  const lastRunAt =
    lastSyncedAt instanceof Date
      ? lastSyncedAt.toISOString()
      : typeof lastSyncedAt === 'string' && lastSyncedAt.length > 0
        ? lastSyncedAt
        : null;
  return {
    departments: stats.departments,
    lastError: null,
    lastRunAt,
    state: lastRunAt ? 'ok' : 'idle',
    users: stats.users,
  };
};

const createDirectoryModel = async (db: LobeChatDatabase): Promise<DingTalkDirectoryModelLike> =>
  new DingTalkDirectoryModel(db);

export const readDingTalkDirectoryStatus = async (
  db?: LobeChatDatabase,
  deps: DingTalkDirectorySyncDeps = {},
): Promise<DingTalkDirectoryStatus> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const stored = parseStatus(await redis.get(DINGTALK_DIRECTORY_STATUS_KEY));
      if (stored) return stored;
    } catch (error) {
      log('readDingTalkDirectoryStatus redis failed: %O', error);
    }
  }

  try {
    const database = db ?? (await getServerDB());
    const createModel = deps.createDirectoryModel ?? createDirectoryModel;
    const model = await createModel(database);
    return statsToStatus(await model.stats());
  } catch (error) {
    log('readDingTalkDirectoryStatus model fallback failed: %O', error);
    return idleStatus();
  }
};

const noopRelease = async (): Promise<void> => {};

export type DirectorySyncLockResult = 'acquired' | 'held' | 'unavailable';

export const acquireDirectorySyncLock = async (): Promise<{
  release: () => Promise<void>;
  result: DirectorySyncLockResult;
}> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    return { release: noopRelease, result: 'unavailable' };
  }

  const token = randomUUID();
  try {
    const result = await redis.set(
      DINGTALK_DIRECTORY_SYNC_LOCK_KEY,
      token,
      'EX',
      DINGTALK_DIRECTORY_SYNC_LOCK_TTL_SECONDS,
      'NX',
    );
    if (result !== 'OK') {
      log('directory sync lock held, skip');
      return { release: noopRelease, result: 'held' };
    }
  } catch (error) {
    console.warn('[dingtalk-directory] Redis lock failed; running sync anyway', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return { release: noopRelease, result: 'unavailable' };
  }

  return {
    release: async () => {
      try {
        await redis.eval(
          RELEASE_DIRECTORY_SYNC_LOCK_SCRIPT,
          1,
          DINGTALK_DIRECTORY_SYNC_LOCK_KEY,
          token,
        );
      } catch (error) {
        console.warn('[dingtalk-directory] Redis lock release failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    },
    result: 'acquired',
  };
};

export const syncDingTalkDirectory = async (
  db: LobeChatDatabase,
  deps: DingTalkDirectorySyncDeps = {},
): Promise<DingTalkDirectorySyncResult> => {
  const startedAt = Date.now();
  const previous = await readDingTalkDirectoryStatus(db, deps);
  const getNotifyApp = deps.getNotifyApp ?? resolveNotifyAppConfig;
  const notifyApp = await getNotifyApp();
  if (!notifyApp) {
    const status: DingTalkDirectoryStatus = {
      ...previous,
      lastError: 'notify_app_not_configured',
      state: 'error',
    };
    await writeDingTalkDirectoryStatus(status);
    throw new Error('notify_app_not_configured');
  }

  await writeDingTalkDirectoryStatus({
    ...previous,
    lastError: null,
    state: 'running',
  });

  try {
    const fetchDirectory = deps.fetchDirectory ?? fetchDirectoryReplaceAllInput;
    const snapshot = await fetchDirectory({ config: notifyApp, now: deps.now?.() });
    const createModel = deps.createDirectoryModel ?? createDirectoryModel;
    const model = await createModel(db);
    await model.replaceAll(snapshot);

    const durationMs = Math.max(0, Date.now() - startedAt);
    const result: DingTalkDirectorySyncResult = {
      departments: snapshot.departments.length,
      durationMs,
      users: snapshot.users.length,
    };
    await writeDingTalkDirectoryStatus({
      departments: result.departments,
      lastError: null,
      lastRunAt: (deps.now?.() ?? new Date()).toISOString(),
      state: 'ok',
      users: result.users,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeDingTalkDirectoryStatus({
      ...previous,
      lastError: message.slice(0, 500),
      lastRunAt: previous.lastRunAt,
      state: 'error',
    });
    throw error;
  }
};

export const runGuardedDirectorySync = async (
  db: LobeChatDatabase,
  deps: DingTalkDirectorySyncDeps = {},
): Promise<DingTalkDirectorySyncResult | null> => {
  const lock = await acquireDirectorySyncLock();
  if (lock.result === 'held') return null;
  try {
    return await syncDingTalkDirectory(db, deps);
  } finally {
    await lock.release();
  }
};

let started = false;
let bootTimer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

export const isDingTalkDirectorySyncWorkerStarted = (): boolean => started;

export const isDingTalkDirectorySyncWorkerRuntime = (
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean => {
  if (!env.DATABASE_URL) return false;
  if (env.VERCEL === '1' || Boolean(env.VERCEL_ENV)) return false;
  if (env.NEXT_RUNTIME === 'edge') return false;
  if (env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
};

const tickDirectorySync = async (deps: DingTalkDirectorySyncDeps = {}): Promise<void> => {
  const getNotifyApp = deps.getNotifyApp ?? resolveNotifyAppConfig;
  if (!(await getNotifyApp())) {
    log('skip: notify app not configured');
    return;
  }

  try {
    const db = await getServerDB();
    await runGuardedDirectorySync(db, deps);
  } catch (error) {
    console.error('[dingtalk-directory] sync failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }
};

export type DirectorySyncOnLookupMissResult = 'running' | 'throttled' | 'triggered';

let memoryMissCooldownUntil = 0;

const acquireMissCooldown = async (now: number): Promise<boolean> => {
  if (memoryMissCooldownUntil > now) return false;
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const result = await redis.set(
        DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_KEY,
        '1',
        'EX',
        Math.ceil(DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS / 1000),
        'NX',
      );
      if (result !== 'OK') return false;
      memoryMissCooldownUntil = now + DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS;
      return true;
    } catch (error) {
      log('miss-cooldown redis failed: %O', error);
    }
  }
  if (memoryMissCooldownUntil > now) return false;
  memoryMissCooldownUntil = now + DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS;
  return true;
};

/**
 * Early directory refresh when a reminder/approval name lookup misses.
 * At most once per hour. Admin 「同步」 still goes through
 * {@link runGuardedDirectorySync} and is not gated here.
 */
export const requestDirectorySyncOnLookupMiss = async (
  db: LobeChatDatabase,
  deps: DingTalkDirectorySyncDeps = {},
): Promise<DirectorySyncOnLookupMissResult> => {
  const now = deps.now?.().getTime() ?? Date.now();
  const status = await readDingTalkDirectoryStatus(db, deps);
  if (status.state === 'running') return 'running';
  if (status.lastRunAt) {
    const last = Date.parse(status.lastRunAt);
    if (Number.isFinite(last) && now - last < DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS) {
      return 'throttled';
    }
  }
  if (!(await acquireMissCooldown(now))) return 'throttled';

  void runGuardedDirectorySync(db, deps).catch((error) => {
    console.error('[dingtalk-directory] miss-triggered sync failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  });
  return 'triggered';
};

/**
 * 12-hour directory walk. First run is delayed 60 s after boot so the process
 * can finish listening. Skipped when the notify app (服务号) is not configured.
 * A name-lookup miss may trigger an extra walk at most once per hour.
 */
export const ensureDingTalkDirectorySyncWorkerStarted = (
  deps: DingTalkDirectorySyncDeps = {},
): void => {
  if (started) return;
  if (!isDingTalkDirectorySyncWorkerRuntime()) {
    log('skip start: missing DATABASE_URL or serverless host');
    return;
  }

  started = true;
  const run = () => {
    void tickDirectorySync(deps);
  };

  bootTimer = setTimeout(() => {
    run();
    interval = setInterval(run, DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
    interval.unref?.();
  }, DINGTALK_DIRECTORY_SYNC_BOOT_DELAY_MS);
  bootTimer.unref?.();
  log(
    'started bootDelay=%dms interval=%dms',
    DINGTALK_DIRECTORY_SYNC_BOOT_DELAY_MS,
    DINGTALK_DIRECTORY_SYNC_INTERVAL_MS,
  );
};

export const stopDingTalkDirectorySyncWorker = (): void => {
  started = false;
  memoryMissCooldownUntil = 0;
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = undefined;
  }
  if (interval) {
    clearInterval(interval);
    interval = undefined;
  }
};

/** Test helper — drop the process-once latch and timers. */
export const stopDingTalkDirectorySyncWorkerForTest = (): void => {
  stopDingTalkDirectorySyncWorker();
};
