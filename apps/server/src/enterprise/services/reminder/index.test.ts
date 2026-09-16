// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearch = vi.fn();
const mockGetUsers = vi.fn();
const mockGetDepartment = vi.fn();
const mockSubtreeMemberStaffIds = vi.fn();
const mockCreate = vi.fn();
const mockListCreated = vi.fn();
const mockListReceived = vi.fn();
const mockCancel = vi.fn();
const mockHideReceived = vi.fn();
const mockFindById = vi.fn();
const mockResolveStaffId = vi.fn();

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: vi.fn(() => ({
    getDepartment: mockGetDepartment,
    getUsers: mockGetUsers,
    search: mockSearch,
    subtreeMemberStaffIds: mockSubtreeMemberStaffIds,
  })),
}));

vi.mock('@/database/models/reminder', () => ({
  ReminderModel: vi.fn(() => ({
    cancel: mockCancel,
    create: mockCreate,
    hideReceived: mockHideReceived,
    listCreated: mockListCreated,
    listReceived: mockListReceived,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: mockFindById },
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/resolveStaffId', () => ({
  resolveDingTalkStaffId: (...args: unknown[]) => mockResolveStaffId(...args),
}));

vi.mock('./worker', () => ({
  ensureReminderWorkerStarted: vi.fn(),
  isReminderWorkerRuntime: vi.fn(),
  REMINDER_SWEEP_INTERVAL_MS: 60_000,
  runReminderSweep: vi.fn(),
  stopReminderWorker: vi.fn(),
  stopReminderWorkerForTest: vi.fn(),
}));

const { ReminderService, ReminderServiceError, REMINDER_TIME_PAST, REMINDER_RECIPIENT_UNKNOWN } =
  await import('./index');

const futureIso = () => new Date(Date.now() + 60 * 60_000).toISOString();

describe('ReminderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ fullName: '张三' });
    mockSearch.mockResolvedValue({ departments: [], users: [] });
    mockGetUsers.mockResolvedValue([]);
    mockGetDepartment.mockResolvedValue(undefined);
    mockSubtreeMemberStaffIds.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'rem_1', recipients: [] });
    mockResolveStaffId.mockResolvedValue('staff_me');
  });

  it('marks directory hits ambiguous when two users share a name', async () => {
    mockSearch.mockResolvedValue({
      departments: [],
      users: [
        {
          active: true,
          deptPath: '捷发 / 安环部',
          leafDeptId: 'd1',
          leafDeptName: '安环部',
          name: '胡玉琴A',
          staffId: 'a',
        },
        {
          active: true,
          deptPath: '捷发 / 财务部',
          leafDeptId: 'd2',
          leafDeptName: '财务部',
          name: '胡玉琴A',
          staffId: 'b',
        },
      ],
    });
    const service = new ReminderService({} as any, 'user_1');
    const result = await service.searchDirectory('胡玉琴');
    expect(result.ambiguous).toBe(true);
    expect(result.users.every((user) => user.ambiguous)).toBe(true);
    expect(result.serverNow).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects a fireAt that is not more than 30s in the future', async () => {
    const service = new ReminderService({} as any, 'user_1');
    await expect(
      service.create({
        content: '交报告',
        fireAt: new Date(Date.now() + 1000).toISOString(),
        recipients: [{ kind: 'user', staffId: 'staff_hyq' }],
      }),
    ).rejects.toMatchObject({ code: REMINDER_TIME_PAST });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects an unknown recipient', async () => {
    mockGetUsers.mockResolvedValue([]);
    const service = new ReminderService({} as any, 'user_1');
    await expect(
      service.create({
        content: '交报告',
        fireAt: futureIso(),
        recipients: [{ kind: 'user', staffId: 'missing' }],
      }),
    ).rejects.toBeInstanceOf(ReminderServiceError);
    await expect(
      service.create({
        content: '交报告',
        fireAt: futureIso(),
        recipients: [{ kind: 'user', staffId: 'missing' }],
      }),
    ).rejects.toMatchObject({ code: REMINDER_RECIPIENT_UNKNOWN });
  });

  it('returns needsConfirmation when a department subtree is larger than 30', async () => {
    mockGetDepartment.mockResolvedValue({ name: '安环部', pathNames: '捷发 / 安环部' });
    mockSubtreeMemberStaffIds.mockResolvedValue(Array.from({ length: 31 }, (_, i) => `s${i}`));
    const service = new ReminderService({} as any, 'user_1');
    const result = await service.create({
      content: '周五开会',
      fireAt: futureIso(),
      recipients: [{ deptId: 'dept_ah', kind: 'department' }],
    });
    expect(result).toEqual({
      audience: [{ deptId: 'dept_ah', memberCount: 31, name: '安环部' }],
      needsConfirmation: true,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates after confirmLargeAudience and snapshots the directory', async () => {
    mockGetUsers.mockResolvedValue([
      {
        active: true,
        deptPath: '捷发 / 安环部',
        leafDeptId: 'd1',
        leafDeptName: '安环部',
        name: '胡玉琴A',
        staffId: 'staff_hyq',
      },
    ]);
    const service = new ReminderService({} as any, 'user_1');
    await service.create({
      content: '交安全报告',
      fireAt: futureIso(),
      recipients: [{ kind: 'user', staffId: 'staff_hyq' }],
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '交安全报告',
        creatorName: '张三',
        recipients: [
          expect.objectContaining({
            deptName: '安环部',
            displayName: '胡玉琴A',
            kind: 'user',
            staffId: 'staff_hyq',
          }),
        ],
      }),
    );
  });

  it('listReceived is empty when the caller has no DingTalk staff id', async () => {
    mockResolveStaffId.mockResolvedValue(null);
    const service = new ReminderService({} as any, 'user_1');
    await expect(service.listReceived()).resolves.toEqual([]);
    expect(mockListReceived).not.toHaveBeenCalled();
  });
});
