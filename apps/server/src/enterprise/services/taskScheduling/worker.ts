import debug from 'debug';

import { appEnv } from '@/envs/app';
import { createTaskSchedulerModule } from '@/server/services/taskScheduler';

import { resetTaskSchedulingSweepGuardForTest, runGuardedSweep } from './sweep';
import type { TaskSchedulingCounts, TaskSchedulingStatus, TaskSchedulingSweepDeps } from './types';

const log = debug('lobe-server:task-scheduling');

export const TASK_SCHEDULING_SWEEP_INTERVAL_MS = 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastSweepAt: string | null = null;
let lastCounts: TaskSchedulingCounts | null = null;

export const getTaskSchedulingStatus = (): TaskSchedulingStatus => ({
  lastCounts,
  lastSweepAt,
});

export const isTaskSchedulingWorkerRuntime = (
  env: Partial<NodeJS.ProcessEnv> = process.env,
  queueEnabled: boolean = appEnv.enableQueueAgentRuntime === true,
): boolean => {
  if (queueEnabled) return false;
  if (!env.DATABASE_URL) return false;
  if (env.VERCEL === '1' || Boolean(env.VERCEL_ENV)) return false;
  if (env.NEXT_RUNTIME === 'edge') return false;
  if (env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
};

const recordSweep = async (deps?: TaskSchedulingSweepDeps): Promise<void> => {
  const result = await runGuardedSweep(deps);
  if (!result) return;
  lastSweepAt = new Date().toISOString();
  lastCounts = result.counts;
};

/**
 * In-process cron / heartbeat / watchdog loop. Only starts when QStash is not
 * the scheduler (`!enableQueueAgentRuntime`), a database is configured, and the
 * process is not a Vercel/Lambda/edge container.
 */
export const ensureTaskSchedulingWorkerStarted = (deps: TaskSchedulingSweepDeps = {}): void => {
  if (started) return;
  if (!isTaskSchedulingWorkerRuntime()) {
    log('skip start: QStash queue runtime, missing DATABASE_URL, or serverless host');
    return;
  }
  started = true;

  // Wire LocalTaskScheduler's setTimeout callback (no-op if already wired).
  try {
    createTaskSchedulerModule();
  } catch (error) {
    console.warn('[task-scheduling] failed to init local task scheduler', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  const tick = () => {
    void recordSweep(deps).catch((error) => {
      console.error('[task-scheduling] sweep failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  };

  // Catch up immediately on boot (lost setTimeouts after restart).
  tick();
  timer = setInterval(tick, TASK_SCHEDULING_SWEEP_INTERVAL_MS);
  timer.unref();
  log('started interval=%dms', TASK_SCHEDULING_SWEEP_INTERVAL_MS);
};

/** Test helper — drop the process-once latch and the interval. */
export const stopTaskSchedulingWorkerForTest = (): void => {
  started = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  lastSweepAt = null;
  lastCounts = null;
  resetTaskSchedulingSweepGuardForTest();
};
