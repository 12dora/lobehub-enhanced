import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { LobeChatDatabase } from '@/database/type';
import { isModuleEnabled } from '@/server/enterprise/services/moduleSettings';
import { recordRuntimeError } from '@/server/enterprise/services/platformSystem/runtimeErrors';
import {
  markWorkerFailed,
  markWorkerStarted,
  markWorkerTick,
} from '@/server/enterprise/services/platformSystem/workerHeartbeat';
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
/** No TTL: a restart within 12 h of a walk must still see this timestamp. */
export const DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY =
  'messenger:dingtalk:directory-sync-last-success';
export const DINGTALK_DIRECTORY_SYNC_BOOT_DELAY_MS = 60_000;
/** Periodic walk. Miss-triggered refresh is capped separately at 6 h. */
export const DINGTALK_DIRECTORY_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_KEY =
  'messenger:dingtalk:directory-sync-miss-cooldown';
export const DINGTALK_DIRECTORY_SYNC_MISS_NAME_PREFIX =
  'messenger:dingtalk:directory-sync-miss-name:';
export const DINGTALK_DIRECTORY_SYNC_MISS_NAME_TTL_SECONDS = 6 * 60 * 60;
/** Periodic ticks inside this slack of the 12 h mark wait, so replicas do not double-walk. */
export const DINGTALK_DIRECTORY_SYNC_TICK_SLACK_MS = 15 * 60 * 1000;
/** `runGuardedDirectorySync` returns this when the Redis lock SET throws. The walk did not start. */
export const DIRECTORY_SYNC_LOCK_FAILED = 'lock_failed' as const;

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
  /** Hot dingtalkNotify check. Defaults to `isModuleEnabled`. */
  isNotifyModuleEnabled?: () => Promise<boolean>;
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

export type DirectorySyncLockResult = 'acquired' | 'failed' | 'held' | 'unavailable';

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
    log('directory sync lock SET threw, skip walk: %O', error);
    console.warn('[dingtalk-directory] Redis lock SET failed; skipping sync', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return { release: noopRelease, result: 'failed' };
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

/**
 * First walk after boot. Missing or unreadable last-success stays at 60 s.
 * A recent success waits until that walk is 12 h old, and never less than 60 s.
 */
export const computeDirectorySyncBootDelayMs = (
  lastSuccessMs: number | null,
  nowMs: number,
): number => {
  if (lastSuccessMs === null || !Number.isFinite(lastSuccessMs)) {
    return DINGTALK_DIRECTORY_SYNC_BOOT_DELAY_MS;
  }
  const wait = lastSuccessMs + DINGTALK_DIRECTORY_SYNC_INTERVAL_MS - nowMs;
  return Math.max(DINGTALK_DIRECTORY_SYNC_BOOT_DELAY_MS, wait);
};

const readDirectorySyncLastSuccessMs = async (): Promise<number | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY);
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    log('read directory sync last-success failed: %O', error);
    return null;
  }
};

const writeDirectorySyncLastSuccess = async (at: Date): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.set(DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY, at.toISOString());
    scheduleNextDirectorySync(at.getTime(), Date.now());
  } catch (error) {
    log('write directory sync last-success failed: %O', error);
  }
};

/** Trim, NFKC, collapse whitespace, lowercase. Empty means the caller had no name. */
export const normalizeDirectoryLookupName = (name: string): string =>
  name.normalize('NFKC').trim().replaceAll(/\s+/g, ' ').toLowerCase();

export const directorySyncMissNameKey = (normalisedName: string): string =>
  `${DINGTALK_DIRECTORY_SYNC_MISS_NAME_PREFIX}${normalisedName}`;

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
    const finishedAt = deps.now?.() ?? new Date();
    await writeDingTalkDirectoryStatus({
      departments: result.departments,
      lastError: null,
      lastRunAt: finishedAt.toISOString(),
      state: 'ok',
      users: result.users,
    });
    await writeDirectorySyncLastSuccess(finishedAt);
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

export type DirectorySyncGuardedResult =
  DingTalkDirectorySyncResult | typeof DIRECTORY_SYNC_LOCK_FAILED | null;

export const runGuardedDirectorySync = async (
  db: LobeChatDatabase,
  deps: DingTalkDirectorySyncDeps = {},
): Promise<DirectorySyncGuardedResult> => {
  const lock = await acquireDirectorySyncLock();
  // `unavailable` is "no Redis client": keep the previous unlocked run.
  // `failed` is a thrown SET: do not walk without the lock.
  if (lock.result === 'failed') return DIRECTORY_SYNC_LOCK_FAILED;
  if (lock.result === 'held') return null;
  try {
    return await syncDingTalkDirectory(db, deps);
  } finally {
    await lock.release();
  }
};

let started = false;
let nextTimer: ReturnType<typeof setTimeout> | undefined;
/** Set while the worker is running so a manual or miss walk can pull the next tick forward. */
let scheduleNextDirectorySync: (lastSuccessMs: number | null, nowMs: number) => void = () => {};

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

/**
 * True when a periodic tick should walk. Manual sync and lookup-miss walks do not use this.
 * A success newer than (12 h − 15 min) means another replica already walked.
 */
export const directorySyncPeriodicTickIsDue = (
  lastSuccessMs: number | null,
  nowMs: number,
): boolean => {
  if (lastSuccessMs === null || !Number.isFinite(lastSuccessMs)) return true;
  return (
    nowMs - lastSuccessMs >=
    DINGTALK_DIRECTORY_SYNC_INTERVAL_MS - DINGTALK_DIRECTORY_SYNC_TICK_SLACK_MS
  );
};

const tickDirectorySync = async (deps: DingTalkDirectorySyncDeps = {}): Promise<void> => {
  markWorkerTick('directory_sync', DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
  const notifyModuleOn = await (
    deps.isNotifyModuleEnabled ?? (() => isModuleEnabled('dingtalkNotify'))
  )();
  if (!notifyModuleOn) {
    log('skip: dingtalkNotify module off');
    return;
  }
  const getNotifyApp = deps.getNotifyApp ?? resolveNotifyAppConfig;
  if (!(await getNotifyApp())) {
    log('skip: notify app not configured');
    return;
  }

  const nowMs = Date.now();
  const lastSuccessMs = await readDirectorySyncLastSuccessMs();
  if (!directorySyncPeriodicTickIsDue(lastSuccessMs, nowMs)) {
    log('skip: last success still inside the 12 h window');
    return;
  }

  try {
    const db = await getServerDB();
    await runGuardedDirectorySync(db, deps);
  } catch (error) {
    console.error('[dingtalk-directory] sync failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    markWorkerFailed('directory_sync', error);
    void recordRuntimeError('dingtalk_api', error);
  }
};

export type DirectorySyncOnLookupMissResult = 'running' | 'throttled' | 'triggered';

let memoryMissCooldownUntil = 0;
const memoryMissNames = new Map<string, number>();

const directoryMissNameCached = async (name: string, now: number): Promise<boolean> => {
  const until = memoryMissNames.get(name) ?? 0;
  if (until > now) return true;
  if (until) memoryMissNames.delete(name);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return false;
  try {
    const hit = await redis.get(directorySyncMissNameKey(name));
    return Boolean(hit);
  } catch (error) {
    log('miss-name redis get failed: %O', error);
    return false;
  }
};

const rememberDirectoryMissName = async (name: string, now: number): Promise<void> => {
  memoryMissNames.set(name, now + DINGTALK_DIRECTORY_SYNC_MISS_NAME_TTL_SECONDS * 1000);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.set(
      directorySyncMissNameKey(name),
      '1',
      'EX',
      DINGTALK_DIRECTORY_SYNC_MISS_NAME_TTL_SECONDS,
      'NX',
    );
  } catch (error) {
    log('miss-name redis set failed: %O', error);
  }
};

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
 * At most one walk per 6 h, and the same normalised name does not ask again
 * for 6 h. Admin 「同步」 still goes through {@link runGuardedDirectorySync}
 * and is not gated here. `name` is optional so older callers stay valid.
 */
export const requestDirectorySyncOnLookupMiss = async (
  db: LobeChatDatabase,
  deps: DingTalkDirectorySyncDeps = {},
  name?: string,
): Promise<DirectorySyncOnLookupMissResult> => {
  const now = deps.now?.().getTime() ?? Date.now();
  const normalised = normalizeDirectoryLookupName(name ?? '');
  if (normalised && (await directoryMissNameCached(normalised, now))) return 'throttled';

  const status = await readDingTalkDirectoryStatus(db, deps);
  if (status.state === 'running') return 'running';
  if (status.lastRunAt) {
    const last = Date.parse(status.lastRunAt);
    if (Number.isFinite(last) && now - last < DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS) {
      return 'throttled';
    }
  }
  if (!(await acquireMissCooldown(now))) return 'throttled';

  // Only a walk that is actually starting should hide this name for 6 h.
  if (normalised) await rememberDirectoryMissName(normalised, now);

  void runGuardedDirectorySync(db, deps).catch((error) => {
    console.error('[dingtalk-directory] miss-triggered sync failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  });
  return 'triggered';
};

const clearDirectorySyncTimer = (): void => {
  if (!nextTimer) return;
  clearTimeout(nextTimer);
  nextTimer = undefined;
};

/**
 * Delay until the next periodic walk. Missing last-success (failed walk, or
 * Redis could not be read) waits a full 12 h so a failure cannot tight-loop.
 * A recent success — manual, lookup-miss, or the periodic walk — waits until
 * that success is 12 h old, instead of keeping the timer's old phase.
 */
export const computeDirectorySyncRearmDelayMs = (
  lastSuccessMs: number | null,
  nowMs: number,
): number => {
  if (lastSuccessMs === null || !Number.isFinite(lastSuccessMs)) {
    return DINGTALK_DIRECTORY_SYNC_INTERVAL_MS;
  }
  const wait = lastSuccessMs + DINGTALK_DIRECTORY_SYNC_INTERVAL_MS - nowMs;
  return wait > 0 ? wait : DINGTALK_DIRECTORY_SYNC_INTERVAL_MS;
};

const armDirectorySyncSchedule = (delayMs: number, run: () => void): void => {
  if (!started) return;
  clearDirectorySyncTimer();
  nextTimer = setTimeout(run, delayMs);
  nextTimer.unref?.();
  log('next directory sync in %dms', delayMs);
};

/**
 * 12-hour directory walk. The first run is at least 60 s after boot, and later
 * than that when the previous success is still inside the 12 h window.
 * Skipped when the notify app (服务号) is not configured.
 * A name-lookup miss may trigger an extra walk at most once per 6 h.
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
  markWorkerStarted('directory_sync', DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
  const run = (): void => {
    void (async () => {
      try {
        await tickDirectorySync(deps);
      } finally {
        if (started) {
          const lastSuccessMs = await readDirectorySyncLastSuccessMs();
          armDirectorySyncSchedule(
            computeDirectorySyncRearmDelayMs(lastSuccessMs, Date.now()),
            run,
          );
        }
      }
    })();
  };
  scheduleNextDirectorySync = (lastSuccessMs, nowMs) => {
    armDirectorySyncSchedule(computeDirectorySyncRearmDelayMs(lastSuccessMs, nowMs), run);
  };

  void readDirectorySyncLastSuccessMs().then((lastSuccessMs) => {
    const now = deps.now?.().getTime() ?? Date.now();
    armDirectorySyncSchedule(computeDirectorySyncBootDelayMs(lastSuccessMs, now), run);
  });
};

export const stopDingTalkDirectorySyncWorker = (): void => {
  started = false;
  memoryMissCooldownUntil = 0;
  memoryMissNames.clear();
  scheduleNextDirectorySync = () => {};
  clearDirectorySyncTimer();
};

/** Test helper — drop the process-once latch and timers. */
export const stopDingTalkDirectorySyncWorkerForTest = (): void => {
  stopDingTalkDirectorySyncWorker();
};
