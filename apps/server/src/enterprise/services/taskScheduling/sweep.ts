import debug from 'debug';
import { and, eq, isNotNull, notInArray } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { TaskModel } from '@/database/models/task';
import { tasks } from '@/database/schemas';
import { runHeartbeatTick } from '@/server/services/taskRunner/heartbeatTick';
import { runScheduleTick } from '@/server/services/taskRunner/scheduleTick';
import { hasPendingLocalTimer } from '@/server/services/taskScheduler';
import { isHeartbeatTickDue } from '@/server/workflows-hono/task/handlers/heartbeatTick';
import type { ScheduledTaskForDispatch } from '@/server/workflows-hono/task/handlers/scheduleDispatch';
import { selectDueScheduledTasks } from '@/server/workflows-hono/task/handlers/scheduleDispatch';
import { runWatchdogScan } from '@/server/workflows-hono/task/handlers/watchdog';

import { acquireSweepLock } from './lock';
import type {
  HeartbeatTaskForSweep,
  SweepLockHandle,
  SweepLockResult,
  TaskSchedulingCounts,
  TaskSchedulingSweepDeps,
  TaskSchedulingSweepResult,
} from './types';

const log = debug('lobe-server:task-scheduling');

export const CRON_DISPATCH_CONCURRENCY = 3;

export const HEARTBEAT_SWEEP_EXCLUDED_STATUSES = [
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
] as const;

const emptyCounts = (): TaskSchedulingCounts => ({
  dispatched: 0,
  failed: 0,
  notDue: 0,
  skipped: 0,
});

/** In-process claim so two overlapping ticks of the same heartbeat task cannot both fire. */
const heartbeatInflight = new Set<string>();

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index] as T);
      }
    }),
  );
  return results;
};

export const heartbeatSweepWhere = () =>
  and(
    eq(tasks.automationMode, 'heartbeat'),
    isNotNull(tasks.heartbeatInterval),
    notInArray(tasks.status, [...HEARTBEAT_SWEEP_EXCLUDED_STATUSES]),
  );

const loadScheduledTasks = async (): Promise<ScheduledTaskForDispatch[]> => {
  const db = await getServerDB();
  return TaskModel.getScheduledTasks(db);
};

const loadHeartbeatTasks = async (): Promise<HeartbeatTaskForSweep[]> => {
  const db = await getServerDB();
  return db
    .select({
      createdByUserId: tasks.createdByUserId,
      heartbeatInterval: tasks.heartbeatInterval,
      id: tasks.id,
      identifier: tasks.identifier,
      lastHeartbeatAt: tasks.lastHeartbeatAt,
    })
    .from(tasks)
    .where(heartbeatSweepWhere());
};

const loadHeartbeatSnapshot = async (taskId: string): Promise<Date | string | null | undefined> => {
  const db = await getServerDB();
  const [row] = await db
    .select({ lastHeartbeatAt: tasks.lastHeartbeatAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.lastHeartbeatAt;
};

const snapshotMillis = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const isLockHandle = (value: SweepLockHandle | SweepLockResult): value is SweepLockHandle =>
  typeof value === 'object' && value !== null && 'result' in value;

let sweepInFlight = false;

/** Test helper — drop the overlapping-run latch. */
export const resetTaskSchedulingSweepGuardForTest = (): void => {
  sweepInFlight = false;
  heartbeatInflight.clear();
};

/**
 * Skip if a previous sweep is still running (setInterval can overlap when a
 * tick is slow). Returns `null` when skipped.
 */
export const runGuardedSweep = async (
  deps: TaskSchedulingSweepDeps = {},
): Promise<TaskSchedulingSweepResult | null> => {
  if (sweepInFlight) {
    log('skip overlapping sweep');
    return null;
  }
  sweepInFlight = true;
  try {
    return await runTaskSchedulingSweep(deps);
  } finally {
    sweepInFlight = false;
  }
};

type TickKind = 'dispatched' | 'failed' | 'skipped';

export const runTaskSchedulingSweep = async (
  deps: TaskSchedulingSweepDeps = {},
): Promise<TaskSchedulingSweepResult> => {
  const counts = emptyCounts();
  const now = deps.now ?? new Date();
  const acquired = await (deps.acquireSweepLock ?? acquireSweepLock)();
  const lock = isLockHandle(acquired) ? acquired.result : acquired;
  const releaseLock = isLockHandle(acquired) ? acquired.release : async () => {};

  try {
    if (lock === 'held') {
      log('sweep skipped: redis lock held');
      return { counts, lock, watchdogChecked: 0 };
    }

    const getScheduled = deps.getScheduledTasks ?? loadScheduledTasks;
    const getHeartbeats = deps.getHeartbeatTasks ?? loadHeartbeatTasks;
    const pendingTimer = deps.hasPendingLocalTimer ?? hasPendingLocalTimer;
    const tickSchedule = deps.runScheduleTick ?? runScheduleTick;
    const tickHeartbeat = deps.runHeartbeatTick ?? runHeartbeatTick;
    const watchdog = deps.runWatchdogScan ?? runWatchdogScan;
    const snapshot = deps.getHeartbeatSnapshot ?? loadHeartbeatSnapshot;
    const concurrency = deps.cronConcurrency ?? CRON_DISPATCH_CONCURRENCY;

    const scheduledTasks = await getScheduled();
    const due = selectDueScheduledTasks(scheduledTasks, now);
    counts.notDue += scheduledTasks.length - due.length;

    const cronKinds = await mapWithConcurrency(
      due,
      concurrency,
      async (task): Promise<TickKind> => {
        try {
          const outcome = await tickSchedule(task.taskId, task.userId);
          if (outcome.ran) {
            log(
              'cron dispatched task=%s identifier=%s',
              task.taskId,
              outcome.taskIdentifier ?? task.taskIdentifier,
            );
            return 'dispatched';
          }
          log('cron skipped task=%s reason=%s', task.taskId, outcome.reason);
          return 'skipped';
        } catch (error) {
          console.error('[task-scheduling] cron tick failed task=%s: %O', task.taskId, error);
          return 'failed';
        }
      },
    );
    for (const kind of cronKinds) {
      counts[kind] += 1;
    }

    const heartbeatTasks = await getHeartbeats();
    const dueHeartbeats: HeartbeatTaskForSweep[] = [];
    for (const task of heartbeatTasks) {
      if (
        !isHeartbeatTickDue({
          heartbeatInterval: task.heartbeatInterval,
          lastHeartbeatAt: task.lastHeartbeatAt,
          now,
        })
      ) {
        counts.notDue += 1;
        continue;
      }
      dueHeartbeats.push(task);
    }

    const heartbeatKinds = await mapWithConcurrency(
      dueHeartbeats,
      concurrency,
      async (task): Promise<TickKind> => {
        if (pendingTimer(task.id)) {
          log('heartbeat skipped task=%s reason=pending-timer', task.id);
          return 'skipped';
        }
        if (heartbeatInflight.has(task.id)) {
          log('heartbeat skipped task=%s reason=inflight', task.id);
          return 'skipped';
        }

        heartbeatInflight.add(task.id);
        try {
          const selectedAt = snapshotMillis(task.lastHeartbeatAt);
          const live = snapshotMillis(await snapshot(task.id));
          if (live !== selectedAt) {
            log('heartbeat skipped task=%s reason=lastHeartbeatAt-changed', task.id);
            return 'skipped';
          }

          const outcome = await tickHeartbeat(task.id, task.createdByUserId);
          if (outcome.ran) {
            log(
              'heartbeat dispatched task=%s identifier=%s',
              task.id,
              outcome.taskIdentifier ?? task.identifier,
            );
            return 'dispatched';
          }
          log('heartbeat skipped task=%s reason=%s', task.id, outcome.reason);
          return 'skipped';
        } catch (error) {
          console.error('[task-scheduling] heartbeat tick failed task=%s: %O', task.id, error);
          return 'failed';
        } finally {
          heartbeatInflight.delete(task.id);
        }
      },
    );
    for (const kind of heartbeatKinds) {
      counts[kind] += 1;
    }

    let watchdogChecked = 0;
    try {
      const watchdogResult = await watchdog();
      watchdogChecked = watchdogResult.checked;
      log(
        'watchdog checked=%d markedFailed=%d',
        watchdogResult.checked,
        watchdogResult.failed.length,
      );
    } catch (error) {
      counts.failed += 1;
      console.error('[task-scheduling] watchdog failed: %O', error);
    }

    log(
      'sweep done lock=%s dispatched=%d skipped=%d notDue=%d failed=%d watchdogChecked=%d',
      lock,
      counts.dispatched,
      counts.skipped,
      counts.notDue,
      counts.failed,
      watchdogChecked,
    );

    return { counts, lock, watchdogChecked };
  } finally {
    await releaseLock();
  }
};
