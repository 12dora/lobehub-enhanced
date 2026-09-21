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

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = (...args: unknown[]) => mockGetUsers(...args);
  },
}));

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('./api', () => ({
  getInstanceDetail: (...args: unknown[]) => mockGetDetail(...args),
  isPremiumUnavailable: (error: unknown) =>
    error instanceof DingtalkWorkspaceError &&
    (error.code === 'DINGTALK_FORBIDDEN' || error.code === 'DINGTALK_PREMIUM_REQUIRED'),
  listInstanceIds: (...args: unknown[]) => mockListInstanceIds(...args),
  listPremiumTodoTasks: (...args: unknown[]) => mockListPremium(...args),
  listVisibleTemplates: (...args: unknown[]) => mockListTemplates(...args),
}));

const { listInitiatedApprovals, listPendingApprovals, resetApprovalListCacheForTest } =
  await import('./pending');

const templates = [{ name: '请假', processCode: 'PROC-1' }];
const db = {} as never;

describe('pending listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApprovalListCacheForTest();
    mockGetUsers.mockResolvedValue([]);
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
        userIds: ['me'],
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
});
