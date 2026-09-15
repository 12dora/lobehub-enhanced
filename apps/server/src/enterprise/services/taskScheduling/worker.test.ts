// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireSweepLock,
  RELEASE_SWEEP_LOCK_SCRIPT,
  TASK_SCHEDULING_SWEEP_LOCK_KEY,
  TASK_SCHEDULING_SWEEP_LOCK_TTL_SECONDS,
} from './lock';
import {
  ensureTaskSchedulingWorkerStarted,
  getTaskSchedulingStatus,
  isTaskSchedulingWorkerRuntime,
  stopTaskSchedulingWorkerForTest,
} from './worker';

const redisMocks = vi.hoisted(() => ({
  eval: vi.fn(),
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
    redisMocks.eval.mockReset();
  });

  it('returns unavailable and warns when Redis is missing', async () => {
    redisMocks.getRedis.mockReturnValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const lock = await acquireSweepLock();
    expect(lock.result).toBe('unavailable');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns held when SET NX does not acquire', async () => {
    redisMocks.set.mockResolvedValue(null);
    redisMocks.getRedis.mockReturnValue({ eval: redisMocks.eval, set: redisMocks.set });

    const lock = await acquireSweepLock();
    expect(lock.result).toBe('held');
    expect(redisMocks.set).toHaveBeenCalledWith(
      TASK_SCHEDULING_SWEEP_LOCK_KEY,
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      'EX',
      TASK_SCHEDULING_SWEEP_LOCK_TTL_SECONDS,
      'NX',
    );
    expect(TASK_SCHEDULING_SWEEP_LOCK_TTL_SECONDS).toBeGreaterThanOrEqual(5 * 60);
  });

  it('returns acquired when SET NX succeeds and releases with compare-and-delete', async () => {
    redisMocks.set.mockResolvedValue('OK');
    redisMocks.eval.mockResolvedValue(1);
    redisMocks.getRedis.mockReturnValue({ eval: redisMocks.eval, set: redisMocks.set });

    const lock = await acquireSweepLock();
    expect(lock.result).toBe('acquired');
    const token = redisMocks.set.mock.calls[0]![1] as string;

    await lock.release();
    expect(redisMocks.eval).toHaveBeenCalledWith(
      RELEASE_SWEEP_LOCK_SCRIPT,
      1,
      TASK_SCHEDULING_SWEEP_LOCK_KEY,
      token,
    );
    expect(RELEASE_SWEEP_LOCK_SCRIPT).toContain("redis.call('get'");
    expect(RELEASE_SWEEP_LOCK_SCRIPT).toContain("redis.call('del'");
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
      expect(status.lastCounts).toEqual({ dispatched: 0, failed: 0, notDue: 0, skipped: 0 });
    });
  });

  it('does not start the interval when local scheduler init fails', async () => {
    const { createTaskSchedulerModule } = await import('@/server/services/taskScheduler');
    vi.mocked(createTaskSchedulerModule).mockImplementationOnce(() => {
      throw new Error('no scheduler');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ensureTaskSchedulingWorkerStarted({
      acquireSweepLock: async () => 'acquired',
      getHeartbeatTasks: async () => [],
      getScheduledTasks: async () => [],
      runWatchdogScan: async () => ({ checked: 0, failed: [] }),
    });

    expect(warn).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getTaskSchedulingStatus()).toEqual({ lastCounts: null, lastSweepAt: null });
    warn.mockRestore();
  });
});
