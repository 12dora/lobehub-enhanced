// @vitest-environment node
import type { ReminderScheduleInput } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearch = vi.fn();
const mockGetUsers = vi.fn();
const mockGetDepartment = vi.fn();
const mockSubtreeMemberStaffIds = vi.fn();
const mockCreateForTask = vi.fn();
const mockFindByTaskId = vi.fn();
const mockUpdateProfile = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskDelete = vi.fn();
const mockTaskFindById = vi.fn();
const mockTaskResolve = vi.fn();
const mockUpdateHeartbeat = vi.fn();
const mockUpdateStatus = vi.fn();
const mockFindById = vi.fn();
const mockDeliverReminder = vi.fn();

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
    createForTask: mockCreateForTask,
    findByTaskId: mockFindByTaskId,
    updateProfile: mockUpdateProfile,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({
    create: mockTaskCreate,
    delete: mockTaskDelete,
    findById: mockTaskFindById,
    resolve: mockTaskResolve,
    updateHeartbeat: mockUpdateHeartbeat,
    updateStatus: mockUpdateStatus,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: mockFindById },
}));

vi.mock('./worker', () => ({
  deliverReminder: (...args: unknown[]) => mockDeliverReminder(...args),
  ensureReminderWorkerStarted: vi.fn(),
  isReminderWorkerRuntime: vi.fn(),
  REMINDER_SWEEP_INTERVAL_MS: 60_000,
  runReminderSweep: vi.fn(),
  stopReminderWorker: vi.fn(),
  stopReminderWorkerForTest: vi.fn(),
}));

const { REMINDER_TIME_PAST, ReminderTaskService } = await import('./taskReminder');

const hyq = {
  active: true,
  deptPath: '捷发 / 外贸组',
  leafDeptId: 'dept_trade',
  leafDeptName: '外贸组',
  name: '胡玉琴A',
  staffId: 'staff_hyq',
};

const hyqOther = {
  active: true,
  deptPath: '捷发 / 业务部',
  leafDeptId: 'dept_biz',
  leafDeptName: '业务部',
  name: '胡玉琴A',
  staffId: 'staff_hyq_b',
};

const tradeDept = {
  deptId: 'dept_trade',
  memberCount: 8,
  name: '外贸组',
  pathNames: '捷发 / 外贸组',
};

const futureOnce = (): ReminderScheduleInput => {
  const at = new Date(Date.now() + 3 * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(at);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    kind: 'once',
    time: `${pick('hour')}:${pick('minute')}`,
  };
};

const service = (deps?: ConstructorParameters<typeof ReminderTaskService>[3]) =>
  new ReminderTaskService({} as never, 'user_1', undefined, deps);

describe('ReminderTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ fullName: '张三' });
    mockSearch.mockResolvedValue({ departments: [], users: [] });
    mockGetUsers.mockResolvedValue([]);
    mockGetDepartment.mockResolvedValue(undefined);
    mockSubtreeMemberStaffIds.mockResolvedValue([]);
    mockTaskCreate.mockResolvedValue({
      config: { reminder: { kind: 'reminder', reminderId: 'rmd_1' } },
      id: 'task_1',
      identifier: 'T-9',
      status: 'scheduled',
    });
    mockCreateForTask.mockResolvedValue({
      content: '测试一下',
      id: 'rmd_1',
      recipients: [],
      taskId: 'task_1',
    });
    mockDeliverReminder.mockResolvedValue({
      failed: 0,
      firedAt: new Date('2026-09-16T09:35:00+08:00'),
      reminder: { id: 'rmd_1', repeatRule: null, status: 'sent' },
      sent: 1,
      skipped: 0,
    });
  });

  describe('resolveRecipients', () => {
    it('resolves an exact unique name to a user', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });

      const result = await service().resolveRecipients(['胡玉琴A']);

      expect(result).toMatchObject({
        ok: true,
        recipients: [{ displayName: '胡玉琴A', kind: 'user', staffId: 'staff_hyq' }],
      });
      expect(mockSearch).toHaveBeenCalledWith('胡玉琴A', { kind: undefined, limit: 50 });
    });

    it('narrows 姓名·部门 by leaf dept name', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq, hyqOther] });

      const result = await service().resolveRecipients(['胡玉琴A·外贸组']);

      expect(result).toMatchObject({
        ok: true,
        recipients: [{ deptName: '外贸组', staffId: 'staff_hyq' }],
      });
    });

    it('returns ambiguous candidates when two active users share a name', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq, hyqOther] });

      const result = await service().resolveRecipients(['胡玉琴A']);

      expect(result).toEqual({
        ambiguous: [
          {
            candidates: [
              {
                deptPath: '捷发 / 外贸组',
                leafDeptName: '外贸组',
                name: '胡玉琴A',
                staffId: 'staff_hyq',
              },
              {
                deptPath: '捷发 / 业务部',
                leafDeptName: '业务部',
                name: '胡玉琴A',
                staffId: 'staff_hyq_b',
              },
            ],
            query: '胡玉琴A',
          },
        ],
        ok: false,
        unknown: [],
      });
    });

    it('resolves a department name and staff:/dept: prefixes', async () => {
      mockSearch.mockResolvedValue({ departments: [tradeDept], users: [] });
      mockGetUsers.mockResolvedValue([hyq]);
      mockGetDepartment.mockResolvedValue({ name: '外贸组', pathNames: '捷发 / 外贸组' });
      mockSubtreeMemberStaffIds.mockResolvedValue(['a', 'b']);

      const byName = await service().resolveRecipients(['外贸组']);
      expect(byName).toMatchObject({
        ok: true,
        recipients: [{ deptId: 'dept_trade', kind: 'department', memberCount: 8 }],
      });

      const byStaff = await service().resolveRecipients(['staff:staff_hyq']);
      expect(byStaff).toMatchObject({
        ok: true,
        recipients: [{ kind: 'user', staffId: 'staff_hyq' }],
      });

      const byDept = await service().resolveRecipients(['dept:dept_trade']);
      expect(byDept).toMatchObject({
        ok: true,
        recipients: [{ deptId: 'dept_trade', kind: 'department', memberCount: 2 }],
      });
    });

    it('marks unknown queries', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [] });

      await expect(service().resolveRecipients(['不存在的人'])).resolves.toEqual({
        ambiguous: [],
        ok: false,
        unknown: ['不存在的人'],
      });
    });
  });

  describe('createReminderTask', () => {
    it('creates a scheduled reminder task with Asia/Shanghai cron', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });
      const schedule = futureOnce();

      const result = await service().createReminderTask({
        content: '测试一下',
        recipients: ['胡玉琴A'],
        schedule,
      });

      expect(result.status).toBe('created');
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeAgentId: null,
          automationMode: 'schedule',
          instruction: expect.stringContaining('@胡玉琴A·外贸组'),
          name: '测试一下',
          scheduleTimezone: 'Asia/Shanghai',
          status: 'scheduled',
        }),
      );
      const created = mockTaskCreate.mock.calls[0][0];
      expect(created.config.reminder.kind).toBe('reminder');
      expect(created.config.reminder.once).toBe(true);
      expect(created.context.scheduler.scheduleStartedAt).toEqual(expect.any(String));
      expect(mockCreateForTask).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '测试一下',
          taskId: 'task_1',
        }),
      );
    });

    it('rejects a once fire time in the past', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });

      await expect(
        service().createReminderTask({
          content: '过期',
          recipients: ['胡玉琴A'],
          schedule: { date: '2020-01-01', kind: 'once', time: '09:00' },
        }),
      ).rejects.toMatchObject({ code: REMINDER_TIME_PAST });
      expect(mockTaskCreate).not.toHaveBeenCalled();
    });

    it('returns needs_clarification when the name is ambiguous', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq, hyqOther] });

      const result = await service().createReminderTask({
        content: '开会',
        recipients: ['胡玉琴A'],
        schedule: futureOnce(),
      });

      expect(result.status).toBe('needs_clarification');
      expect(mockTaskCreate).not.toHaveBeenCalled();
    });
  });

  describe('fireForTick', () => {
    const reminderTask = {
      config: {
        reminder: {
          kind: 'reminder',
          once: true,
          reminderId: 'rmd_1',
          schedule: { date: '2026-09-16', kind: 'once', time: '09:00' },
          scheduleSummary: '2026-09-16 09:00 一次',
          until: null,
        },
      },
      id: 'task_1',
      identifier: 'T-9',
      status: 'scheduled',
    };

    const profile = {
      content: '测试一下',
      id: 'rmd_1',
      recipients: [{ displayName: '胡玉琴A', kind: 'user', staffId: 'staff_hyq' }],
      repeatRule: null,
      status: 'scheduled',
      taskId: 'task_1',
    };

    it('delivers a once reminder, stamps heartbeat, and completes the task', async () => {
      mockTaskFindById.mockResolvedValue(reminderTask);
      mockFindByTaskId.mockResolvedValue(profile);
      const now = new Date('2026-09-16T01:00:00.000Z');

      const outcome = await service({
        deliverReminder: mockDeliverReminder,
      }).fireForTick('task_1', now);

      expect(outcome).toBe('fired');
      expect(mockDeliverReminder).toHaveBeenCalledOnce();
      expect(mockUpdateHeartbeat).toHaveBeenCalledWith('task_1');
      expect(mockUpdateStatus).toHaveBeenCalledWith('task_1', 'completed', { completedAt: now });
    });

    it('skips firing and completes when today is after until', async () => {
      mockTaskFindById.mockResolvedValue({
        ...reminderTask,
        config: {
          reminder: {
            ...reminderTask.config.reminder,
            once: false,
            schedule: { kind: 'daily', time: '09:00', until: '2026-09-15' },
            until: '2026-09-15',
          },
        },
      });
      mockFindByTaskId.mockResolvedValue({
        ...profile,
        repeatRule: { freq: 'daily', time: '09:00' },
      });

      const outcome = await service({
        deliverReminder: mockDeliverReminder,
      }).fireForTick('task_1', new Date('2026-09-16T01:00:00.000Z'));

      expect(outcome).toBe('skipped_until');
      expect(mockDeliverReminder).not.toHaveBeenCalled();
      expect(mockUpdateStatus).toHaveBeenCalledWith('task_1', 'completed', {
        completedAt: expect.any(Date),
      });
      expect(mockUpdateProfile).toHaveBeenCalledWith('rmd_1', { status: 'sent' });
    });

    it('keeps a repeating reminder scheduled after a fire with a next occurrence', async () => {
      mockTaskFindById.mockResolvedValue({
        ...reminderTask,
        config: {
          reminder: {
            ...reminderTask.config.reminder,
            once: false,
            schedule: { kind: 'daily', time: '09:00' },
            until: null,
          },
        },
      });
      mockFindByTaskId.mockResolvedValue({
        ...profile,
        repeatRule: { freq: 'daily', time: '09:00' },
      });
      mockDeliverReminder.mockResolvedValue({
        failed: 0,
        firedAt: new Date('2026-09-16T01:00:00.000Z'),
        reminder: {
          id: 'rmd_1',
          repeatRule: { freq: 'daily', time: '09:00' },
          status: 'scheduled',
        },
        sent: 1,
        skipped: 0,
      });

      const outcome = await service({
        deliverReminder: mockDeliverReminder,
      }).fireForTick('task_1', new Date('2026-09-16T01:00:00.000Z'));

      expect(outcome).toBe('fired');
      expect(mockUpdateHeartbeat).toHaveBeenCalledWith('task_1');
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('returns not_reminder when the task is not a reminder task', async () => {
      mockTaskFindById.mockResolvedValue({ config: {}, id: 'task_1' });

      await expect(
        service({ deliverReminder: mockDeliverReminder }).fireForTick('task_1', new Date()),
      ).resolves.toBe('not_reminder');
      expect(mockDeliverReminder).not.toHaveBeenCalled();
    });
  });
});
