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
const mockListCreatedByTasks = vi.fn();
const mockClaimFireSlot = vi.fn();
const mockInsertDeliveries = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskDelete = vi.fn();
const mockTaskFindById = vi.fn();
const mockTaskFindByIds = vi.fn();
const mockTaskResolve = vi.fn();
const mockTaskUpdate = vi.fn();
const mockUpdateHeartbeat = vi.fn();
const mockUpdateStatus = vi.fn();
const mockFindById = vi.fn();
const mockDeliverReminder = vi.fn();
const mockTransaction = vi.fn(async (fn: (tx: Record<string, never>) => unknown) => fn({}));

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: vi.fn(() => ({
    getDepartment: mockGetDepartment,
    getUsers: mockGetUsers,
    search: mockSearch,
    subtreeMemberStaffIds: mockSubtreeMemberStaffIds,
  })),
}));

vi.mock('@/database/models/reminder', () => {
  const Model = vi.fn(() => ({
    createForTask: mockCreateForTask,
    findByTaskId: mockFindByTaskId,
    listCreatedByTasks: mockListCreatedByTasks,
    updateProfile: mockUpdateProfile,
  }));
  (Model as unknown as { claimFireSlot: (...args: unknown[]) => unknown }).claimFireSlot = (
    ...args: unknown[]
  ) => mockClaimFireSlot(...args);
  (Model as unknown as { insertDeliveries: (...args: unknown[]) => unknown }).insertDeliveries = (
    ...args: unknown[]
  ) => mockInsertDeliveries(...args);
  return { ReminderModel: Model };
});

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({
    create: mockTaskCreate,
    delete: mockTaskDelete,
    findById: mockTaskFindById,
    findByIds: mockTaskFindByIds,
    resolve: mockTaskResolve,
    update: mockTaskUpdate,
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

const { REMINDER_SCHEDULE_INVALID, REMINDER_TIME_PAST, ReminderTaskService } =
  await import('./taskReminder');

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

const mockDb = { transaction: mockTransaction };

const service = (deps?: ConstructorParameters<typeof ReminderTaskService>[3]) =>
  new ReminderTaskService(mockDb as never, 'user_1', undefined, deps);

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
      createdByUserId: 'user_1',
      id: 'task_1',
      identifier: 'T-9',
      name: '测试一下',
      status: 'scheduled',
    });
    mockTaskUpdate.mockResolvedValue({
      config: { reminder: { kind: 'reminder', reminderId: 'rmd_1' } },
      createdByUserId: 'user_1',
      id: 'task_1',
      identifier: 'T-9',
      name: '测试一下',
      status: 'scheduled',
    });
    mockTaskFindByIds.mockResolvedValue([]);
    mockListCreatedByTasks.mockResolvedValue([]);
    mockClaimFireSlot.mockResolvedValue({
      content: '测试一下',
      id: 'rmd_1',
      lastFiredAt: new Date('2026-09-16T09:35:00+08:00'),
      recipients: [],
      repeatRule: null,
      status: 'scheduled',
      taskId: 'task_1',
    });
    mockInsertDeliveries.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, never>) => unknown) =>
      fn({}),
    );
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
          visibility: 'private',
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
        expect.anything(),
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
      createdByUserId: 'user_1',
      id: 'task_1',
      identifier: 'T-9',
      lastHeartbeatAt: null,
      name: '测试一下',
      schedulePattern: '0 9 16 9 *',
      scheduleTimezone: 'Asia/Shanghai',
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
      expect(mockClaimFireSlot).toHaveBeenCalledOnce();
      expect(mockDeliverReminder).toHaveBeenCalledOnce();
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

    it('completes a repeating reminder after its last until occurrence', async () => {
      mockTaskFindById.mockResolvedValue({
        ...reminderTask,
        config: {
          reminder: {
            ...reminderTask.config.reminder,
            once: false,
            schedule: { kind: 'daily', time: '09:00', until: '2026-09-16' },
            until: '2026-09-16',
          },
        },
      });
      mockFindByTaskId.mockResolvedValue({
        ...profile,
        repeatRule: { freq: 'daily', time: '09:00', until: '2026-09-16' },
      });
      mockDeliverReminder.mockResolvedValue({
        failed: 0,
        firedAt: new Date('2026-09-16T01:00:00.000Z'),
        reminder: {
          id: 'rmd_1',
          repeatRule: { freq: 'daily', time: '09:00', until: '2026-09-16' },
          status: 'scheduled',
        },
        sent: 1,
        skipped: 0,
      });

      const now = new Date('2026-09-16T01:00:00.000Z');
      const outcome = await service({
        deliverReminder: mockDeliverReminder,
      }).fireForTick('task_1', now);

      expect(outcome).toBe('fired');
      expect(mockClaimFireSlot.mock.calls[0][1].nextFireAt).toBeNull();
      expect(mockUpdateStatus).toHaveBeenCalledWith('task_1', 'completed', { completedAt: now });
      expect(mockUpdateProfile).toHaveBeenCalledWith('rmd_1', { status: 'sent' });
    });

    it('records failed deliveries when deliver throws after the claim', async () => {
      mockTaskFindById.mockResolvedValue(reminderTask);
      mockFindByTaskId.mockResolvedValue(profile);
      mockDeliverReminder.mockRejectedValue(new Error('dingtalk down'));
      const now = new Date('2026-09-16T01:00:00.000Z');

      const outcome = await service({
        deliverReminder: mockDeliverReminder,
      }).fireForTick('task_1', now);

      expect(outcome).toBe('fired');
      expect(mockClaimFireSlot).toHaveBeenCalledOnce();
      expect(mockInsertDeliveries).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          deliveries: [
            expect.objectContaining({
              failedReason: 'dingtalk down',
              staffId: 'staff_hyq',
              status: 'failed',
            }),
          ],
          reminderId: 'rmd_1',
        }),
      );
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
      expect(mockClaimFireSlot).toHaveBeenCalledOnce();
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('returns not_reminder when the task is not a reminder task', async () => {
      mockTaskFindById.mockResolvedValue({ config: {}, id: 'task_1' });

      await expect(
        service({ deliverReminder: mockDeliverReminder }).fireForTick('task_1', new Date()),
      ).resolves.toBe('not_reminder');
      expect(mockDeliverReminder).not.toHaveBeenCalled();
    });

    it('two concurrent fireForTick calls deliver once', async () => {
      mockTaskFindById.mockResolvedValue(reminderTask);
      mockFindByTaskId.mockResolvedValue(profile);
      const now = new Date('2026-09-16T01:00:00.000Z');

      let claimed = false;
      const waiters: Array<() => void> = [];
      mockClaimFireSlot.mockImplementation(async () => {
        await new Promise<void>((release) => {
          waiters.push(release);
          if (waiters.length >= 2) waiters.forEach((unlock) => unlock());
        });
        if (claimed) return null;
        claimed = true;
        return { ...profile, firedCount: 1, lastFiredAt: now };
      });

      const svc = service({ deliverReminder: mockDeliverReminder });
      const [first, second] = await Promise.all([
        svc.fireForTick('task_1', now),
        svc.fireForTick('task_1', now),
      ]);

      expect(mockDeliverReminder).toHaveBeenCalledOnce();
      expect([first, second].sort()).toEqual(['already_sent', 'fired']);
    });

    it('completes a still-scheduled task after status sent without delivering', async () => {
      mockTaskFindById.mockResolvedValue(reminderTask);
      mockFindByTaskId.mockResolvedValue({ ...profile, status: 'sent' });
      const now = new Date('2026-09-16T01:00:00.000Z');

      const outcome = await service({
        deliverReminder: mockDeliverReminder,
      }).fireForTick('task_1', now);

      expect(outcome).toBe('already_sent');
      expect(mockDeliverReminder).not.toHaveBeenCalled();
      expect(mockClaimFireSlot).not.toHaveBeenCalled();
      expect(mockUpdateStatus).toHaveBeenCalledWith('task_1', 'completed', { completedAt: now });
      expect(mockUpdateHeartbeat).toHaveBeenCalledWith('task_1');
    });

    it('skips a canceled profile without delivering', async () => {
      mockTaskFindById.mockResolvedValue(reminderTask);
      mockFindByTaskId.mockResolvedValue({ ...profile, status: 'canceled' });

      await expect(
        service({ deliverReminder: mockDeliverReminder }).fireForTick('task_1', new Date()),
      ).resolves.toBe('skipped');
      expect(mockDeliverReminder).not.toHaveBeenCalled();
    });
  });

  describe('createReminderTask extra', () => {
    it('returns needs_confirmation for a large department audience', async () => {
      mockSearch.mockResolvedValue({
        departments: [{ ...tradeDept, memberCount: 40 }],
        users: [],
      });

      const result = await service().createReminderTask({
        content: '开会',
        recipients: ['外贸组'],
        schedule: futureOnce(),
      });

      expect(result.status).toBe('needs_confirmation');
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('rejects a weekly schedule without weekdays', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });

      await expect(
        service().createReminderTask({
          content: '开会',
          recipients: ['胡玉琴A'],
          schedule: { kind: 'weekly', time: '09:00' },
        }),
      ).rejects.toMatchObject({ code: REMINDER_SCHEDULE_INVALID });
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe('saveReminderTask', () => {
    const scheduledTask = {
      config: {
        reminder: {
          kind: 'reminder',
          once: false,
          reminderId: 'rmd_1',
          schedule: { kind: 'daily', time: '09:00', until: '2020-01-01' },
          scheduleSummary: '每天 09:00 至 2020-01-01',
          until: '2020-01-01',
        },
      },
      createdByUserId: 'user_1',
      id: 'task_1',
      identifier: 'T-9',
      instruction: '@胡玉琴A·外贸组\n\n每日例会',
      name: '每日例会',
      status: 'scheduled',
    };

    const scheduledProfile = {
      content: '每日例会',
      fireAt: new Date('2026-09-15T01:00:00.000Z'),
      id: 'rmd_1',
      recipients: [
        {
          deptName: '外贸组',
          deptPath: '捷发 / 外贸组',
          displayName: '胡玉琴A',
          kind: 'user',
          staffId: 'staff_hyq',
        },
      ],
      repeatRule: { freq: 'daily', time: '09:00', until: '2020-01-01' },
      status: 'scheduled',
      taskId: 'task_1',
    };

    it('saves a daily reminder whose next fire is past until without REMINDER_TIME_PAST', async () => {
      mockTaskResolve.mockResolvedValue(scheduledTask);
      mockFindByTaskId.mockResolvedValue(scheduledProfile);
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });
      mockUpdateProfile.mockResolvedValue(scheduledProfile);

      const result = await service({
        interpretSchedule: async () => null,
      }).saveReminderTask({
        instruction: '@胡玉琴A·外贸组\n\n每日例会改文案',
        taskId: 'task_1',
      });

      expect(result.status).toBe('saved');
      expect(mockTaskUpdate).toHaveBeenCalled();
      const patch = mockTaskUpdate.mock.calls[0][1];
      expect(patch.name).toBe('每日例会改文案');
      expect(mockUpdateProfile.mock.calls[0][1].fireAt).toBeUndefined();
    });

    it('does not overwrite a user-edited title', async () => {
      mockTaskResolve.mockResolvedValue({ ...scheduledTask, name: '我改过的标题' });
      mockFindByTaskId.mockResolvedValue(scheduledProfile);
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });
      mockUpdateProfile.mockResolvedValue(scheduledProfile);

      await service({ interpretSchedule: async () => null }).saveReminderTask({
        instruction: '@胡玉琴A·外贸组\n\n每日例会改文案',
        taskId: 'task_1',
      });

      expect(mockTaskUpdate.mock.calls[0][1].name).toBeUndefined();
    });
  });

  describe('fireNow / cancel / listCreated', () => {
    const onceTask = {
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
      createdByUserId: 'user_1',
      id: 'task_1',
      identifier: 'T-9',
      name: '测试一下',
      status: 'scheduled',
    };

    it('second fireNow while still scheduled is a no-op when the slot is claimed', async () => {
      mockTaskResolve.mockResolvedValue(onceTask);
      mockFindByTaskId.mockResolvedValue({
        content: '测试一下',
        id: 'rmd_1',
        recipients: [],
        repeatRule: null,
        status: 'scheduled',
        taskId: 'task_1',
      });
      mockClaimFireSlot.mockResolvedValue(null);

      const result = await service({ deliverReminder: mockDeliverReminder }).fireNow('task_1');

      expect(result).toMatchObject({ failed: 0, sent: 0, skipped: 0 });
      expect(mockDeliverReminder).not.toHaveBeenCalled();
    });

    it('second fireNow on a once profile is a no-op', async () => {
      mockTaskResolve.mockResolvedValue(onceTask);
      mockFindByTaskId.mockResolvedValue({
        content: '测试一下',
        id: 'rmd_1',
        lastFiredAt: new Date('2026-09-16T01:00:00.000Z'),
        recipients: [],
        repeatRule: null,
        status: 'sent',
        taskId: 'task_1',
      });

      const result = await service({ deliverReminder: mockDeliverReminder }).fireNow('task_1');

      expect(result).toEqual({
        failed: 0,
        firedAt: new Date('2026-09-16T01:00:00.000Z'),
        sent: 0,
        skipped: 0,
      });
      expect(mockDeliverReminder).not.toHaveBeenCalled();
      expect(mockClaimFireSlot).not.toHaveBeenCalled();
    });

    it('cancels the task and profile for the creator', async () => {
      mockTaskResolve.mockResolvedValue(onceTask);
      mockFindByTaskId.mockResolvedValue({
        id: 'rmd_1',
        status: 'scheduled',
        taskId: 'task_1',
      });

      await service().cancel('task_1');

      expect(mockUpdateStatus).toHaveBeenCalledWith('task_1', 'canceled', {
        completedAt: expect.any(Date),
      });
      expect(mockUpdateProfile).toHaveBeenCalledWith('rmd_1', {
        canceledAt: expect.any(Date),
        status: 'canceled',
      });
    });

    it('maps paused tasks away from scheduled', async () => {
      mockListCreatedByTasks.mockResolvedValue([
        {
          content: '开会',
          deliveryCounts: { failed: 0, sent: 0, skipped: 0 },
          fireAt: new Date('2026-09-16T01:00:00.000Z'),
          firedCount: 0,
          id: 'rmd_1',
          lastFiredAt: null,
          recipients: [],
          repeatRule: null,
          status: 'scheduled',
          taskId: 'task_1',
        },
      ]);
      mockTaskFindByIds.mockResolvedValue([
        {
          ...onceTask,
          status: 'paused',
        },
      ]);

      const rows = await service().listCreated();
      expect(rows[0]?.status).toBe('paused');
      expect(rows[0]?.nextFireAt).toEqual(new Date('2026-09-16T01:00:00.000Z'));
    });
  });

  describe('resolveRecipients extra', () => {
    it('returns ambiguous when two departments share a name', async () => {
      mockSearch.mockResolvedValue({
        departments: [
          tradeDept,
          { deptId: 'dept_trade_2', memberCount: 3, name: '外贸组', pathNames: '集团 / 外贸组' },
        ],
        users: [],
      });

      const result = await service().resolveRecipients(['外贸组']);
      expect(result).toMatchObject({
        ok: false,
        ambiguous: [
          {
            query: '外贸组',
            candidates: [{ deptId: 'dept_trade' }, { deptId: 'dept_trade_2' }],
          },
        ],
      });
    });

    it('skips empty recipient queries', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });

      const result = await service().resolveRecipients(['  ', '胡玉琴A', '']);

      expect(result).toMatchObject({ ok: true, recipients: [{ staffId: 'staff_hyq' }] });
      expect(mockSearch).toHaveBeenCalledTimes(1);
    });

    it('caps recipient queries at 50', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [] });
      const queries = Array.from({ length: 51 }, (_, index) => `nobody-${index}`);

      await service().resolveRecipients(queries);

      expect(mockSearch).toHaveBeenCalledTimes(50);
    });
  });
});
