import debug from 'debug';

import { PlatformJobModel } from '@/database/models/platform/job';
import type { LobeChatDatabase } from '@/database/type';

import {
  GLOBAL_FILE_ORPHAN_GC_JOB_TYPE,
  GlobalFileOrphanGcAbortedError,
  GlobalFileOrphanGcS3OutageError,
  type GlobalFileOrphanGcSummary,
  isGlobalFileOrphanGcDisabled,
  previewGlobalFileOrphanGc,
  readGlobalFileOrphanGcConfig,
  runGlobalFileOrphanGc,
} from '../services/globalFileOrphanGc/run';
import { isModuleEnabled } from '../services/moduleSettings';
import { WORKER_INTERVAL_MS } from '../services/platformSystem/workerHealth';
import { markWorkerTick } from '../services/platformSystem/workerHeartbeat';
import { isPersistentEnterpriseWorkerRuntime } from './persistentWorkerRuntime';
import { startPersistentWorkerScheduler } from './persistentWorkerScheduler';
import {
  ensurePlatformJobsDispatcherStarted,
  type PlatformJobDispatchHandlerContext,
} from './platformJobsDispatcher';

export { GLOBAL_FILE_ORPHAN_GC_JOB_TYPE, previewGlobalFileOrphanGc, runGlobalFileOrphanGc };

const log = debug('lobe-server:enterprise-worker:global-file-orphan-gc');

/** Enqueue check every 10 minutes. Liveness is this loop, not the daily delete. */
export const GLOBAL_FILE_ORPHAN_GC_SCHEDULER_INTERVAL_MS = 10 * 60 * 1000;

const JOB_MAX_ATTEMPTS = 2;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WINDOW_START_MINUTES = 3 * 60 + 30;

const SCHEDULER_KEY = Symbol.for('enterprise.globalFileOrphanGc.scheduler');
type SchedulerGlobal = {
  [SCHEDULER_KEY]?: { scheduler?: { stop: () => void }; started: boolean };
};
const schedulerGlobal = globalThis as unknown as SchedulerGlobal;
const schedulerSlot = () => (schedulerGlobal[SCHEDULER_KEY] ??= { started: false });

export interface GlobalFileOrphanGcEnqueueResult {
  created: boolean;
  jobId?: string;
  skipped?: 'before-window' | 'disabled';
}

/** Shanghai wall clock. The zone is UTC+8 with no daylight-saving transition. */
export const shanghaiClock = (now: Date): { dateKey: string; minutesOfDay: number } => {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  return {
    dateKey: shifted.toISOString().slice(0, 10),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};

/** True at 03:30 Asia/Shanghai and for the rest of that local day (catch-up). */
export const isGlobalFileOrphanGcWindowOpen = (now: Date): boolean =>
  shanghaiClock(now).minutesOfDay >= WINDOW_START_MINUTES;

export const globalFileOrphanGcIdempotencyKey = (now: Date): string =>
  `global-file-orphan-gc:${shanghaiClock(now).dateKey}`;

/**
 * One row per Shanghai date. A disabled `GLOBAL_FILE_ORPHAN_GC` does not enqueue.
 * Before 03:30 local the call is a no-op so a 02:00 boot waits; a 15:00 boot
 * still enqueues today's key.
 */
export const enqueueGlobalFileOrphanGcJob = async (
  db: LobeChatDatabase,
  options: { env?: Partial<NodeJS.ProcessEnv>; now?: Date } = {},
): Promise<GlobalFileOrphanGcEnqueueResult> => {
  const env = options.env ?? process.env;
  if (isGlobalFileOrphanGcDisabled(env.GLOBAL_FILE_ORPHAN_GC)) {
    return { created: false, skipped: 'disabled' };
  }
  const now = options.now ?? new Date();
  if (!isGlobalFileOrphanGcWindowOpen(now)) {
    return { created: false, skipped: 'before-window' };
  }

  const { created, job } = await new PlatformJobModel(db).enqueue({
    idempotencyKey: globalFileOrphanGcIdempotencyKey(now),
    input: {},
    maxAttempts: JOB_MAX_ATTEMPTS,
    type: GLOBAL_FILE_ORPHAN_GC_JOB_TYPE,
  });
  return { created, jobId: job.id };
};

/** Heartbeat, then enqueue when the window is open. Used by the 10-minute scheduler. */
export const runGlobalFileOrphanGcEnqueuePass = async (
  options: { db?: LobeChatDatabase; env?: Partial<NodeJS.ProcessEnv>; now?: Date } = {},
): Promise<GlobalFileOrphanGcEnqueueResult> => {
  const env = options.env ?? process.env;
  markWorkerTick('global_file_orphan_gc', WORKER_INTERVAL_MS.global_file_orphan_gc);
  if (isGlobalFileOrphanGcDisabled(env.GLOBAL_FILE_ORPHAN_GC)) {
    return { created: false, skipped: 'disabled' };
  }
  const db = options.db ?? (await (await import('@/database/core/db-adaptor')).getServerDB());
  return enqueueGlobalFileOrphanGcJob(db, { env, now: options.now });
};

const heartbeatIntervalMs = (leaseMs: number): number => Math.max(1, Math.floor(leaseMs / 3));

export interface HandleClaimedGlobalFileOrphanGcDeps {
  env?: Partial<NodeJS.ProcessEnv>;
  run?: typeof runGlobalFileOrphanGc;
}

/** Handle one already-claimed `platform.global_file.orphan_gc.v1` job. */
export const handleClaimedGlobalFileOrphanGcJob = async (
  ctx: PlatformJobDispatchHandlerContext,
  deps: HandleClaimedGlobalFileOrphanGcDeps = {},
): Promise<void> => {
  const jobs = new PlatformJobModel(ctx.db);
  const env = deps.env ?? process.env;
  // A job queued before the switch was turned off must not delete. Complete it
  // so the claim lease is released and the dispatcher can move on.
  if (!readGlobalFileOrphanGcConfig(env).enabled) {
    const completed = await jobs.complete({
      jobId: ctx.job.id,
      resultSummary: { skipped: 'disabled' },
      workerId: ctx.workerId,
    });
    if (!completed) log('lost ownership on complete jobId=%s', ctx.job.id);
    return;
  }

  // Hot off: the dispatcher still claims rows queued under the boot view.
  // Complete without deleting so a restart is not required to stop GC.
  if (!(await isModuleEnabled('fileOrphanGc'))) {
    const completed = await jobs.complete({
      jobId: ctx.job.id,
      resultSummary: { skipped: 'module_disabled' },
      workerId: ctx.workerId,
    });
    if (!completed) log('lost ownership on complete jobId=%s', ctx.job.id);
    return;
  }

  const run = deps.run ?? runGlobalFileOrphanGc;
  const controller = new AbortController();
  const heartbeatTimer = setInterval(() => {
    if (controller.signal.aborted) return;
    void jobs
      .heartbeat(ctx.job.id, ctx.workerId, ctx.spec.leaseMs)
      .then((row) => {
        if (!row) controller.abort();
      })
      .catch(() => {
        controller.abort();
      });
  }, heartbeatIntervalMs(ctx.spec.leaseMs));

  try {
    const resultSummary: GlobalFileOrphanGcSummary = await run(ctx.db, {
      env,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      log('lost ownership jobId=%s', ctx.job.id);
      return;
    }
    const completed = await jobs.complete({
      jobId: ctx.job.id,
      resultSummary: { ...resultSummary } as Record<string, unknown>,
      workerId: ctx.workerId,
    });
    if (!completed) log('lost ownership on complete jobId=%s', ctx.job.id);
  } catch (error) {
    if (error instanceof GlobalFileOrphanGcAbortedError || controller.signal.aborted) {
      log('aborted jobId=%s', ctx.job.id);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const untrackedKeys = error instanceof GlobalFileOrphanGcS3OutageError ? error.keys : undefined;
    console.error('[global-file-orphan-gc] failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      ...(untrackedKeys ? { keys: untrackedKeys } : {}),
    });
    const failed = await jobs.fail({
      error: untrackedKeys ? { keys: untrackedKeys, message } : { message },
      jobId: ctx.job.id,
      workerId: ctx.workerId,
    });
    if (!failed) log('lost ownership on fail jobId=%s', ctx.job.id);
  } finally {
    controller.abort();
    clearInterval(heartbeatTimer);
  }
};

/** Test-only: drop the process-once scheduler latch. */
export const resetGlobalFileOrphanGcSchedulerForTest = (): void => {
  const slot = schedulerSlot();
  slot.scheduler?.stop();
  slot.scheduler = undefined;
  slot.started = false;
};

/**
 * Core scheduler. No-op off the persistent runtime and when
 * `GLOBAL_FILE_ORPHAN_GC` is disabled. The claim lease is the single-runner lock;
 * this function only enqueues.
 */
export const ensureGlobalFileOrphanGcStarted = (
  env: Partial<NodeJS.ProcessEnv> = process.env,
): void => {
  if (!isPersistentEnterpriseWorkerRuntime(env)) return;
  if (isGlobalFileOrphanGcDisabled(env.GLOBAL_FILE_ORPHAN_GC)) return;
  const slot = schedulerSlot();
  if (slot.started) return;
  ensurePlatformJobsDispatcherStarted({ env });
  slot.started = true;
  slot.scheduler = startPersistentWorkerScheduler({
    baseIntervalMs: GLOBAL_FILE_ORPHAN_GC_SCHEDULER_INTERVAL_MS,
    namespace: 'global-file-orphan-gc',
    run: async () => {
      await runGlobalFileOrphanGcEnqueuePass();
    },
  });
};
