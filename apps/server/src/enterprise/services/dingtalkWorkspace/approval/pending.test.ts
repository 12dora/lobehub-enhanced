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

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = (...args: unknown[]) => mockGetUsers(...args);
  },
}));

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
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
  resetApprovalListCacheForTest,
  setApprovalScanTimeBudgetForTest,
} = await import('./pending');

const templates = [{ name: '请假', processCode: 'PROC-1' }];
const db = {} as never;

describe('pending listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
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
    mockGetDetail.mockResolvedValueOnce({
      formComponentValues: [{ name: '天数', value: '3' }],
      originatorUserId: 'other',
      processInstanceId: 'inst-1',
      tasks: [],
      title: '请假',
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
      taskId: 't-1',
      title: '请假',
    });
    expect(result.truncated).toBe(false);
    expect(mockListInstanceIds).not.toHaveBeenCalled();
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

  it('caches pending results for 60s', async () => {
    mockListPremium.mockResolvedValue({ hasMore: false, list: [] });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListPremium).toHaveBeenCalledTimes(1);
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

  it('expires a complete shared sweep after 60s so a higher todo count is rescanned', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    mockListPremium.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED'));
    mockCountPending.mockResolvedValue(1);
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
    await vi.advanceTimersByTimeAsync(60_001);
    mockCountPending.mockResolvedValue(2);
    mockListInstanceIds.mockResolvedValue({ ids: ['inst-1', 'inst-2'], truncated: false });
    mockGetDetail.mockImplementation(async (id: string) => ({
      createTime: '2026-01-01T00:00Z',
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: id,
      tasks: [{ status: 'RUNNING', taskId: `t-${id}`, userId: 'me' }],
      title: `title-${id}`,
    }));
    const result = await listPendingApprovals({ db, staffId: 'me', templates, userId: 'user-1' });
    expect(mockListInstanceIds.mock.calls.length).toBeGreaterThan(1);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.incomplete).toBeUndefined();
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
});
