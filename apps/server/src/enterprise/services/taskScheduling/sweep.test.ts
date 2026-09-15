// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledTaskForDispatch } from '@/server/workflows-hono/task/handlers/scheduleDispatch';
import { selectDueScheduledTasks } from '@/server/workflows-hono/task/handlers/scheduleDispatch';

import {
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

const SHANGHAI = 'Asia/Shanghai';
const shanghaiLocal = (iso: string) => new Date(`${iso}+08:00`);
const utc = (iso: string) => new Date(`${iso}Z`);

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

describe('selectDueScheduledTasks (timezone)', () => {
  it('selects a 09:00 Asia/Shanghai task at local 09:00 and skips the same UTC instant in UTC', () => {
    const now = shanghaiLocal('2026-04-29T09:00:00');
    const shanghaiTask = scheduled({
      id: 'sh',
      scheduleTimezone: SHANGHAI,
    });
    const utcTask = scheduled({
      id: 'utc',
      scheduleTimezone: 'UTC',
    });

    const due = selectDueScheduledTasks([shanghaiTask, utcTask], now);
    expect(due.map((d) => d.taskId)).toEqual(['sh']);
  });

  it('does not select a daily 09:00 Shanghai task at 08:00 Shanghai', () => {
    const due = selectDueScheduledTasks(
      [scheduled({ id: 'sh', scheduleTimezone: SHANGHAI })],
      shanghaiLocal('2026-04-29T08:00:00'),
    );
    expect(due).toEqual([]);
  });

  it('dedups a daily UTC 09:00 task that already ran at 09:00 today', () => {
    const due = selectDueScheduledTasks(
      [
        scheduled({
          id: 'utc',
          lastHeartbeatAt: utc('2026-04-29T09:00:00'),
          scheduleTimezone: 'UTC',
        }),
      ],
      utc('2026-04-29T09:03:00'),
    );
    expect(due).toEqual([]);
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
    expect(result.counts).toEqual({ dispatched: 0, failed: 0, skipped: 0 });
    expect(runScheduleTick).not.toHaveBeenCalled();
    expect(runHeartbeatTick).not.toHaveBeenCalled();
    expect(runWatchdogScan).not.toHaveBeenCalled();
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
    expect(result.counts.skipped).toBe(1);
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
