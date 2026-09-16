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
  DINGTALK_DIRECTORY_STATUS_KEY,
  DINGTALK_DIRECTORY_SYNC_LOCK_KEY,
  ensureDingTalkDirectorySyncWorkerStarted,
  isDingTalkDirectorySyncWorkerRuntime,
  readDingTalkDirectoryStatus,
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
      expect.any(Number),
      'NX',
    );
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
});

describe('ensureDingTalkDirectorySyncWorkerStarted', () => {
  it('does not start without DATABASE_URL', () => {
    expect(isDingTalkDirectorySyncWorkerRuntime({ DATABASE_URL: undefined })).toBe(false);
    ensureDingTalkDirectorySyncWorkerStarted();
    expect(vi.mocked(getServerDB)).not.toHaveBeenCalled();
  });
});
