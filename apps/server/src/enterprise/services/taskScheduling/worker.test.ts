// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireSweepLock, TASK_SCHEDULING_SWEEP_LOCK_KEY } from './lock';
import {
  ensureTaskSchedulingWorkerStarted,
  getTaskSchedulingStatus,
  isTaskSchedulingWorkerRuntime,
  stopTaskSchedulingWorkerForTest,
} from './worker';

const redisMocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { enableQueueAgentRuntime: false },
}));

vi.mock('@/libs/qstash', () => ({
  qstashClient: { publishJSON: vi.fn() },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: redisMocks.getRedis,
}));

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: vi.fn(() => ({})),
  hasPendingLocalTimer: vi.fn(() => false),
  setTaskSchedulerExecutionCallback: vi.fn(),
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

vi.mock('@/server/services/taskNotification', () => ({
  TaskNotificationService: class {
    notify = vi.fn();
  },
}));

describe('acquireSweepLock', () => {
  beforeEach(() => {
    redisMocks.getRedis.mockReset();
    redisMocks.set.mockReset();
  });

  it('returns unavailable and warns when Redis is missing', async () => {
    redisMocks.getRedis.mockReturnValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(acquireSweepLock()).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns held when SET NX does not acquire', async () => {
    redisMocks.set.mockResolvedValue(null);
    redisMocks.getRedis.mockReturnValue({ set: redisMocks.set });

    await expect(acquireSweepLock()).resolves.toBe('held');
    expect(redisMocks.set).toHaveBeenCalledWith(
      TASK_SCHEDULING_SWEEP_LOCK_KEY,
      expect.any(String),
      'EX',
      55,
      'NX',
    );
  });

  it('returns acquired when SET NX succeeds', async () => {
    redisMocks.set.mockResolvedValue('OK');
    redisMocks.getRedis.mockReturnValue({ set: redisMocks.set });

    await expect(acquireSweepLock()).resolves.toBe('acquired');
  });
});

describe('isTaskSchedulingWorkerRuntime', () => {
  const persistent = {
    DATABASE_URL: 'postgres://localhost/test',
  } satisfies Partial<NodeJS.ProcessEnv>;

  it('allows a long-lived Node process with a database when QStash is off', () => {
    expect(isTaskSchedulingWorkerRuntime(persistent, false)).toBe(true);
  });

  it('rejects queue runtime, Vercel, Lambda, and missing DATABASE_URL', () => {
    expect(isTaskSchedulingWorkerRuntime(persistent, true)).toBe(false);
    expect(isTaskSchedulingWorkerRuntime({ ...persistent, VERCEL: '1' }, false)).toBe(false);
    expect(isTaskSchedulingWorkerRuntime({ ...persistent, VERCEL_ENV: 'production' }, false)).toBe(
      false,
    );
    expect(
      isTaskSchedulingWorkerRuntime({ ...persistent, AWS_LAMBDA_FUNCTION_NAME: 'fn' }, false),
    ).toBe(false);
    expect(isTaskSchedulingWorkerRuntime({ ...persistent, NEXT_RUNTIME: 'edge' }, false)).toBe(
      false,
    );
    expect(isTaskSchedulingWorkerRuntime({}, false)).toBe(false);
  });
});

describe('ensureTaskSchedulingWorkerStarted', () => {
  beforeEach(() => {
    stopTaskSchedulingWorkerForTest();
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/test');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
  });

  afterEach(() => {
    stopTaskSchedulingWorkerForTest();
    vi.unstubAllEnvs();
  });

  it('records lastSweepAt / lastCounts after the boot sweep', async () => {
    expect(getTaskSchedulingStatus()).toEqual({ lastCounts: null, lastSweepAt: null });

    ensureTaskSchedulingWorkerStarted({
      acquireSweepLock: async () => 'acquired',
      getHeartbeatTasks: async () => [],
      getScheduledTasks: async () => [],
      runWatchdogScan: async () => ({ checked: 0, failed: [] }),
    });

    await vi.waitFor(() => {
      const status = getTaskSchedulingStatus();
      expect(status.lastSweepAt).toBeTruthy();
      expect(status.lastCounts).toEqual({ dispatched: 0, failed: 0, skipped: 0 });
    });
  });
});
