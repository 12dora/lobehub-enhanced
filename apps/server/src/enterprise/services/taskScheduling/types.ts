import type { ScheduledTaskForDispatch } from '@/server/workflows-hono/task/handlers/scheduleDispatch';

export interface TaskSchedulingCounts {
  dispatched: number;
  failed: number;
  /** Loaded rows whose cron/heartbeat window has not elapsed yet. */
  notDue: number;
  /** Due rows skipped (pending timer, inflight, snapshot changed, tick declined). */
  skipped: number;
}

export interface TaskSchedulingStatus {
  lastCounts: TaskSchedulingCounts | null;
  lastSweepAt: string | null;
}

export type SweepLockResult = 'acquired' | 'held' | 'unavailable';

export interface SweepLockHandle {
  release: () => Promise<void>;
  result: SweepLockResult;
}

export interface HeartbeatTaskForSweep {
  createdByUserId: string;
  heartbeatInterval: number | null;
  id: string;
  identifier: string;
  lastHeartbeatAt: Date | string | null;
}

export interface TaskSchedulingSweepResult {
  counts: TaskSchedulingCounts;
  lock: SweepLockResult;
  watchdogChecked: number;
}

export interface TaskSchedulingSweepDeps {
  acquireSweepLock?: () => Promise<SweepLockHandle | SweepLockResult>;
  cronConcurrency?: number;
  getHeartbeatSnapshot?: (taskId: string) => Promise<Date | string | null | undefined>;
  getHeartbeatTasks?: () => Promise<HeartbeatTaskForSweep[]>;
  getScheduledTasks?: () => Promise<ScheduledTaskForDispatch[]>;
  hasPendingLocalTimer?: (taskId: string) => boolean;
  now?: Date;
  runHeartbeatTick?: (
    taskId: string,
    userId: string,
  ) => Promise<{ ran: true; taskIdentifier: string } | { ran: false; reason: string }>;
  runScheduleTick?: (
    taskId: string,
    userId: string,
  ) => Promise<{ ran: true; taskIdentifier: string } | { ran: false; reason: string }>;
  runWatchdogScan?: () => Promise<{ checked: number; failed: string[] }>;
}
