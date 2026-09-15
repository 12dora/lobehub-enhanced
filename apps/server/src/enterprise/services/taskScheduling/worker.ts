import debug from 'debug';

import { appEnv } from '@/envs/app';
import { createTaskSchedulerModule } from '@/server/services/taskScheduler';

import {
  getTaskSchedulingStatus,
  isTaskSchedulingWorkerStarted,
  markTaskSchedulingWorkerStarted,
  recordTaskSchedulingSweepResult,
  resetTaskSchedulingWorkerStatusForTest,
  startTaskSchedulingInterval,
  stopTaskSchedulingWorker,
  TASK_SCHEDULING_SWEEP_INTERVAL_MS,
} from './runtime';
import { resetTaskSchedulingSweepGuardForTest, runGuardedSweep } from './sweep';
import type { TaskSchedulingSweepDeps } from './types';

const log = debug('lobe-server:task-scheduling');

export { getTaskSchedulingStatus, stopTaskSchedulingWorker, TASK_SCHEDULING_SWEEP_INTERVAL_MS };

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
  recordTaskSchedulingSweepResult(result.counts);
};

/**
 * In-process cron / heartbeat / watchdog loop. Only starts when QStash is not
 * the scheduler (`!enableQueueAgentRuntime`), a database is configured, and the
 * process is not a Vercel/Lambda/edge container.
 */
export const ensureTaskSchedulingWorkerStarted = (deps: TaskSchedulingSweepDeps = {}): void => {
  if (isTaskSchedulingWorkerStarted()) return;
  if (!isTaskSchedulingWorkerRuntime()) {
    log('skip start: QStash queue runtime, missing DATABASE_URL, or serverless host');
    return;
  }

  // Wire LocalTaskScheduler's setTimeout callback. If this fails, skip the
  // interval — otherwise `hasPendingLocalTimer` is always false and the sweep
  // can double-fire against live timers.
  try {
    createTaskSchedulerModule();
  } catch (error) {
    console.warn('[task-scheduling] failed to init local task scheduler; not starting sweep', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return;
  }

  markTaskSchedulingWorkerStarted();

  const tick = () => {
    void recordSweep(deps).catch((error) => {
      console.error('[task-scheduling] sweep failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  };

  // Catch up immediately on boot (lost setTimeouts after restart).
  tick();
  startTaskSchedulingInterval(tick, TASK_SCHEDULING_SWEEP_INTERVAL_MS);
  log('started interval=%dms', TASK_SCHEDULING_SWEEP_INTERVAL_MS);
};

/** Test helper — drop the process-once latch, the interval, and recorded status. */
export const stopTaskSchedulingWorkerForTest = (): void => {
  stopTaskSchedulingWorker();
  resetTaskSchedulingWorkerStatusForTest();
  resetTaskSchedulingSweepGuardForTest();
};
