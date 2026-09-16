// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearchDirectory = vi.fn();
const mockCreateReminderTask = vi.fn();
const mockSaveReminderTask = vi.fn();
const mockListCreated = vi.fn();
const mockListReceived = vi.fn();
const mockCancel = vi.fn();
const mockFireNow = vi.fn();
const mockHideReceived = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/server/enterprise/services/reminder', () => {
  class ReminderServiceError extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.name = 'ReminderServiceError';
      this.code = code;
    }
  }
  return {
    REMINDER_NOT_FOUND: 'REMINDER_NOT_FOUND',
    REMINDER_SCHEDULE_INVALID: 'REMINDER_SCHEDULE_INVALID',
    ReminderService: vi.fn(() => ({
      hideReceived: mockHideReceived,
      searchDirectory: mockSearchDirectory,
    })),
    ReminderServiceError,
  };
});

vi.mock('@/server/enterprise/services/reminder/taskReminder', () => ({
  ReminderTaskService: vi.fn(() => ({
    cancel: mockCancel,
    createReminderTask: mockCreateReminderTask,
    fireNow: mockFireNow,
    listCreated: mockListCreated,
    listReceived: mockListReceived,
    saveReminderTask: mockSaveReminderTask,
  })),
}));

const { reminderRouter } = await import('../reminder');

const createCaller = () => reminderRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

describe('reminderRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listCreated forwards optional filters', async () => {
    mockListCreated.mockResolvedValueOnce([]);
    await createCaller().listCreated({ includeFinished: true, limit: 10 });
    expect(mockListCreated).toHaveBeenCalledWith({ includeFinished: true, limit: 10 });
  });

  it('listReceived forwards the limit', async () => {
    mockListReceived.mockResolvedValueOnce([]);
    await createCaller().listReceived({ limit: 5 });
    expect(mockListReceived).toHaveBeenCalledWith({ limit: 5 });
  });

  it('cancel uses taskId and hideReceived uses deliveryId', async () => {
    mockCancel.mockResolvedValueOnce(undefined);
    mockHideReceived.mockResolvedValueOnce(undefined);
    await expect(createCaller().cancel({ taskId: 'task-1' })).resolves.toEqual({
      success: true,
    });
    await expect(createCaller().hideReceived({ deliveryId: 'del_1' })).resolves.toEqual({
      success: true,
    });
    expect(mockCancel).toHaveBeenCalledWith('task-1');
    expect(mockHideReceived).toHaveBeenCalledWith('del_1');
  });

  it('create maps REMINDER_TIME_PAST to BAD_REQUEST', async () => {
    const { ReminderServiceError } = await import('@/server/enterprise/services/reminder');
    mockCreateReminderTask.mockRejectedValueOnce(new ReminderServiceError('REMINDER_TIME_PAST'));
    await expect(
      createCaller().create({
        content: '交报告',
        recipients: ['胡玉琴A'],
        schedule: { date: '2026-09-16', kind: 'once', time: '01:00' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'REMINDER_TIME_PAST' });
  });

  it('rejects invalid schedule time and weekday', async () => {
    await expect(
      createCaller().create({
        content: '交报告',
        recipients: ['胡玉琴A'],
        schedule: { kind: 'daily', time: '24:00' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller().create({
        content: '交报告',
        recipients: ['胡玉琴A'],
        schedule: { kind: 'weekly', time: '09:00', weekdays: [8] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller().create({
        content: '交报告',
        recipients: ['胡玉琴A'],
        schedule: { date: '09-17', kind: 'once', time: '09:00' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects kind-specific missing schedule fields and too many recipients', async () => {
    await expect(
      createCaller().create({
        content: '交报告',
        recipients: ['胡玉琴A'],
        schedule: { kind: 'once', time: '09:00' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller().create({
        content: '交报告',
        recipients: ['胡玉琴A'],
        schedule: { kind: 'weekly', time: '09:00' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller().create({
        content: '交报告',
        recipients: ['胡玉琴A'],
        schedule: { kind: 'monthly', time: '09:00' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller().create({
        content: '交报告',
        recipients: Array.from({ length: 51 }, (_, i) => `user-${i}`),
        schedule: { date: '2026-09-17', kind: 'once', time: '09:00' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects non-object and oversized saveTask.editorData', async () => {
    await expect(
      createCaller().saveTask({
        editorData: 'not-an-object',
        instruction: '@胡玉琴A\n\n开会',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller().saveTask({
        editorData: ['array'],
        instruction: '@胡玉琴A\n\n开会',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller().saveTask({
        editorData: { pad: 'x'.repeat(256 * 1024) },
        instruction: '@胡玉琴A\n\n开会',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    mockSaveReminderTask.mockResolvedValueOnce({ status: 'saved' });
    await expect(
      createCaller().saveTask({
        editorData: { root: { children: [] } },
        instruction: '@胡玉琴A\n\n开会',
        taskId: 'task-1',
      }),
    ).resolves.toEqual({ status: 'saved' });
    expect(mockSaveReminderTask).toHaveBeenCalledWith({
      editorData: { root: { children: [] } },
      instruction: '@胡玉琴A\n\n开会',
      taskId: 'task-1',
    });
  });

  it('searchDirectory forwards q and kind', async () => {
    mockSearchDirectory.mockResolvedValueOnce({ ambiguous: false, departments: [], users: [] });
    await createCaller().searchDirectory({ kind: 'user', q: '胡玉琴' });
    expect(mockSearchDirectory).toHaveBeenCalledWith('胡玉琴', 'user');
  });

  it('saveTask and fireNow forward to ReminderTaskService', async () => {
    mockSaveReminderTask.mockResolvedValueOnce({ status: 'saved' });
    mockFireNow.mockResolvedValueOnce({ failed: 0, firedAt: new Date(), sent: 1, skipped: 0 });
    await createCaller().saveTask({ instruction: '@胡玉琴A·外贸组\n\n开会', taskId: 'task-1' });
    await createCaller().fireNow({ taskId: 'task-1' });
    expect(mockSaveReminderTask).toHaveBeenCalledWith({
      instruction: '@胡玉琴A·外贸组\n\n开会',
      taskId: 'task-1',
    });
    expect(mockFireNow).toHaveBeenCalledWith('task-1');
  });

  it('cancel maps REMINDER_NOT_FOUND to NOT_FOUND', async () => {
    const { ReminderServiceError } = await import('@/server/enterprise/services/reminder');
    mockCancel.mockRejectedValueOnce(new ReminderServiceError('REMINDER_NOT_FOUND'));
    await expect(createCaller().cancel({ taskId: 'missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'REMINDER_NOT_FOUND',
    });
  });
});
