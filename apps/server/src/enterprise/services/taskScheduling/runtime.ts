import type { TaskSchedulingCounts, TaskSchedulingStatus } from './types';

export const TASK_SCHEDULING_SWEEP_INTERVAL_MS = 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastSweepAt: string | null = null;
let lastCounts: TaskSchedulingCounts | null = null;

export const getTaskSchedulingStatus = (): TaskSchedulingStatus => ({
  lastCounts,
  lastSweepAt,
});

export const isTaskSchedulingWorkerStarted = (): boolean => started;

export const markTaskSchedulingWorkerStarted = (): void => {
  started = true;
};

export const recordTaskSchedulingSweepResult = (counts: TaskSchedulingCounts): void => {
  lastSweepAt = new Date().toISOString();
  lastCounts = counts;
};

export const resetTaskSchedulingWorkerStatusForTest = (): void => {
  lastSweepAt = null;
  lastCounts = null;
};

export const startTaskSchedulingInterval = (tick: () => void, intervalMs: number): void => {
  timer = setInterval(tick, intervalMs);
  timer.unref();
};

/** Stop the sweep interval so SIGTERM drain cannot start a new tick. */
export const stopTaskSchedulingWorker = (): void => {
  started = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
};
