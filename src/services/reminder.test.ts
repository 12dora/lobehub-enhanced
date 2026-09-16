import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { reminderService } from './reminder';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    reminder: {
      cancel: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      fireNow: { mutate: vi.fn() },
      hideReceived: { mutate: vi.fn() },
      listCreated: { query: vi.fn() },
      listReceived: { query: vi.fn() },
      saveTask: { mutate: vi.fn() },
      searchDirectory: { query: vi.fn() },
    },
  },
}));

const reminder = (lambdaClient as any).reminder;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reminderService', () => {
  it('listCreated defaults to an empty query object', async () => {
    reminder.listCreated.query.mockResolvedValueOnce([]);
    await reminderService.listCreated();
    expect(reminder.listCreated.query).toHaveBeenCalledWith({});
  });

  it('listReceived forwards limit', async () => {
    reminder.listReceived.query.mockResolvedValueOnce([]);
    await reminderService.listReceived({ limit: 8 });
    expect(reminder.listReceived.query).toHaveBeenCalledWith({ limit: 8 });
  });

  it('cancel, fireNow, and hideReceived mutate ids', async () => {
    await reminderService.cancel('task-1');
    await reminderService.fireNow('task-1');
    await reminderService.hideReceived('del_1');
    expect(reminder.cancel.mutate).toHaveBeenCalledWith({ taskId: 'task-1' });
    expect(reminder.fireNow.mutate).toHaveBeenCalledWith({ taskId: 'task-1' });
    expect(reminder.hideReceived.mutate).toHaveBeenCalledWith({ deliveryId: 'del_1' });
  });

  it('create, saveTask, and searchDirectory forward params', async () => {
    reminder.create.mutate.mockResolvedValueOnce({ status: 'created' });
    reminder.saveTask.mutate.mockResolvedValueOnce({ status: 'saved' });
    reminder.searchDirectory.query.mockResolvedValueOnce({ users: [] });
    await reminderService.create({
      content: '交报告',
      recipients: ['胡玉琴A'],
      schedule: { date: '2026-09-17', kind: 'once', time: '09:00' },
    });
    await reminderService.saveTask({ instruction: '@胡玉琴A\n\n交报告', taskId: 'task-1' });
    await reminderService.searchDirectory({ q: '安环' });
    expect(reminder.create.mutate).toHaveBeenCalledWith({
      content: '交报告',
      recipients: ['胡玉琴A'],
      schedule: { date: '2026-09-17', kind: 'once', time: '09:00' },
    });
    expect(reminder.saveTask.mutate).toHaveBeenCalledWith({
      instruction: '@胡玉琴A\n\n交报告',
      taskId: 'task-1',
    });
    expect(reminder.searchDirectory.query).toHaveBeenCalledWith({ q: '安环' });
  });
});
