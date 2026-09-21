// @vitest-environment node
import type { ReminderScheduleInput } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearch = vi.fn();
const mockGetUsers = vi.fn();
const mockGetDepartment = vi.fn();
const mockSubtreeMemberStaffIds = vi.fn();
const mockListActiveUsersNearName = vi.fn();
const mockListActiveUsersByExactNames = vi.fn();
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
const mockResolveStaffId = vi.fn();
const mockRequestDirectorySyncOnLookupMiss = vi.fn();
const mockTransaction = vi.fn(async (fn: (tx: Record<string, never>) => unknown) => fn({}));

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: vi.fn(() => ({
    getDepartment: mockGetDepartment,
    getUsers: mockGetUsers,
    listActiveUsersByExactNames: mockListActiveUsersByExactNames,
    listActiveUsersNearName: mockListActiveUsersNearName,
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

vi.mock('@/server/services/messenger/platforms/dingtalk/resolveStaffId', () => ({
  resolveDingTalkStaffId: (...args: unknown[]) => mockResolveStaffId(...args),
}));

vi.mock('@/server/enterprise/services/dingtalkDirectory/sync', () => ({
  requestDirectorySyncOnLookupMiss: (...args: unknown[]) =>
    mockRequestDirectorySyncOnLookupMiss(...args),
}));

vi.mock('./worker', () => ({
  deliverReminder: (...args: unknown[]) => mockDeliverReminder(...args),
  ensureReminderWorkerStarted: vi.fn(),
  isReminderWorkerRuntime: vi.fn(),
  reminderSummaryTitle: (title: string | null | undefined, content: string) => {
    const trimmed = title?.trim();
    if (trimmed) return trimmed.slice(0, 12);
    const line = content.trim().split(/\r?\n/, 1)[0] ?? '';
    return line.slice(0, 12);
  },
  reminderTitleFromContent: (content: string) => {
    const line = content.trim().split(/\r?\n/, 1)[0] ?? '';
    return line.slice(0, 12);
  },
  REMINDER_SWEEP_INTERVAL_MS: 60_000,
  runReminderSweep: vi.fn(),
  stopReminderWorker: vi.fn(),
  stopReminderWorkerForTest: vi.fn(),
}));

const {
  REMINDER_CREATE_RETRY,
  REMINDER_INTERNAL,
  REMINDER_SCHEDULE_INVALID,
  REMINDER_TIME_PAST,
  ReminderTaskService,
} = await import('./taskReminder');

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

const flushLookupMissSync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('ReminderTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ fullName: '张三' });
    mockSearch.mockResolvedValue({ departments: [], users: [] });
    mockGetUsers.mockResolvedValue([]);
    mockGetDepartment.mockResolvedValue(undefined);
    mockSubtreeMemberStaffIds.mockResolvedValue([]);
    mockListActiveUsersNearName.mockResolvedValue([]);
    mockListActiveUsersByExactNames.mockResolvedValue([]);
    mockResolveStaffId.mockResolvedValue(null);
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
      await flushLookupMissSync();
      expect(mockRequestDirectorySyncOnLookupMiss).toHaveBeenCalledWith(mockDb);
    });

    it('requests a directory sync when a name·dept lookup is unknown', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });

      await expect(service().resolveRecipients(['胡玉琴A·不存在的部门'])).resolves.toEqual({
        ambiguous: [],
        ok: false,
        unknown: ['胡玉琴A·不存在的部门'],
      });
      await flushLookupMissSync();
      expect(mockRequestDirectorySyncOnLookupMiss).toHaveBeenCalledWith(mockDb);
    });

    it('does not request a directory sync for a unique name hit', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });

      await expect(service().resolveRecipients(['胡玉琴A'])).resolves.toMatchObject({ ok: true });
      await flushLookupMissSync();
      expect(mockRequestDirectorySyncOnLookupMiss).not.toHaveBeenCalled();
    });

    it('attaches unknownSuggestions for a one-character name typo', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [] });
      mockListActiveUsersNearName.mockResolvedValue([
        {
          active: true,
          deptPath: '捷发 / 外贸组',
          leafDeptId: 'dept_trade',
          leafDeptName: '外贸组',
          name: '陈柠',
          staffId: 'staff_173',
        },
      ]);

      await expect(service().resolveRecipients(['陈柑'])).resolves.toEqual({
        ambiguous: [],
        ok: false,
        unknown: ['陈柑'],
        unknownSuggestions: [
          {
            candidates: [
              {
                deptPath: '捷发 / 外贸组',
                leafDeptName: '外贸组',
                name: '陈柠',
                staffId: 'staff_173',
              },
            ],
            query: '陈柑',
          },
        ],
      });
      expect(mockListActiveUsersNearName).toHaveBeenCalledWith('陈柑', { limit: 80 });
    });

    it('resolves 我 / 自己 / me / myself to the caller directory row', async () => {
      mockResolveStaffId.mockResolvedValue('staff_hyq');
      mockGetUsers.mockResolvedValue([hyq]);

      for (const query of ['我', '自己', 'me', 'myself']) {
        const result = await service().resolveRecipients([query]);
        expect(result, query).toMatchObject({
          ok: true,
          recipients: [{ kind: 'user', staffId: 'staff_hyq' }],
        });
      }
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('keeps 我 unknown when the caller has no DingTalk staff mapping', async () => {
      mockResolveStaffId.mockResolvedValue(null);

      await expect(service().resolveRecipients(['我'])).resolves.toEqual({
        ambiguous: [],
        ok: false,
        unknown: ['我'],
      });
      expect(mockListActiveUsersNearName).not.toHaveBeenCalled();
      await flushLookupMissSync();
      expect(mockRequestDirectorySyncOnLookupMiss).not.toHaveBeenCalled();
    });

    it('does not request a directory sync for an unknown staff: token', async () => {
      mockGetUsers.mockResolvedValue([]);

      await expect(service().resolveRecipients(['staff:missing'])).resolves.toMatchObject({
        unknown: ['staff:missing'],
      });
      await flushLookupMissSync();
      expect(mockRequestDirectorySyncOnLookupMiss).not.toHaveBeenCalled();
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

    it('uses the optional title as the task name and truncates content fallback to 12 chars', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });

      await service().createReminderTask({
        content: '这是超过十二字的提醒正文内容',
        recipients: ['胡玉琴A'],
        schedule: futureOnce(),
        title: '每日例会',
      });
      expect(mockTaskCreate.mock.calls[0][0].name).toBe('每日例会');

      mockTaskCreate.mockClear();
      await service().createReminderTask({
        content: '这是超过十二字的提醒正文内容',
        recipients: ['胡玉琴A'],
        schedule: futureOnce(),
      });
      expect(mockTaskCreate.mock.calls[0][0].name).toBe('这是超过十二字的提醒正文');
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

    it('forwards unknownSuggestions when createReminderTask cannot resolve a name', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [] });
      mockListActiveUsersNearName.mockResolvedValue([
        {
          active: true,
          deptPath: '捷发 / 外贸组',
          leafDeptId: 'dept_trade',
          leafDeptName: '外贸组',
          name: '陈柠',
          staffId: 'staff_173',
        },
      ]);

      const result = await service().createReminderTask({
        content: '开会',
        recipients: ['陈柑'],
        schedule: futureOnce(),
      });

      expect(result).toMatchObject({
        status: 'needs_clarification',
        unknown: ['陈柑'],
        unknownSuggestions: [{ candidates: [{ staffId: 'staff_173' }], query: '陈柑' }],
      });
      expect(mockTaskCreate).not.toHaveBeenCalled();
    });

    it('maps unique-violation / seq races to REMINDER_CREATE_RETRY', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });
      mockTransaction.mockRejectedValue(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        }),
      );

      await expect(
        service().createReminderTask({
          content: '开会',
          recipients: ['胡玉琴A'],
          schedule: futureOnce(),
        }),
      ).rejects.toMatchObject({
        code: REMINDER_CREATE_RETRY,
        message: REMINDER_CREATE_RETRY,
        name: 'ReminderServiceError',
      });
    });

    it('maps unexpected DB failures to REMINDER_INTERNAL without SQL text', async () => {
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });
      mockTransaction.mockRejectedValue(
        new Error(
          'Failed query: insert into reminder_recipients ("id","reminder_id","kind","dept_id") values ($1,$2,$3,$4)',
        ),
      );

      const err = await service()
        .createReminderTask({
          content: '开会',
          recipients: ['胡玉琴A'],
          schedule: futureOnce(),
        })
        .catch((error: unknown) => error);

      expect(err).toMatchObject({
        code: REMINDER_INTERNAL,
        message: REMINDER_INTERNAL,
        name: 'ReminderServiceError',
      });
      expect(String((err as Error).message)).not.toMatch(/insert into|Failed query/i);
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

    it('claims the tick slot one fireNow window before the occurrence (no double send after 立即发送)', async () => {
      const dailyTask = {
        ...reminderTask,
        config: {
          reminder: {
            ...reminderTask.config.reminder,
            once: false,
            schedule: { kind: 'daily', time: '09:00' },
            scheduleSummary: '每天 09:00',
          },
        },
        schedulePattern: '0 9 * * *',
      };
      mockTaskFindById.mockResolvedValue(dailyTask);
      mockFindByTaskId.mockResolvedValue({
        ...profile,
        repeatRule: { freq: 'daily', time: '09:00' },
      });
      const tickNow = new Date('2026-09-16T01:00:00.000Z'); // 09:00 Asia/Shanghai

      await service({ deliverReminder: mockDeliverReminder }).fireForTick('task_1', tickNow);

      expect(mockClaimFireSlot).toHaveBeenCalledOnce();
      // occurrence start 09:00 − 60 s = 08:59:00 Asia/Shanghai
      expect(mockClaimFireSlot.mock.calls[0][1].slotStart).toEqual(
        new Date('2026-09-16T00:59:00.000Z'),
      );
    });

    it('does not fire before the occurrence even inside the cron tolerance window', async () => {
      mockTaskFindById.mockResolvedValue(reminderTask);
      mockFindByTaskId.mockResolvedValue(profile);
      // schedule is 2026-09-16 09:00 Asia/Shanghai; the sweep runs at 08:57:20
      const early = new Date('2026-09-16T00:57:20.000Z');

      const outcome = await service({ deliverReminder: mockDeliverReminder }).fireForTick(
        'task_1',
        early,
      );

      expect(outcome).toBe('skipped');
      expect(mockClaimFireSlot).not.toHaveBeenCalled();
      expect(mockDeliverReminder).not.toHaveBeenCalled();
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

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
      expect(mockDeliverReminder).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ title: '测试一下' }),
      );
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

    // 2026-09-18 is Friday. Mon/Wed/Fri 12:30 Asia/Shanghai → cron `30 12 * * 1,3,5`.
    const weeklyMwF = {
      ...reminderTask,
      config: {
        reminder: {
          ...reminderTask.config.reminder,
          once: false,
          schedule: { kind: 'weekly' as const, time: '12:30', weekdays: [1, 3, 5] },
          scheduleSummary: '每周一三五 12:30',
          until: null,
        },
      },
      schedulePattern: '30 12 * * 1,3,5',
    };
    const weeklyMwFProfile = {
      ...profile,
      createdAt: new Date('2026-09-18T07:00:00.000Z'),
      fireAt: new Date('2026-09-21T04:30:00.000Z'),
      repeatRule: { freq: 'weekly' as const, time: '12:30', weekdays: [1, 3, 5] },
    };

    it('does not catch up a Mon/Wed/Fri 12:30 reminder created Friday 15:00 at the Friday 15:01 tick', async () => {
      mockTaskFindById.mockResolvedValue({
        ...weeklyMwF,
        createdAt: new Date('2026-09-18T07:00:00.000Z'),
        lastHeartbeatAt: null,
      });
      mockFindByTaskId.mockResolvedValue(weeklyMwFProfile);

      const outcome = await service({ deliverReminder: mockDeliverReminder }).fireForTick(
        'task_1',
        new Date('2026-09-18T07:01:00.000Z'),
      );

      expect(outcome).toBe('skipped');
      expect(mockClaimFireSlot).not.toHaveBeenCalled();
      expect(mockDeliverReminder).not.toHaveBeenCalled();
      // Stops the dispatcher's null-heartbeat catch-up from re-selecting it every sweep.
      expect(mockUpdateHeartbeat).toHaveBeenCalledWith('task_1');
    });

    it('delivers Monday 12:30 after the Friday skip stamped a heartbeat', async () => {
      mockTaskFindById.mockResolvedValue({
        ...weeklyMwF,
        createdAt: new Date('2026-09-18T07:00:00.000Z'),
        lastHeartbeatAt: new Date('2026-09-18T07:01:00.000Z'),
      });
      mockFindByTaskId.mockResolvedValue(weeklyMwFProfile);

      const outcome = await service({ deliverReminder: mockDeliverReminder }).fireForTick(
        'task_1',
        new Date('2026-09-21T04:30:00.000Z'),
      );

      expect(outcome).toBe('fired');
      expect(mockDeliverReminder).toHaveBeenCalledOnce();
    });

    it('delivers a Mon/Wed/Fri 12:30 reminder created Friday 15:00 at Monday 12:30', async () => {
      mockTaskFindById.mockResolvedValue({
        ...weeklyMwF,
        createdAt: new Date('2026-09-18T07:00:00.000Z'),
        lastHeartbeatAt: null,
      });
      mockFindByTaskId.mockResolvedValue(weeklyMwFProfile);

      const now = new Date('2026-09-21T04:30:00.000Z');
      const outcome = await service({ deliverReminder: mockDeliverReminder }).fireForTick(
        'task_1',
        now,
      );

      expect(outcome).toBe('fired');
      expect(mockClaimFireSlot).toHaveBeenCalledOnce();
      expect(mockDeliverReminder).toHaveBeenCalledOnce();
    });

    it('delivers Friday 12:30 when the Mon/Wed/Fri reminder was created Friday 11:00', async () => {
      mockTaskFindById.mockResolvedValue({
        ...weeklyMwF,
        createdAt: new Date('2026-09-18T03:00:00.000Z'),
        lastHeartbeatAt: null,
      });
      mockFindByTaskId.mockResolvedValue({
        ...weeklyMwFProfile,
        createdAt: new Date('2026-09-18T03:00:00.000Z'),
        fireAt: new Date('2026-09-18T04:30:00.000Z'),
      });

      const outcome = await service({ deliverReminder: mockDeliverReminder }).fireForTick(
        'task_1',
        new Date('2026-09-18T04:30:00.000Z'),
      );

      expect(outcome).toBe('fired');
      expect(mockDeliverReminder).toHaveBeenCalledOnce();
    });

    it('still catch-up fires an already-sent weekly reminder after a later matching weekday slot', async () => {
      mockTaskFindById.mockResolvedValue({
        ...weeklyMwF,
        createdAt: new Date('2026-09-18T07:00:00.000Z'),
        lastHeartbeatAt: new Date('2026-09-21T04:30:00.000Z'),
      });
      mockFindByTaskId.mockResolvedValue({
        ...weeklyMwFProfile,
        fireAt: new Date('2026-09-23T04:30:00.000Z'),
        lastFiredAt: new Date('2026-09-21T04:30:00.000Z'),
      });

      const outcome = await service({ deliverReminder: mockDeliverReminder }).fireForTick(
        'task_1',
        new Date('2026-09-23T07:00:00.000Z'), // Wednesday 15:00 Asia/Shanghai
      );

      expect(outcome).toBe('fired');
      expect(mockDeliverReminder).toHaveBeenCalledOnce();
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

  describe('createReminderTask near-match narrowing', () => {
    const liuGang = {
      active: true,
      deptPath: '捷发 / 外贸组',
      leafDeptId: 'dept_trade',
      leafDeptName: '外贸组',
      name: '刘钢',
      staffId: 'staff_040',
    };
    const qianBaoguo = {
      active: true,
      deptPath: '捷发 / 外贸组',
      leafDeptId: 'dept_trade',
      leafDeptName: '外贸组',
      name: '钱宝国',
      staffId: 'staff_026',
    };
    const chenNing = {
      active: true,
      deptPath: '捷发 / 外贸组',
      leafDeptId: 'dept_trade',
      leafDeptName: '外贸组',
      name: '陈柠',
      staffId: 'staff_173',
    };
    const chenBin = {
      active: true,
      deptPath: '捷发 / 生产部',
      leafDeptId: 'dept_prod',
      leafDeptName: '生产部',
      name: '陈斌',
      staffId: 'staff_bin',
    };
    const chenJun = {
      active: true,
      deptPath: '捷发 / 质量技术中心',
      leafDeptId: 'dept_qc',
      leafDeptName: '质量技术中心',
      name: '陈俊',
      staffId: 'staff_jun',
    };

    const stubDirectory = (near = [chenBin, chenJun, chenNing]) => {
      mockSearch.mockImplementation(async (name: string) => {
        const users = name === '刘钢' ? [liuGang] : name === '钱宝国' ? [qianBaoguo] : [];
        return { departments: [], users };
      });
      mockListActiveUsersNearName.mockResolvedValue(near);
    };

    it('does not user-text-narrow when 陈斌 only occurs inside directory person 陈斌斌', async () => {
      stubDirectory();
      mockListActiveUsersByExactNames.mockResolvedValue([
        {
          active: true,
          deptPath: '捷发 / 生产部',
          leafDeptId: 'dept_prod',
          leafDeptName: '生产部',
          name: '陈斌斌',
          staffId: 'staff_binbin',
        },
      ]);

      const result = await service().createReminderTask({
        content: '考勤',
        contextText: '给陈斌斌发提醒',
        recipients: ['陈染'],
        schedule: futureOnce(),
      });

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') return;
      expect(result.unknownSuggestions?.[0]?.candidates).toHaveLength(3);
      expect(result.unknownSuggestions?.[0]).not.toHaveProperty('reason');
      expect(mockListActiveUsersByExactNames).toHaveBeenCalledWith(
        expect.arrayContaining(['陈斌斌']),
      );
    });

    it('narrows 3→1 when contextText contains 陈柠', async () => {
      stubDirectory();

      const result = await service().createReminderTask({
        content: '考勤',
        contextText: '明天考外贸组 刘钢、钱宝国、陈柠',
        recipients: ['刘钢', '钱宝国', '陈染'],
        schedule: futureOnce(),
      });

      expect(result).toMatchObject({
        status: 'needs_clarification',
        unknown: ['陈染'],
        unknownSuggestions: [
          {
            candidates: [{ name: '陈柠', staffId: 'staff_173' }],
            query: '陈染',
            reason: 'user_text',
          },
        ],
      });
      expect(mockTaskCreate).not.toHaveBeenCalled();
    });

    it('narrows when 陈柠 is glued to a non-name CJK character', async () => {
      stubDirectory();

      const result = await service().createReminderTask({
        content: '考勤',
        contextText: '给陈柠发提醒',
        recipients: ['陈染'],
        schedule: futureOnce(),
      });

      expect(result).toMatchObject({
        status: 'needs_clarification',
        unknown: ['陈染'],
        unknownSuggestions: [
          {
            candidates: [{ name: '陈柠', staffId: 'staff_173' }],
            query: '陈染',
            reason: 'user_text',
          },
        ],
      });
    });

    it('does not narrow when contextText contains two candidate names', async () => {
      stubDirectory();

      const result = await service().createReminderTask({
        content: '考勤',
        contextText: '陈柠 和 陈斌',
        recipients: ['陈染'],
        schedule: futureOnce(),
      });

      expect(result.status).toBe('needs_clarification');
      expect(result).toMatchObject({
        unknown: ['陈染'],
        unknownSuggestions: [{ query: '陈染' }],
      });
      if (result.status !== 'needs_clarification') return;
      expect(result.unknownSuggestions?.[0]?.candidates).toHaveLength(3);
      expect(result.unknownSuggestions?.[0]).not.toHaveProperty('reason');
    });

    it('narrows via co-recipient department affinity', async () => {
      stubDirectory();

      const result = await service().createReminderTask({
        content: '考勤',
        recipients: ['刘钢', '钱宝国', '陈染'],
        schedule: futureOnce(),
      });

      expect(result).toMatchObject({
        status: 'needs_clarification',
        unknown: ['陈染'],
        unknownSuggestions: [
          {
            candidates: [{ leafDeptName: '外贸组', name: '陈柠', staffId: 'staff_173' }],
            query: '陈染',
            reason: 'co_recipient_dept',
          },
        ],
      });
      expect(mockTaskCreate).not.toHaveBeenCalled();
    });

    it('does not narrow when two candidates share a department with co-recipients', async () => {
      stubDirectory([
        chenBin,
        chenJun,
        chenNing,
        {
          active: true,
          deptPath: '捷发 / 外贸组',
          leafDeptId: 'dept_trade',
          leafDeptName: '外贸组',
          name: '陈楠',
          staffId: 'staff_nan',
        },
      ]);

      const result = await service().createReminderTask({
        content: '考勤',
        recipients: ['刘钢', '钱宝国', '陈染'],
        schedule: futureOnce(),
      });

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') return;
      expect(result.unknownSuggestions?.[0]?.candidates.map((row) => row.name)).toEqual(
        expect.arrayContaining(['陈柠', '陈楠']),
      );
      expect(result.unknownSuggestions?.[0]?.candidates.length).toBeGreaterThan(1);
      expect(result.unknownSuggestions?.[0]).not.toHaveProperty('reason');
    });

    it('skips user-text matching when contextText is omitted', async () => {
      stubDirectory();

      const result = await service().createReminderTask({
        content: '考勤',
        recipients: ['陈染'],
        schedule: futureOnce(),
      });

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') return;
      expect(result.unknownSuggestions?.[0]?.candidates).toHaveLength(3);
      expect(result.unknownSuggestions?.[0]).not.toHaveProperty('reason');
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

    it('uses the LLM title when the body changed and the user did not rename the task', async () => {
      mockTaskResolve.mockResolvedValue(scheduledTask);
      mockFindByTaskId.mockResolvedValue(scheduledProfile);
      mockSearch.mockResolvedValue({ departments: [], users: [hyq] });
      mockUpdateProfile.mockResolvedValue(scheduledProfile);

      await service({
        interpretSchedule: async () => null,
        interpretTitle: async () => '提交周报',
      }).saveReminderTask({
        instruction: '@胡玉琴A·外贸组\n\n请提交本周工作周报',
        taskId: 'task_1',
      });

      expect(mockTaskUpdate.mock.calls[0][1].name).toBe('提交周报');
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
