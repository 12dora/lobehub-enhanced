// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

const mockListPremium = vi.fn();
const mockListInstanceIds = vi.fn();
const mockGetDetail = vi.fn();
const mockListTemplates = vi.fn();
const mockGetUsers = vi.fn();
const mockCountPending = vi.fn();

const redisBag = vi.hoisted(() => ({ current: null as FakeRedis | null }));

class FakeRedis {
  readonly store = new Map<string, { expiresAt: number; value: string }>();

  private live(key: string) {
    const row = this.store.get(key);
    if (!row) return undefined;
    if (row.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return row;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, mode?: string, ttl?: number, nx?: string) {
    if (nx === 'NX' && this.live(key)) return null;
    let expiresAt = Number.POSITIVE_INFINITY;
    if (mode === 'EX' && typeof ttl === 'number') expiresAt = Date.now() + ttl * 1000;
    if (mode === 'PX' && typeof ttl === 'number') expiresAt = Date.now() + ttl;
    this.store.set(key, { expiresAt, value });
    return 'OK';
  }

  async incr(key: string) {
    const next = Number(this.live(key)?.value ?? '0') + 1;
    const existing = this.live(key);
    this.store.set(key, {
      expiresAt: existing?.expiresAt ?? Number.POSITIVE_INFINITY,
      value: String(next),
    });
    return next;
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count += 1;
    return count;
  }
}

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = (...args: unknown[]) => mockGetUsers(...args);
  },
}));

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisBag.current,
}));
vi.mock('./api', () => ({
  countPendingTasks: (...args: unknown[]) => mockCountPending(...args),
  getInstanceDetail: (...args: unknown[]) => mockGetDetail(...args),
  isPremiumUnavailable: (error: unknown) =>
    error instanceof DingtalkWorkspaceError &&
    (error.code === 'DINGTALK_FORBIDDEN' || error.code === 'DINGTALK_PREMIUM_REQUIRED'),
  listInstanceIds: (...args: unknown[]) => mockListInstanceIds(...args),
  listPremiumTodoTasks: (...args: unknown[]) => mockListPremium(...args),
  listVisibleTemplates: (...args: unknown[]) => mockListTemplates(...args),
}));

const {
  invalidatePendingCaches,
  listInitiatedApprovals,
  listPendingApprovals,
  loadVisibleTemplatesCached,
  resetApprovalListCacheForTest,
  setApprovalScanTimeBudgetForTest,
} = await import('./pending');

const {
  approvalSweepLockKey,
  captureApprovalCacheGeneration,
  setApprovalSweepLockTimingForTest,
  writeApprovalScopedCache,
} = await import('./cache');

const templates = [{ name: '请假', processCode: 'PROC-1' }];
const db = {} as never;

describe('pending listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    redisBag.current = null;
    resetApprovalListCacheForTest();
    mockGetUsers.mockResolvedValue([]);
    mockCountPending.mockResolvedValue(1);
  });

  it('returns empty pending without scanning when the todo count is 0', async () => {
    mockCountPending.mockResolvedValueOnce(0);
    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(result).toEqual({ rows: [], truncated: false });
    expect(mockListPremium).not.toHaveBeenCalled();
    expect(mockListInstanceIds).not.toHaveBeenCalled();
    expect(mockGetDetail).not.toHaveBeenCalled();
  });

  it('uses the premium pending list when it succeeds', async () => {
    mockListPremium.mockResolvedValueOnce({
      hasMore: false,
      list: [
        {
          formMassage: '3天',
          originatorName: '李四',
          processCreateTime: '2026-01-01T00:00Z',
          processInstanceId: 'inst-1',
          taskId: 't-1',
          title: '请假',
        },
      ],
    });
    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(result.rows[0]).toMatchObject({
      originatorName: '李四',
      processInstanceId: 'inst-1',
      summary: [{ label: '表单', value: '3天' }],
      taskId: 't-1',
      title: '请假',
    });
    expect(result.truncated).toBe(false);
    expect(mockListInstanceIds).not.toHaveBeenCalled();
    expect(mockGetDetail).not.toHaveBeenCalled();
  });

  it('fetches instance detail only when a premium row is missing title or form summary', async () => {
    mockListPremium.mockResolvedValueOnce({
      hasMore: false,
      list: [
        {
          originatorName: '李四',
          processCreateTime: '2026-01-01T00:00Z',
          processInstanceId: 'inst-missing',
          taskId: 't-missing',
          title: '请假',
        },
      ],
    });
    mockGetDetail.mockResolvedValueOnce({
      formComponentValues: [{ name: '天数', value: '3' }],
      originatorUserId: 'other',
      processInstanceId: 'inst-missing',
      tasks: [],
      title: '请假',
    });

    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockGetDetail).toHaveBeenCalledTimes(1);
    expect(mockGetDetail).toHaveBeenCalledWith('inst-missing');
    expect(result.rows[0]?.summary).toEqual([{ label: '天数', value: '3' }]);
  });

  it('fetches instance detail when a premium row is missing the originator or the create time', async () => {
    mockListPremium.mockResolvedValueOnce({
      hasMore: false,
      list: [
        {
          formMassage: '3天',
          processInstanceId: 'inst-who',
          taskId: 't-who',
          title: '请假',
        },
        {
          formMassage: '1天',
          originatorName: '李四',
          processInstanceId: 'inst-when',
          taskId: 't-when',
          title: '出差',
        },
      ],
    });
    mockGetDetail.mockImplementation(async (id: string) => ({
      createTime: id === 'inst-when' ? '2026-02-02T00:00:00.000Z' : '2026-03-03T00:00:00.000Z',
      formComponentValues: [],
      originatorUserId: 'staff-9',
      processInstanceId: id,
      tasks: [],
      title: id,
    }));
    mockGetUsers.mockResolvedValueOnce([{ name: '赵六', staffId: 'staff-9' }]);

    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockGetDetail).toHaveBeenCalledTimes(2);
    expect(result.rows.find((row) => row.processInstanceId === 'inst-who')).toMatchObject({
      createdAt: '2026-03-03T00:00:00.000Z',
      originatorName: '赵六',
    });
    expect(result.rows.find((row) => row.processInstanceId === 'inst-when')).toMatchObject({
      createdAt: '2026-02-02T00:00:00.000Z',
      originatorName: '李四',
    });
  });

  it('falls back to a bounded scan on premium-required', async () => {
    mockListPremium.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValueOnce({ ids: ['inst-1', 'inst-2'], truncated: false });
    mockGetDetail.mockImplementation(async (id: string) => ({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [{ name: '事由', value: 'x' }],
      originatorUserId: 'other',
      processInstanceId: id,
      tasks:
        id === 'inst-1'
          ? [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }]
          : [{ status: 'COMPLETED', taskId: 't-2', userId: 'me' }],
      title: `title-${id}`,
    }));

    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].taskId).toBe('t-1');
    expect(result.rows[0].processName).toBe('请假');
  });

  it('caches pending results for 5 minutes and rescans when refresh is set', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    mockListPremium.mockResolvedValue({ hasMore: false, list: [] });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    await vi.advanceTimersByTimeAsync(60_001);
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListPremium).toHaveBeenCalledTimes(1);
    await listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockListPremium).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListPremium).toHaveBeenCalledTimes(3);
  });

  it('lists initiated instances with originator filter', async () => {
    mockListInstanceIds.mockResolvedValueOnce({ ids: ['inst-9'], truncated: false });
    mockGetDetail.mockResolvedValueOnce({
      createTime: '2026-01-02T00:00Z',
      formComponentValues: [],
      originatorUserId: 'me',
      processInstanceId: 'inst-9',
      status: 'RUNNING',
      tasks: [],
      title: '我发起的',
    });
    const result = await listInitiatedApprovals({
      db,
      staffId: 'me',
      status: 'RUNNING',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledWith(
      expect.objectContaining({
        processCode: 'PROC-1',
        statuses: ['RUNNING'],
      }),
    );
    expect(result.rows[0].processInstanceId).toBe('inst-9');
  });

  it('resolves originator names from the directory in one batch lookup', async () => {
    mockListPremium.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValueOnce({ ids: ['inst-1', 'inst-2'], truncated: false });
    mockGetUsers.mockResolvedValueOnce([{ name: '王经理', staffId: 'mgr' }]);
    mockGetDetail.mockImplementation(async (id: string) => ({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'mgr',
      processInstanceId: id,
      tasks: [{ status: 'RUNNING', taskId: `t-${id}`, userId: 'me' }],
      title: `title-${id}`,
    }));

    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockGetUsers).toHaveBeenCalledTimes(1);
    expect(mockGetUsers).toHaveBeenCalledWith(['mgr']);
    expect(result.rows.every((row) => row.originatorName === '王经理')).toBe(true);
  });

  it('marks the pending scan incomplete when some templates are rate-limited', async () => {
    mockCountPending.mockResolvedValue(2);
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds
      .mockResolvedValueOnce({ ids: ['inst-1'], truncated: false })
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });

    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates: [
        { name: '请假', processCode: 'PROC-1' },
        { name: '报销', processCode: 'PROC-2' },
      ],
      userId: 'user-1',
    });
    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.incomplete).toEqual({
      reason: 'rate_limited',
      scannedTemplates: 1,
      totalTemplates: 2,
    });
  });

  it('throws DINGTALK_RATE_LIMITED when no template could be scanned', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    await expect(
      listPendingApprovals({
        db,
        staffId: 'me',
        templates: [
          { name: '请假', processCode: 'PROC-1' },
          { name: '报销', processCode: 'PROC-2' },
        ],
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_RATE_LIMITED' });
  });

  it('returns incomplete cap when instance-id listing is truncated', async () => {
    mockCountPending.mockResolvedValue(2);
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValueOnce({ ids: ['inst-1'], truncated: true });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });
    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(result.truncated).toBe(true);
    expect(result.incomplete).toEqual({
      reason: 'cap',
      scannedTemplates: 1,
      totalTemplates: 1,
    });
  });

  it('throws when the scan budget expires before any template is read', async () => {
    setApprovalScanTimeBudgetForTest(0);
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    await expect(
      listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_RATE_LIMITED' });
    expect(mockListInstanceIds).not.toHaveBeenCalled();
  });

  it('scans most-recently-modified templates first', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: [], truncated: false });
    await listPendingApprovals({
      db,
      staffId: 'me',
      templates: [
        { modifiedAt: '2020-01-01T00:00:00Z', name: '旧', processCode: 'PROC-OLD' },
        { modifiedAt: '2026-06-01T00:00:00Z', name: '新', processCode: 'PROC-NEW' },
      ],
      userId: 'user-1',
    });
    expect(mockListInstanceIds.mock.calls[0]?.[0]).toMatchObject({ processCode: 'PROC-NEW' });
  });

  it('caches incomplete pending results for 30s only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    mockCountPending.mockResolvedValue(2);
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds
      .mockResolvedValueOnce({ ids: ['inst-1'], truncated: false })
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'))
      .mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });
    const twoTemplates = [
      { name: '请假', processCode: 'PROC-1' },
      { name: '报销', processCode: 'PROC-2' },
    ];
    await listPendingApprovals({
      db,
      staffId: 'me',
      templates: twoTemplates,
      userId: 'user-1',
    });
    await listPendingApprovals({
      db,
      staffId: 'me',
      templates: twoTemplates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_001);
    await listPendingApprovals({
      db,
      staffId: 'me',
      templates: twoTemplates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds.mock.calls.length).toBeGreaterThan(2);
  });

  it('stops the pending scan once the known todo count is found', async () => {
    mockCountPending.mockResolvedValue(1);
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockImplementation(async (req: { processCode: string }) => {
      if (req.processCode === 'PROC-1') return { ids: ['inst-1'], truncated: false };
      return { ids: ['inst-x'], truncated: false };
    });
    mockGetDetail.mockImplementation(async (id: string) => ({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: id,
      tasks:
        id === 'inst-1'
          ? [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }]
          : [{ status: 'RUNNING', taskId: 't-x', userId: 'other' }],
      title: `title-${id}`,
    }));
    const many = [
      { name: '请假', processCode: 'PROC-1' },
      { name: '报销', processCode: 'PROC-2' },
      { name: '合同', processCode: 'PROC-3' },
      { name: '采购', processCode: 'PROC-4' },
      { name: '用印', processCode: 'PROC-5' },
    ];
    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates: many,
      userId: 'user-1',
    });
    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(mockListInstanceIds.mock.calls.length).toBeLessThan(many.length);
  });

  it('reuses one template sweep for pending and initiated', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'me',
      processInstanceId: 'inst-1',
      status: 'RUNNING',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });
    const [pending, initiated] = await Promise.all([
      listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' }),
      listInitiatedApprovals({ db, staffId: 'me', status: 'RUNNING', templates, userId: 'user-1' }),
    ]);
    expect(pending.rows).toHaveLength(1);
    expect(initiated.rows).toHaveLength(1);
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    expect(mockListInstanceIds).toHaveBeenCalledWith(
      expect.objectContaining({ processCode: 'PROC-1', statuses: ['RUNNING'] }),
    );
  });

  it('filters initiated scans by processCode so a targeted question is 1-2 calls', async () => {
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-9'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-02T00:00Z',
      formComponentValues: [],
      originatorUserId: 'me',
      processInstanceId: 'inst-9',
      status: 'COMPLETED',
      tasks: [],
      title: '我发起的',
    });
    const result = await listInitiatedApprovals({
      db,
      processCode: 'PROC-2',
      staffId: 'me',
      status: 'COMPLETED',
      templates: [
        { name: '请假', processCode: 'PROC-1' },
        { name: '报销', processCode: 'PROC-2' },
      ],
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    expect(mockListInstanceIds).toHaveBeenCalledWith(
      expect.objectContaining({
        processCode: 'PROC-2',
        statuses: ['COMPLETED'],
        userIds: ['me'],
      }),
    );
    expect(result.rows[0]?.processInstanceId).toBe('inst-9');
  });

  it('marks initiated lists incomplete instead of returning a silent empty page', async () => {
    mockListInstanceIds
      .mockResolvedValueOnce({ ids: [], truncated: false })
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    const result = await listInitiatedApprovals({
      db,
      staffId: 'me',
      templates: [
        { name: '请假', processCode: 'PROC-1' },
        { name: '报销', processCode: 'PROC-2' },
      ],
      userId: 'user-1',
    });
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.incomplete?.reason).toBe('rate_limited');
  });

  it('does not report a complete pending list when the live count exceeds the cached sweep', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockCountPending.mockResolvedValueOnce(1).mockResolvedValue(2);
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });
    const first = await listPendingApprovals({
      db,
      limit: 5,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(first.rows).toHaveLength(1);
    expect(first.truncated).toBe(false);
    const second = await listPendingApprovals({
      db,
      limit: 10,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(second.rows).toHaveLength(1);
    expect(second.truncated).toBe(true);
    expect(second.incomplete).toEqual({
      reason: 'cap',
      scannedTemplates: 1,
      totalTemplates: 1,
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
  });

  it('keeps an identical pending scan for 5 minutes unless refresh is set', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockCountPending.mockResolvedValue(1);
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockImplementation(async (id: string) => ({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: id,
      tasks: [{ status: 'RUNNING', taskId: `t-${id}`, userId: 'me' }],
      title: `title-${id}`,
    }));
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    mockCountPending.mockResolvedValue(2);
    const cached = await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(cached.rows).toHaveLength(1);
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1', 'inst-2'], truncated: false });
    const refreshed = await listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds.mock.calls.length).toBeGreaterThan(1);
    expect(refreshed.rows).toHaveLength(2);
    expect(refreshed.truncated).toBe(false);
    expect(refreshed.incomplete).toBeUndefined();
  });

  it('invalidatePendingCaches drops the per-user pending result so the next list refetches', async () => {
    mockCountPending.mockResolvedValue(0);
    const first = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(first.rows).toEqual([]);
    expect(mockCountPending).toHaveBeenCalledTimes(1);
    expect(mockListPremium).not.toHaveBeenCalled();

    invalidatePendingCaches('user-1');
    mockCountPending.mockResolvedValue(1);
    mockListPremium.mockResolvedValueOnce({
      hasMore: false,
      list: [
        {
          processInstanceId: 'inst-new',
          taskId: 't-new',
          title: '请假',
        },
      ],
    });
    mockGetDetail.mockResolvedValueOnce({
      formComponentValues: [],
      originatorUserId: 'me',
      processInstanceId: 'inst-new',
      tasks: [{ status: 'RUNNING', taskId: 't-new', userId: 'me' }],
      title: '请假',
    });

    const second = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockCountPending).toHaveBeenCalledTimes(2);
    expect(mockListPremium).toHaveBeenCalledTimes(1);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.processInstanceId).toBe('inst-new');
  });

  it('invalidatePendingCaches drops the shared sweep cache', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    invalidatePendingCaches('user-1');
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(2);
  });

  it('invalidatePendingCaches does not drop another user cache', async () => {
    mockListPremium.mockResolvedValue({ hasMore: false, list: [] });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-2' });
    expect(mockListPremium).toHaveBeenCalledTimes(2);
    invalidatePendingCaches('user-1');
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-2' });
    expect(mockListPremium).toHaveBeenCalledTimes(2);
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListPremium).toHaveBeenCalledTimes(3);
  });

  it('invalidatePendingCaches never throws', () => {
    expect(() => invalidatePendingCaches('')).not.toThrow();
    expect(() => invalidatePendingCaches('user-1')).not.toThrow();
  });

  it('does not reuse a pending result across DingTalk staff ids', async () => {
    mockListPremium.mockResolvedValue({ hasMore: false, list: [] });
    await listPendingApprovals({ db, staffId: 'staff-a', templates, userId: 'user-1' });
    await listPendingApprovals({ db, staffId: 'staff-b', templates, userId: 'user-1' });
    expect(mockListPremium).toHaveBeenCalledTimes(2);
    await listPendingApprovals({ db, staffId: 'staff-a', templates, userId: 'user-1' });
    expect(mockListPremium).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a shared sweep across DingTalk staff ids', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'staff-a',
      processInstanceId: 'inst-1',
      status: 'RUNNING',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'staff-a' }],
      title: 'title-inst-1',
    });
    await listPendingApprovals({ db, staffId: 'staff-a', templates, userId: 'user-1' });
    await listInitiatedApprovals({
      db,
      staffId: 'staff-a',
      status: 'RUNNING',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    await listInitiatedApprovals({
      db,
      staffId: 'staff-b',
      status: 'RUNNING',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(2);
  });

  it('keeps 我发起的 for 1 minute while 待我审批 stays cached for 5', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockCountPending.mockResolvedValue(1);
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'me',
      processInstanceId: 'inst-1',
      status: 'RUNNING',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    await listInitiatedApprovals({
      db,
      staffId: 'me',
      status: 'RUNNING',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_001);
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    await listInitiatedApprovals({
      db,
      staffId: 'me',
      status: 'RUNNING',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(2);
  });

  it('keys visible templates by staff id and bypasses them on refresh', async () => {
    mockListTemplates
      .mockResolvedValueOnce([{ name: '请假', processCode: 'A' }])
      .mockResolvedValue([{ name: '报销', processCode: 'B' }]);
    const first = await loadVisibleTemplatesCached('user-1', 'staff-a', 60_000);
    const again = await loadVisibleTemplatesCached('user-1', 'staff-a', 60_000);
    expect(again).toEqual(first);
    expect(mockListTemplates).toHaveBeenCalledTimes(1);

    const other = await loadVisibleTemplatesCached('user-1', 'staff-b', 60_000);
    expect(other[0]?.processCode).toBe('B');
    expect(mockListTemplates).toHaveBeenCalledTimes(2);

    const refreshed = await loadVisibleTemplatesCached('user-1', 'staff-a', 60_000, true);
    expect(refreshed[0]?.processCode).toBe('B');
    expect(mockListTemplates).toHaveBeenCalledTimes(3);
    expect(mockListTemplates).toHaveBeenLastCalledWith('staff-a');
  });

  it('starts a fresh sweep on refresh instead of joining one already running', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockCountPending.mockResolvedValue(1);
    let releaseFirst: (value: { ids: string[]; truncated: boolean }) => void = () => {};
    const firstGate = new Promise<{ ids: string[]; truncated: boolean }>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    mockListInstanceIds.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return firstGate;
      return Promise.resolve({ ids: ['inst-2'], truncated: false });
    });
    mockGetDetail.mockImplementation(async (id: string) => ({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: id,
      tasks: [{ status: 'RUNNING', taskId: `t-${id}`, userId: 'me' }],
      title: `title-${id}`,
    }));

    const first = listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    await vi.waitFor(() => expect(mockListInstanceIds).toHaveBeenCalledTimes(1));
    const refreshed = listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    try {
      await vi.waitFor(() => expect(mockListInstanceIds).toHaveBeenCalledTimes(2));
    } finally {
      releaseFirst({ ids: ['inst-1'], truncated: false });
    }

    const [firstResult, refreshedResult] = await Promise.all([first, refreshed]);
    expect(firstResult.rows.map((row) => row.processInstanceId)).toEqual(['inst-1']);
    expect(refreshedResult.rows.map((row) => row.processInstanceId)).toEqual(['inst-2']);

    const cached = await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(cached.rows.map((row) => row.processInstanceId)).toEqual(['inst-2']);
    expect(mockListInstanceIds).toHaveBeenCalledTimes(2);
  });

  it('single-flights concurrent refreshes for the same user and staff', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockCountPending.mockResolvedValue(1);
    let release: (value: { ids: string[]; truncated: boolean }) => void = () => {};
    const gate = new Promise<{ ids: string[]; truncated: boolean }>((resolve) => {
      release = resolve;
    });
    mockListInstanceIds.mockImplementation(() => gate);
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });

    const first = listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    await vi.waitFor(() => expect(mockListInstanceIds).toHaveBeenCalledTimes(1));
    const second = listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    release({ ids: ['inst-1'], truncated: false });
    const [left, right] = await Promise.all([first, second]);
    expect(left.rows).toHaveLength(1);
    expect(right.rows).toHaveLength(1);
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
  });

  it('reads a pending list from Redis after the local cache is dropped', async () => {
    redisBag.current = new FakeRedis();
    mockListPremium.mockResolvedValue({ hasMore: false, list: [] });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    resetApprovalListCacheForTest();
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListPremium).toHaveBeenCalledTimes(1);
    expect(mockCountPending).toHaveBeenCalledTimes(1);
  });

  it('invalidating a user drops the Redis pending list', async () => {
    redisBag.current = new FakeRedis();
    mockListPremium.mockResolvedValue({ hasMore: false, list: [] });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    invalidatePendingCaches('user-1');
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockCountPending).toHaveBeenCalledTimes(2);
    expect(mockListPremium).toHaveBeenCalledTimes(2);
  });

  it('refresh reuses an in-flight sweep held by another process', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    await redis.set(
      approvalSweepLockKey('user-1', 'me'),
      JSON.stringify({ mode: 'refresh', token: 'other-process' }),
      'PX',
      70_000,
      'NX',
    );
    setApprovalSweepLockTimingForTest({
      pollMs: 1,
      sleep: async () => {
        const generation = await captureApprovalCacheGeneration('user-1');
        await writeApprovalScopedCache({
          generation,
          now: Date.now(),
          staffId: 'me',
          suffix: 'sweep',
          ttlMs: 60_000,
          userId: 'user-1',
          value: {
            details: [
              {
                detail: {
                  createTime: '2026-01-01T00:00Z',
                  formComponentValues: [],
                  originatorUserId: 'other',
                  processInstanceId: 'inst-remote',
                  tasks: [{ status: 'RUNNING', taskId: 't-remote', userId: 'me' }],
                  title: 'remote',
                },
                processCode: 'PROC-1',
              },
            ],
          },
        });
      },
      waitMs: 1_000,
    });
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    const result = await listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).not.toHaveBeenCalled();
    expect(result.rows.map((row) => row.processInstanceId)).toEqual(['inst-remote']);
  });

  it('scans when Redis cannot answer the sweep lock', async () => {
    redisBag.current = {
      del: async () => {
        throw new Error('redis down');
      },
      get: async () => {
        throw new Error('redis down');
      },
      incr: async () => {
        throw new Error('redis down');
      },
      set: async () => {
        throw new Error('redis down');
      },
    } as unknown as FakeRedis;
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: 'title-inst-1',
    });
    const result = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(1);
  });

  it('refetches instance details on a refresh sweep', async () => {
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: '请假',
    });
    await listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(mockGetDetail).toHaveBeenCalledWith('inst-1', { fresh: true });
  });

  it('caches a sweep whose full details would exceed the payload cap', async () => {
    redisBag.current = new FakeRedis();
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [{ name: '事由', value: '出差' }],
      operationRecords: [{ remark: 'x'.repeat(1_200_000) }],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: '请假',
    });
    const first = await listPendingApprovals({
      db,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(first.rows[0]).toMatchObject({
      summary: [{ label: '事由', value: '出差' }],
      title: '请假',
    });
    const second = await listPendingApprovals({
      db,
      limit: 21,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(second.rows[0]?.title).toBe('请假');
    expect(mockGetDetail).toHaveBeenCalledTimes(1);
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
  });

  it('does not return a pre-refresh sweep or bump the epoch while another replica holds the lock', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    await redis.set(
      approvalSweepLockKey('user-1', 'me'),
      JSON.stringify({ mode: 'scan', token: 'other-process' }),
      'PX',
      70_000,
      'NX',
    );
    const generation = await captureApprovalCacheGeneration('user-1');
    await writeApprovalScopedCache({
      generation,
      now: Date.now(),
      staffId: 'me',
      suffix: 'sweep',
      ttlMs: 60_000,
      userId: 'user-1',
      value: {
        details: [
          {
            detail: {
              createTime: '2026-01-01T00:00Z',
              formComponentValues: [],
              originatorUserId: 'other',
              processInstanceId: 'inst-stale',
              tasks: [{ status: 'RUNNING', taskId: 't-stale', userId: 'me' }],
              title: 'stale',
            },
            processCode: 'PROC-1',
          },
        ],
      },
    });
    setApprovalSweepLockTimingForTest({ pollMs: 1, sleep: async () => undefined, waitMs: 5 });
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-new'], truncated: false });
    mockGetDetail.mockResolvedValue({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-new',
      tasks: [{ status: 'RUNNING', taskId: 't-new', userId: 'me' }],
      title: 'new',
    });
    const result = await listPendingApprovals({
      db,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(result.rows.map((row) => row.processInstanceId)).toEqual(['inst-new']);
    expect(mockListInstanceIds).toHaveBeenCalledTimes(1);
    expect([...redis.store.keys()].some((key) => key.includes('sweep-epoch'))).toBe(false);
  });

  it('a refresh generation bump discards a stale pending write from an earlier capture', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const stale = await captureApprovalCacheGeneration('user-1');
    mockListPremium.mockResolvedValue({ hasMore: false, list: [] });
    await listPendingApprovals({
      db,
      limit: 20,
      refresh: true,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    await writeApprovalScopedCache({
      generation: stale,
      now: Date.now(),
      staffId: 'me',
      suffix: 'pending:20',
      ttlMs: 60_000,
      userId: 'user-1',
      value: {
        rows: [
          {
            processInstanceId: 'inst-stale',
            taskId: 't-stale',
            title: '过期',
          },
        ],
        truncated: false,
      },
    });
    const cached = await listPendingApprovals({
      db,
      limit: 20,
      staffId: 'me',
      templates,
      userId: 'user-1',
    });
    expect(cached.rows).toEqual([]);
    expect(mockListPremium).toHaveBeenCalledTimes(1);
  });
});
