// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => ({
  eval: vi.fn(),
  get: vi.fn(),
  getRedis: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisMocks.getRedis(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/notifyApp', () => ({
  fetchDirectoryReplaceAllInput: vi.fn(),
  resolveNotifyAppConfig: vi.fn(),
}));

const { getServerDB } = await import('@/database/core/db-adaptor');
const { fetchDirectoryReplaceAllInput, resolveNotifyAppConfig } =
  await import('@/server/services/messenger/platforms/dingtalk/notifyApp');
const {
  acquireDirectorySyncLock,
  computeDirectorySyncBootDelayMs,
  computeDirectorySyncRearmDelayMs,
  DINGTALK_DIRECTORY_STATUS_KEY,
  DINGTALK_DIRECTORY_SYNC_INTERVAL_MS,
  DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY,
  DINGTALK_DIRECTORY_SYNC_LOCK_KEY,
  DINGTALK_DIRECTORY_SYNC_LOCK_TTL_SECONDS,
  DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_KEY,
  DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS,
  DINGTALK_DIRECTORY_SYNC_MISS_NAME_TTL_SECONDS,
  DINGTALK_DIRECTORY_SYNC_TICK_SLACK_MS,
  DIRECTORY_SYNC_LOCK_FAILED,
  directorySyncMissNameKey,
  directorySyncPeriodicTickIsDue,
  ensureDingTalkDirectorySyncWorkerStarted,
  isDingTalkDirectorySyncWorkerRuntime,
  isDingTalkDirectorySyncWorkerStarted,
  normalizeDirectoryLookupName,
  readDingTalkDirectoryStatus,
  requestDirectorySyncOnLookupMiss,
  runGuardedDirectorySync,
  stopDingTalkDirectorySyncWorkerForTest,
  syncDingTalkDirectory,
} = await import('./sync');

const NOTIFY_APP = { agentId: '1', appKey: 'k', appSecret: 's' };

const snapshot = {
  departments: [
    {
      deptId: '1',
      memberCount: 0,
      name: 'Root',
      namePinyinFull: '',
      namePinyinInitials: '',
      parentId: null,
      pathNames: '',
      sortOrder: 0,
      syncedAt: new Date('2026-09-16T00:00:00.000Z'),
    },
  ],
  memberships: [],
  users: [
    {
      active: true,
      avatar: null,
      deptPath: '',
      leafDeptId: null,
      leafDeptName: '',
      name: 'Alice',
      namePinyinFull: 'alice',
      namePinyinInitials: 'a',
      staffId: 'hyq',
      syncedAt: new Date('2026-09-16T00:00:00.000Z'),
      unionId: null,
    },
  ],
};

const createModel = () => ({
  replaceAll: vi.fn(async () => undefined),
  stats: vi.fn(async () => ({ departments: 4, lastSyncedAt: null, users: 12 })),
});

beforeEach(() => {
  redisMocks.getRedis.mockReset();
  redisMocks.get.mockReset();
  redisMocks.set.mockReset();
  redisMocks.eval.mockReset();
  redisMocks.getRedis.mockReturnValue({
    eval: redisMocks.eval,
    get: redisMocks.get,
    set: redisMocks.set,
  });
  redisMocks.get.mockResolvedValue(null);
  redisMocks.set.mockResolvedValue('OK');
  redisMocks.eval.mockResolvedValue(1);
  vi.mocked(resolveNotifyAppConfig).mockResolvedValue(NOTIFY_APP);
  vi.mocked(fetchDirectoryReplaceAllInput).mockResolvedValue(snapshot as never);
  vi.mocked(getServerDB).mockResolvedValue({} as never);
});

afterEach(() => {
  stopDingTalkDirectorySyncWorkerForTest();
  vi.clearAllMocks();
});

describe('readDingTalkDirectoryStatus', () => {
  it('returns idle when Redis and the directory model are empty', async () => {
    redisMocks.getRedis.mockReturnValue(null);
    const status = await readDingTalkDirectoryStatus({} as never, {
      createDirectoryModel: async () => {
        throw new Error('model missing');
      },
    });
    expect(status).toEqual({
      departments: 0,
      lastError: null,
      lastRunAt: null,
      state: 'idle',
      users: 0,
    });
  });

  it('reads the Redis JSON status key', async () => {
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        departments: 8,
        lastError: null,
        lastRunAt: '2026-09-16T01:00:00.000Z',
        state: 'ok',
        users: 20,
      }),
    );
    await expect(readDingTalkDirectoryStatus()).resolves.toEqual({
      departments: 8,
      lastError: null,
      lastRunAt: '2026-09-16T01:00:00.000Z',
      state: 'ok',
      users: 20,
    });
    expect(redisMocks.get).toHaveBeenCalledWith(DINGTALK_DIRECTORY_STATUS_KEY);
  });
});

describe('syncDingTalkDirectory', () => {
  it('writes running then ok, and calls replaceAll with the fetched snapshot', async () => {
    const model = createModel();
    const result = await syncDingTalkDirectory({} as never, {
      createDirectoryModel: async () => model,
      now: () => new Date('2026-09-16T04:00:00.000Z'),
    });

    expect(result).toMatchObject({ departments: 1, users: 1 });
    expect(result.durationMs).toEqual(expect.any(Number));
    expect(model.replaceAll).toHaveBeenCalledWith(snapshot);
    const states = redisMocks.set.mock.calls
      .filter((call) => call[0] === DINGTALK_DIRECTORY_STATUS_KEY)
      .map((call) => JSON.parse(String(call[1])) as { state: string });
    expect(states.map((item) => item.state)).toEqual(['running', 'ok']);
    expect(states.at(-1)).toMatchObject({
      departments: 1,
      lastError: null,
      lastRunAt: '2026-09-16T04:00:00.000Z',
      state: 'ok',
      users: 1,
    });
    expect(redisMocks.set).toHaveBeenCalledWith(
      DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY,
      '2026-09-16T04:00:00.000Z',
    );
  });

  it('throws notify_app_not_configured and writes error status', async () => {
    vi.mocked(resolveNotifyAppConfig).mockResolvedValueOnce(null);
    await expect(
      syncDingTalkDirectory({} as never, { createDirectoryModel: async () => createModel() }),
    ).rejects.toThrow('notify_app_not_configured');
    expect(redisMocks.set).toHaveBeenCalledWith(
      DINGTALK_DIRECTORY_STATUS_KEY,
      expect.stringContaining('notify_app_not_configured'),
    );
  });

  it('writes error status when fetch fails', async () => {
    vi.mocked(fetchDirectoryReplaceAllInput).mockRejectedValueOnce(new Error('errcode 88 boom'));
    await expect(
      syncDingTalkDirectory({} as never, { createDirectoryModel: async () => createModel() }),
    ).rejects.toThrow('errcode 88 boom');
    const last = redisMocks.set.mock.calls.findLast(
      (call) => call[0] === DINGTALK_DIRECTORY_STATUS_KEY,
    );
    expect(JSON.parse(String(last?.[1]))).toMatchObject({
      lastError: 'errcode 88 boom',
      state: 'error',
    });
    expect(
      redisMocks.set.mock.calls.some(
        (call) => call[0] === DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY,
      ),
    ).toBe(false);
  });
});

describe('acquireDirectorySyncLock', () => {
  it('returns held when SET NX does not acquire', async () => {
    redisMocks.set.mockResolvedValueOnce(null);
    const lock = await acquireDirectorySyncLock();
    expect(lock.result).toBe('held');
    expect(redisMocks.set).toHaveBeenCalledWith(
      DINGTALK_DIRECTORY_SYNC_LOCK_KEY,
      expect.any(String),
      'EX',
      DINGTALK_DIRECTORY_SYNC_LOCK_TTL_SECONDS,
      'NX',
    );
    expect(DINGTALK_DIRECTORY_SYNC_LOCK_TTL_SECONDS).toBeGreaterThanOrEqual(30 * 60);
  });
});

describe('runGuardedDirectorySync', () => {
  it('skips when the lock is held', async () => {
    redisMocks.set.mockResolvedValueOnce(null);
    const model = createModel();
    await expect(
      runGuardedDirectorySync({} as never, { createDirectoryModel: async () => model }),
    ).resolves.toBeNull();
    expect(model.replaceAll).not.toHaveBeenCalled();
  });

  it('skips the walk when the lock SET throws', async () => {
    redisMocks.set.mockRejectedValueOnce(new Error('ECONNRESET'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const model = createModel();
    await expect(
      runGuardedDirectorySync({} as never, { createDirectoryModel: async () => model }),
    ).resolves.toBe(DIRECTORY_SYNC_LOCK_FAILED);
    expect(model.replaceAll).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('skipping sync'),
      expect.objectContaining({ errorClass: 'Error' }),
    );
    warn.mockRestore();
  });
});

describe('directory sync interval', () => {
  it('walks every 12 hours, not every hour', () => {
    expect(DINGTALK_DIRECTORY_SYNC_INTERVAL_MS).toBe(12 * 60 * 60 * 1000);
    expect(DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('treats a success inside 12 h minus 15 min as not due for the periodic tick', () => {
    const now = Date.parse('2026-09-24T12:00:00.000Z');
    const slack = DINGTALK_DIRECTORY_SYNC_INTERVAL_MS - DINGTALK_DIRECTORY_SYNC_TICK_SLACK_MS;
    const recent = now - slack + 1;
    expect(directorySyncPeriodicTickIsDue(null, now)).toBe(true);
    expect(directorySyncPeriodicTickIsDue(Number.NaN, now)).toBe(true);
    expect(directorySyncPeriodicTickIsDue(recent, now)).toBe(false);
    expect(
      directorySyncPeriodicTickIsDue(
        now - (DINGTALK_DIRECTORY_SYNC_INTERVAL_MS - DINGTALK_DIRECTORY_SYNC_TICK_SLACK_MS),
        now,
      ),
    ).toBe(true);
  });

  it('still walks a manual call when the periodic tick would skip', async () => {
    redisMocks.get.mockImplementation(async (key: string) =>
      key === DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY ? new Date().toISOString() : null,
    );
    const model = createModel();
    await expect(
      runGuardedDirectorySync({} as never, { createDirectoryModel: async () => model }),
    ).resolves.toMatchObject({ users: 1 });
    expect(model.replaceAll).toHaveBeenCalledTimes(1);
  });

  it('waits out a recent success and falls back to 60 s when the key is missing', () => {
    const now = Date.parse('2026-09-24T01:00:00.000Z');
    const last = Date.parse('2026-09-24T00:00:00.000Z');
    expect(computeDirectorySyncBootDelayMs(null, now)).toBe(60_000);
    expect(computeDirectorySyncBootDelayMs(Number.NaN, now)).toBe(60_000);
    expect(computeDirectorySyncBootDelayMs(last, now)).toBe(11 * 60 * 60 * 1000);
    expect(computeDirectorySyncBootDelayMs(Date.parse('2026-09-23T00:00:00.000Z'), now)).toBe(
      60_000,
    );
  });
});

describe('requestDirectorySyncOnLookupMiss', () => {
  it('triggers a guarded sync when the directory is stale', async () => {
    const model = createModel();
    await expect(
      requestDirectorySyncOnLookupMiss({} as never, {
        createDirectoryModel: async () => model,
        now: () => new Date('2026-09-16T04:00:00.000Z'),
      }),
    ).resolves.toBe('triggered');
    expect(redisMocks.set).toHaveBeenCalledWith(
      DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_KEY,
      '1',
      'EX',
      DINGTALK_DIRECTORY_SYNC_MISS_COOLDOWN_MS / 1000,
      'NX',
    );
    await vi.waitFor(() => {
      expect(model.replaceAll).toHaveBeenCalled();
    });
    await expect(
      requestDirectorySyncOnLookupMiss({} as never, {
        createDirectoryModel: async () => model,
        now: () => new Date('2026-09-16T04:05:00.000Z'),
      }),
    ).resolves.toBe('throttled');
  });

  it('throttles to at most once per 6 hours after a successful run', async () => {
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        departments: 8,
        lastError: null,
        lastRunAt: '2026-09-16T03:30:00.000Z',
        state: 'ok',
        users: 20,
      }),
    );
    const model = createModel();
    await expect(
      requestDirectorySyncOnLookupMiss({} as never, {
        createDirectoryModel: async () => model,
        now: () => new Date('2026-09-16T04:00:00.000Z'),
      }),
    ).resolves.toBe('throttled');
    expect(model.replaceAll).not.toHaveBeenCalled();
  });

  it('does not start a second walk while one is running', async () => {
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        departments: 8,
        lastError: null,
        lastRunAt: '2026-09-15T04:00:00.000Z',
        state: 'running',
        users: 20,
      }),
    );
    const model = createModel();
    await expect(
      requestDirectorySyncOnLookupMiss({} as never, {
        createDirectoryModel: async () => model,
      }),
    ).resolves.toBe('running');
    expect(model.replaceAll).not.toHaveBeenCalled();
  });

  it('throttles a miss 2 hours after the last walk and allows one after 6 hours', async () => {
    const model = createModel();
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        departments: 8,
        lastError: null,
        lastRunAt: '2026-09-16T02:00:00.000Z',
        state: 'ok',
        users: 20,
      }),
    );
    await expect(
      requestDirectorySyncOnLookupMiss({} as never, {
        createDirectoryModel: async () => model,
        now: () => new Date('2026-09-16T04:00:00.000Z'),
      }),
    ).resolves.toBe('throttled');

    stopDingTalkDirectorySyncWorkerForTest();
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        departments: 8,
        lastError: null,
        lastRunAt: '2026-09-15T21:00:00.000Z',
        state: 'ok',
        users: 20,
      }),
    );
    await expect(
      requestDirectorySyncOnLookupMiss({} as never, {
        createDirectoryModel: async () => model,
        now: () => new Date('2026-09-16T04:00:00.000Z'),
      }),
    ).resolves.toBe('triggered');
  });

  it('does not walk again for the same normalised name inside the 6 h cache', async () => {
    const store = new Map<string, { expiresAt: number | null; value: string }>();
    let nowMs = Date.parse('2026-09-16T04:00:00.000Z');
    const readKey = (key: string): string | null => {
      const row = store.get(key);
      if (!row) return null;
      if (row.expiresAt !== null && row.expiresAt <= nowMs) {
        store.delete(key);
        return null;
      }
      return row.value;
    };
    redisMocks.get.mockImplementation(async (key: string) => readKey(key));
    redisMocks.set.mockImplementation(async (key: string, value: string, ...args: unknown[]) => {
      if (
        key === DINGTALK_DIRECTORY_SYNC_LOCK_KEY ||
        key === DINGTALK_DIRECTORY_STATUS_KEY ||
        key === DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY
      ) {
        return 'OK';
      }
      if (args.includes('NX') && readKey(key) !== null) return null;
      const exAt = args.indexOf('EX');
      const seconds = exAt >= 0 ? Number(args[exAt + 1]) : Number.NaN;
      store.set(key, {
        expiresAt: Number.isFinite(seconds) ? nowMs + seconds * 1000 : null,
        value: String(value),
      });
      return 'OK';
    });

    const model = createModel();
    const deps = {
      createDirectoryModel: async () => model,
      now: () => new Date(nowMs),
    };
    await expect(requestDirectorySyncOnLookupMiss({} as never, deps, ' 张三 ')).resolves.toBe(
      'triggered',
    );
    expect(redisMocks.set).toHaveBeenCalledWith(
      directorySyncMissNameKey(normalizeDirectoryLookupName('张三')),
      '1',
      'EX',
      DINGTALK_DIRECTORY_SYNC_MISS_NAME_TTL_SECONDS,
      'NX',
    );
    await vi.waitFor(() => expect(model.replaceAll).toHaveBeenCalledTimes(1));

    nowMs += 60_000;
    await expect(requestDirectorySyncOnLookupMiss({} as never, deps, '张三')).resolves.toBe(
      'throttled',
    );
    await expect(requestDirectorySyncOnLookupMiss({} as never, deps, 'ZHANG')).resolves.toBe(
      'throttled',
    );
    nowMs += 60_000;
    await expect(requestDirectorySyncOnLookupMiss({} as never, deps, ' zhang ')).resolves.toBe(
      'throttled',
    );
    expect(model.replaceAll).toHaveBeenCalledTimes(1);

    nowMs += 60_000;
    await expect(requestDirectorySyncOnLookupMiss({} as never, deps, '李四')).resolves.toBe(
      'throttled',
    );
    expect(model.replaceAll).toHaveBeenCalledTimes(1);

    nowMs = Date.parse('2026-09-16T04:00:00.000Z') + 6 * 60 * 60 * 1000 + 1000;
    await expect(requestDirectorySyncOnLookupMiss({} as never, deps, '李四')).resolves.toBe(
      'triggered',
    );
    await vi.waitFor(() => expect(model.replaceAll).toHaveBeenCalledTimes(2));
    await expect(requestDirectorySyncOnLookupMiss({} as never, deps, '王五')).resolves.toBe(
      'throttled',
    );
    expect(model.replaceAll).toHaveBeenCalledTimes(2);
  });

  it('does not remember a name when the miss is throttled before a walk starts', async () => {
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        departments: 1,
        lastError: null,
        lastRunAt: '2026-09-16T03:30:00.000Z',
        state: 'ok',
        users: 1,
      }),
    );
    const model = createModel();
    await expect(
      requestDirectorySyncOnLookupMiss(
        {} as never,
        {
          createDirectoryModel: async () => model,
          now: () => new Date('2026-09-16T04:00:00.000Z'),
        },
        '新人',
      ),
    ).resolves.toBe('throttled');
    expect(model.replaceAll).not.toHaveBeenCalled();
    expect(redisMocks.set).not.toHaveBeenCalledWith(
      directorySyncMissNameKey(normalizeDirectoryLookupName('新人')),
      '1',
      'EX',
      DINGTALK_DIRECTORY_SYNC_MISS_NAME_TTL_SECONDS,
      'NX',
    );
  });
});

describe('ensureDingTalkDirectorySyncWorkerStarted', () => {
  it('does not start without DATABASE_URL', () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isDingTalkDirectorySyncWorkerRuntime({ DATABASE_URL: undefined })).toBe(false);
      ensureDingTalkDirectorySyncWorkerStarted();
      expect(isDingTalkDirectorySyncWorkerStarted()).toBe(false);
      expect(vi.mocked(getServerDB)).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it('schedules the first walk at 60 s when last-success is missing, then every 12 h', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://directory-sync-test';
    vi.useFakeTimers();
    try {
      ensureDingTalkDirectorySyncWorkerStarted();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.mocked(getServerDB)).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(59_000);
      expect(vi.mocked(getServerDB)).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(2);
    } finally {
      stopDingTalkDirectorySyncWorkerForTest();
      vi.useRealTimers();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it('delays the first walk until last-success is 12 h old', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://directory-sync-test';
    redisMocks.get.mockImplementation(async (key: string) =>
      key === DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY ? '2026-09-24T00:00:00.000Z' : null,
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T01:00:00.000Z'));
    try {
      ensureDingTalkDirectorySyncWorkerStarted({
        now: () => new Date('2026-09-24T01:00:00.000Z'),
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.mocked(getServerDB)).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(11 * 60 * 60 * 1000 - 60_000 - 1);
      expect(vi.mocked(getServerDB)).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(1);
    } finally {
      stopDingTalkDirectorySyncWorkerForTest();
      vi.useRealTimers();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it('skips a later tick when another replica succeeded inside the 12 h window', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://directory-sync-test';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      ensureDingTalkDirectorySyncWorkerStarted();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(1);

      const successAt = Date.parse('2026-09-24T00:01:00.000Z') + 11 * 60 * 60 * 1000;
      redisMocks.get.mockImplementation(async (key: string) =>
        key === DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY ? new Date(successAt).toISOString() : null,
      );
      await vi.advanceTimersByTimeAsync(DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(2);
    } finally {
      stopDingTalkDirectorySyncWorkerForTest();
      vi.useRealTimers();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it('re-arms at last-success + 12 h after a skip instead of waiting another full interval', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://directory-sync-test';
    const store = new Map<string, string>();
    redisMocks.get.mockImplementation(async (key: string) => store.get(key) ?? null);
    redisMocks.set.mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      ensureDingTalkDirectorySyncWorkerStarted();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(1);

      const manualAt = new Date('2026-09-24T01:00:00.000Z');
      store.set(DINGTALK_DIRECTORY_SYNC_LAST_SUCCESS_KEY, manualAt.toISOString());
      await vi.advanceTimersByTimeAsync(DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(1);

      const now = Date.now();
      const remaining = manualAt.getTime() + DINGTALK_DIRECTORY_SYNC_INTERVAL_MS - now;
      await vi.advanceTimersByTimeAsync(remaining - 1);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(vi.mocked(getServerDB)).toHaveBeenCalledTimes(2);
    } finally {
      stopDingTalkDirectorySyncWorkerForTest();
      vi.useRealTimers();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});

describe('computeDirectorySyncRearmDelayMs', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');

  it('waits until last success is 12 h old, and a full interval when that time has passed', () => {
    expect(computeDirectorySyncRearmDelayMs(null, now)).toBe(DINGTALK_DIRECTORY_SYNC_INTERVAL_MS);
    expect(computeDirectorySyncRearmDelayMs(Number.NaN, now)).toBe(
      DINGTALK_DIRECTORY_SYNC_INTERVAL_MS,
    );
    expect(computeDirectorySyncRearmDelayMs(now - 60 * 60 * 1000, now)).toBe(11 * 60 * 60 * 1000);
    expect(computeDirectorySyncRearmDelayMs(now - DINGTALK_DIRECTORY_SYNC_INTERVAL_MS, now)).toBe(
      DINGTALK_DIRECTORY_SYNC_INTERVAL_MS,
    );
  });
});
