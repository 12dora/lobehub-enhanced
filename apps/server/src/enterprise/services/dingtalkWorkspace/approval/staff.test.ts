// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  candidates?: unknown;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

const mockResolveStaff = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('../directory', () => ({
  resolveStaff: (...args: unknown[]) => mockResolveStaff(...args),
}));
vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = (...args: unknown[]) => mockGetUsers(...args);
  },
}));

const { attachInstancePersonNames, formatStaffLabel, requireStaff, requireStaffList } =
  await import('./staff');

describe('staff resolution', () => {
  beforeEach(() => {
    mockResolveStaff.mockReset();
    mockGetUsers.mockReset();
  });

  it('returns a resolved staff hit', async () => {
    mockResolveStaff.mockResolvedValueOnce({
      deptPath: '产品部',
      name: '李四',
      staffId: 's-2',
      unionId: 'u-2',
    });
    await expect(requireStaff({} as never, 'staff:s-2')).resolves.toMatchObject({
      name: '李四',
      staffId: 's-2',
    });
  });

  it('throws DINGTALK_AMBIGUOUS with candidates', async () => {
    mockResolveStaff.mockResolvedValueOnce({
      ambiguous: [
        { deptPath: 'A', name: '李四', staffId: '1', unionId: '' },
        { deptPath: 'B', name: '李四', staffId: '2', unionId: '' },
      ],
    });
    await expect(requireStaff({} as never, '李四')).rejects.toMatchObject({
      candidates: expect.arrayContaining([expect.objectContaining({ staffId: '1' })]),
      code: 'DINGTALK_AMBIGUOUS',
    });
  });

  it('dedupes staff tokens in a list', async () => {
    mockResolveStaff.mockResolvedValue({
      deptPath: '',
      name: '李四',
      staffId: 's-2',
      unionId: '',
    });
    const list = await requireStaffList({} as never, ['staff:s-2', 'staff:s-2']);
    expect(list).toHaveLength(1);
  });

  it('formats name and department', () => {
    expect(formatStaffLabel({ deptPath: '产品部', name: '张三' })).toBe('张三 · 产品部');
    expect(formatStaffLabel({ name: '张三' })).toBe('张三');
  });

  it('attaches directory names for originator, tasks, operations and cc in one lookup', async () => {
    mockGetUsers.mockResolvedValueOnce([
      { name: '张三', staffId: 'me' },
      { name: '李四', staffId: 'originator' },
      { name: '王五', staffId: 'cc-1' },
      { name: '赵六', staffId: 'op-cc' },
    ]);
    const named = await attachInstancePersonNames({} as never, {
      ccUserIds: ['cc-1'],
      formComponentValues: [],
      operationRecords: [
        { ccUserIds: ['op-cc'], showName: '经办人', type: 'COMMENT', userId: 'me' },
      ],
      originatorUserId: 'originator',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: '出差申请',
    });
    expect(mockGetUsers).toHaveBeenCalledTimes(1);
    expect(mockGetUsers).toHaveBeenCalledWith(
      expect.arrayContaining(['me', 'originator', 'cc-1', 'op-cc']),
    );
    expect(named.originatorName).toBe('李四');
    expect(named.tasks[0]?.name).toBe('张三');
    expect(named.operationRecords[0]?.name).toBe('张三');
    expect(named.operationRecords[0]?.ccUsers).toEqual([{ name: '赵六', userId: 'op-cc' }]);
    expect(named.ccUsers).toEqual([{ name: '王五', userId: 'cc-1' }]);
  });

  it('leaves name empty on a directory miss and falls back to operation showName', async () => {
    mockGetUsers.mockResolvedValueOnce([]);
    const named = await attachInstancePersonNames({} as never, {
      ccUserIds: ['cc-miss'],
      formComponentValues: [],
      operationRecords: [{ showName: '外部联系人', userId: 'ext-1' }],
      originatorUserId: 'unknown',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'unknown' }],
      title: 'x',
    });
    expect(named.originatorName).toBeUndefined();
    expect(named.tasks[0]?.name).toBeUndefined();
    expect(named.ccUsers).toEqual([{ name: undefined, userId: 'cc-miss' }]);
    expect(named.operationRecords[0]?.name).toBe('外部联系人');
  });
});
