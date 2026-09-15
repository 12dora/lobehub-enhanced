// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalTaskScheduler } from '@/server/services/taskScheduler/impls/local';
import type { ScheduledTaskForDispatch } from '@/server/workflows-hono/task/handlers/scheduleDispatch';

import {
  HEARTBEAT_SWEEP_EXCLUDED_STATUSES,
  heartbeatSweepWhere,
  resetTaskSchedulingSweepGuardForTest,
  runGuardedSweep,
  runTaskSchedulingSweep,
} from './sweep';
import type { HeartbeatTaskForSweep, TaskSchedulingSweepDeps } from './types';

vi.mock('@/envs/app', () => ({
  appEnv: { enableQueueAgentRuntime: false },
}));

vi.mock('@/libs/qstash', () => ({
  qstashClient: { publishJSON: vi.fn() },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: { findStuckTasks: vi.fn(), getScheduledTasks: vi.fn() },
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
}));

vi.mock('@/server/services/taskRunner/scheduleTick', () => ({
  runScheduleTick: vi.fn(),
}));

vi.mock('@/server/services/taskRunner/heartbeatTick', () => ({
  runHeartbeatTick: vi.fn(),
}));

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: vi.fn(),
  hasPendingLocalTimer: vi.fn(() => false),
  setTaskSchedulerExecutionCallback: vi.fn(),
}));

vi.mock('@/server/services/taskNotification', () => ({
  TaskNotificationService: class {
    notify = vi.fn();
  },
}));

const utc = (iso: string) => new Date(`${iso}Z`);

const flattenSql = (value: unknown, seen: Set<unknown> = new Set()): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return '';
  if (typeof value === 'object') {
    if (seen.has(value)) return '';
    seen.add(value);
  }
  if (Array.isArray(value)) return value.map((item) => flattenSql(item, seen)).join(' ');
  const record = value as Record<string, unknown>;
  if ('queryChunks' in record) return flattenSql(record.queryChunks, seen);
  if (typeof record.value === 'string' || typeof record.value === 'number') {
    return String(record.value);
  }
  return Object.values(record)
    .map((item) => flattenSql(item, seen))
    .join(' ');
};

const scheduled = (
  overrides: Partial<ScheduledTaskForDispatch> & Pick<ScheduledTaskForDispatch, 'id'>,
): ScheduledTaskForDispatch => ({
  createdByUserId: 'user-1',
  identifier: overrides.id,
  lastHeartbeatAt: null,
  schedulePattern: '0 9 * * *',
  scheduleTimezone: 'UTC',
  ...overrides,
});

const heartbeat = (
  overrides: Partial<HeartbeatTaskForSweep> & Pick<HeartbeatTaskForSweep, 'id'>,
): HeartbeatTaskForSweep => ({
  createdByUserId: 'user-1',
  heartbeatInterval: 600,
  identifier: overrides.id,
  lastHeartbeatAt: null,
  ...overrides,
});

const emptyCounts = { dispatched: 0, failed: 0, notDue: 0, skipped: 0 };

const baseDeps = (overrides: TaskSchedulingSweepDeps = {}): TaskSchedulingSweepDeps => ({
  acquireSweepLock: async () => 'acquired',
  getHeartbeatSnapshot: async (taskId) =>
    (await (overrides.getHeartbeatTasks ?? (async () => []))()).find((t) => t.id === taskId)
      ?.lastHeartbeatAt ?? null,
  getHeartbeatTasks: async () => [],
  getScheduledTasks: async () => [],
  hasPendingLocalTimer: () => false,
  runHeartbeatTick: async () => ({ ran: true, taskIdentifier: 'hb' }),
  runScheduleTick: async () => ({ ran: true, taskIdentifier: 'cron' }),
  runWatchdogScan: async () => ({ checked: 0, failed: [] }),
  ...overrides,
});

describe('heartbeatSweepWhere', () => {
  it('filters automationMode=heartbeat and excludes non-dispatchable statuses', () => {
    expect([...HEARTBEAT_SWEEP_EXCLUDED_STATUSES]).toEqual([
      'canceled',
      'completed',
      'failed',
      'paused',
      'running',
    ]);
    const sql = flattenSql(heartbeatSweepWhere());
    expect(sql).toContain('heartbeat');
    expect(sql).toMatch(/automation_mode/);
    expect(sql).toMatch(/heartbeat_interval/);
    for (const status of HEARTBEAT_SWEEP_EXCLUDED_STATUSES) {
      expect(sql).toContain(status);
    }
  });
});

describe('runTaskSchedulingSweep', () => {
  beforeEach(() => {
    resetTaskSchedulingSweepGuardForTest();
  });

  afterEach(() => {
    resetTaskSchedulingSweepGuardForTest();
  });

  it('skips the whole sweep when the Redis lock is held', async () => {
    const runScheduleTick = vi.fn();
    const runHeartbeatTick = vi.fn();
    const runWatchdogScan = vi.fn();

    const result = await runTaskSchedulingSweep(
      baseDeps({
        acquireSweepLock: async () => 'held',
        getScheduledTasks: async () => [scheduled({ id: 'due' })],
        now: utc('2026-04-29T09:00:00'),
        runHeartbeatTick,
        runScheduleTick,
        runWatchdogScan,
      }),
    );

    expect(result.lock).toBe('held');
    expect(result.counts).toEqual(emptyCounts);
    expect(runScheduleTick).not.toHaveBeenCalled();
    expect(runHeartbeatTick).not.toHaveBeenCalled();
    expect(runWatchdogScan).not.toHaveBeenCalled();
  });

  it('releases an acquired sweep lock after the sweep finishes', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    await runTaskSchedulingSweep(
      baseDeps({
        acquireSweepLock: async () => ({ release, result: 'acquired' }),
      }),
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('still runs when Redis is unavailable', async () => {
    const runWatchdogScan = vi.fn().mockResolvedValue({ checked: 0, failed: [] });
    const result = await runTaskSchedulingSweep(
      baseDeps({
        acquireSweepLock: async () => 'unavailable',
        runWatchdogScan,
      }),
    );
    expect(result.lock).toBe('unavailable');
    expect(runWatchdogScan).toHaveBeenCalledOnce();
  });

  it('dispatches due cron tasks and invokes the watchdog', async () => {
    const runScheduleTick = vi.fn().mockResolvedValue({ ran: true, taskIdentifier: 'T-1' });
    const runWatchdogScan = vi.fn().mockResolvedValue({ checked: 2, failed: ['T-stuck'] });

    const result = await runTaskSchedulingSweep(
      baseDeps({
        getScheduledTasks: async () => [
          scheduled({ id: 'due', identifier: 'T-1' }),
          scheduled({
            id: 'later',
            identifier: 'T-2',
            schedulePattern: '0 21 * * *',
          }),
        ],
        now: utc('2026-04-29T09:00:00'),
        runScheduleTick,
        runWatchdogScan,
      }),
    );

    expect(runScheduleTick).toHaveBeenCalledOnce();
    expect(runScheduleTick).toHaveBeenCalledWith('due', 'user-1');
    expect(runWatchdogScan).toHaveBeenCalledOnce();
    expect(result.watchdogChecked).toBe(2);
    expect(result.counts.dispatched).toBe(1);
    expect(result.counts.notDue).toBe(1);
    expect(result.counts.skipped).toBe(0);
  });

  it('catches up a heartbeat task after restart when no local timer is pending', async () => {
    const lastHeartbeatAt = utc('2026-04-29T08:00:00');
    const now = utc('2026-04-29T08:15:00'); // 15 min > 600s interval
    const runHeartbeatTick = vi.fn().mockResolvedValue({ ran: true, taskIdentifier: 'HB-1' });

    const result = await runTaskSchedulingSweep(
      baseDeps({
        getHeartbeatSnapshot: async () => lastHeartbeatAt,
        getHeartbeatTasks: async () => [
          heartbeat({
            heartbeatInterval: 600,
            id: 'hb-1',
            identifier: 'HB-1',
            lastHeartbeatAt,
          }),
        ],
        hasPendingLocalTimer: () => false,
        now,
        runHeartbeatTick,
      }),
    );

    expect(runHeartbeatTick).toHaveBeenCalledWith('hb-1', 'user-1');
    expect(result.counts.dispatched).toBe(1);
  });

  it('does not kick a heartbeat task that has never run (null lastHeartbeatAt)', async () => {
    const runHeartbeatTick = vi.fn();

    const result = await runTaskSchedulingSweep(
      baseDeps({
        getHeartbeatTasks: async () => [heartbeat({ id: 'hb-1', lastHeartbeatAt: null })],
        now: utc('2026-04-29T08:15:00'),
        runHeartbeatTick,
      }),
    );

    expect(runHeartbeatTick).not.toHaveBeenCalled();
    expect(result.counts.notDue).toBe(1);
    expect(result.counts.dispatched).toBe(0);
  });

  it('does not double-fire a heartbeat that still has a pending local timer', async () => {
    const lastHeartbeatAt = utc('2026-04-29T08:00:00');
    const runHeartbeatTick = vi.fn();

    const result = await runTaskSchedulingSweep(
      baseDeps({
        getHeartbeatTasks: async () => [
          heartbeat({
            heartbeatInterval: 600,
            id: 'hb-1',
            lastHeartbeatAt,
          }),
        ],
        hasPendingLocalTimer: (taskId) => taskId === 'hb-1',
        now: utc('2026-04-29T08:15:00'),
        runHeartbeatTick,
      }),
    );

    expect(runHeartbeatTick).not.toHaveBeenCalled();
    expect(result.counts.skipped).toBe(1);
  });

  it('skips a heartbeat while the LocalTaskScheduler callback is still unresolved', async () => {
    const scheduler = new LocalTaskScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const callback = vi.fn().mockImplementation(() => gate);
    scheduler.setExecutionCallback(callback);

    await scheduler.scheduleNextTopic({ delay: 0, taskId: 'hb-1', userId: 'user-1' });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    expect(scheduler.hasPendingForTask('hb-1')).toBe(true);

    const runHeartbeatTick = vi.fn();
    const result = await runTaskSchedulingSweep(
      baseDeps({
        getHeartbeatTasks: async () => [
          heartbeat({
            heartbeatInterval: 600,
            id: 'hb-1',
            lastHeartbeatAt: utc('2026-04-29T08:00:00'),
          }),
        ],
        hasPendingLocalTimer: (taskId) => scheduler.hasPendingForTask(taskId),
        now: utc('2026-04-29T08:15:00'),
        runHeartbeatTick,
      }),
    );

    expect(runHeartbeatTick).not.toHaveBeenCalled();
    expect(result.counts.skipped).toBe(1);

    release();
    await vi.waitFor(() => expect(scheduler.hasPendingForTask('hb-1')).toBe(false));
  });

  it('skips a heartbeat whose lastHeartbeatAt changed (DB guard)', async () => {
    const selected = utc('2026-04-29T08:00:00');
    const runHeartbeatTick = vi.fn();

    const result = await runTaskSchedulingSweep(
      baseDeps({
        getHeartbeatSnapshot: async () => utc('2026-04-29T08:12:00'),
        getHeartbeatTasks: async () => [
          heartbeat({
            heartbeatInterval: 600,
            id: 'hb-1',
            lastHeartbeatAt: selected,
          }),
        ],
        now: utc('2026-04-29T08:15:00'),
        runHeartbeatTick,
      }),
    );

    expect(runHeartbeatTick).not.toHaveBeenCalled();
    expect(result.counts.skipped).toBe(1);
  });

  it('dispatches due heartbeat ticks with the same concurrency cap as cron', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runHeartbeatTick = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight -= 1;
      return { ran: true, taskIdentifier: 'hb' };
    });

    const lastHeartbeatAt = utc('2026-04-29T08:00:00');
    const pending = runTaskSchedulingSweep(
      baseDeps({
        cronConcurrency: 3,
        getHeartbeatSnapshot: async () => lastHeartbeatAt,
        getHeartbeatTasks: async () =>
          ['a', 'b', 'c', 'd'].map((id) =>
            heartbeat({
              id,
              lastHeartbeatAt,
            }),
          ),
        now: utc('2026-04-29T08:15:00'),
        runHeartbeatTick,
      }),
    );

    await vi.waitFor(() => expect(runHeartbeatTick).toHaveBeenCalledTimes(3));
    expect(maxInFlight).toBe(3);
    release();
    const result = await pending;
    expect(runHeartbeatTick).toHaveBeenCalledTimes(4);
    expect(result.counts.dispatched).toBe(4);
  });
});

describe('runGuardedSweep overlapping-run guard', () => {
  beforeEach(() => {
    resetTaskSchedulingSweepGuardForTest();
  });

  afterEach(() => {
    resetTaskSchedulingSweepGuardForTest();
  });

  it('returns null when a previous sweep is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = runGuardedSweep(
      baseDeps({
        acquireSweepLock: async () => {
          await gate;
          return 'acquired';
        },
      }),
    );

    const second = await runGuardedSweep(baseDeps());
    expect(second).toBeNull();

    release();
    const firstResult = await first;
    expect(firstResult?.lock).toBe('acquired');
  });
});
