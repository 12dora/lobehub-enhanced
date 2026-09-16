/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchDirectory = vi.fn().mockResolvedValue({
  ambiguous: false,
  departments: [],
  serverNow: '2026-09-16T12:00:00+08:00',
  users: [],
});
const create = vi.fn();
const cancel = vi.fn();

vi.mock('@/services/reminder', () => ({
  reminderService: {
    cancel,
    create,
    listCreated: vi.fn().mockResolvedValue([]),
    listReceived: vi.fn().mockResolvedValue([]),
    searchDirectory,
  },
}));

const { reminderExecutor } = await import('./index');

describe('reminderExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchDirectory.mockResolvedValue({
      ambiguous: false,
      departments: [],
      serverNow: '2026-09-16T12:00:00+08:00',
      users: [],
    });
  });

  it('passes { q, kind } to reminderService.searchDirectory', async () => {
    await reminderExecutor.searchDirectory({ kind: 'user', q: '安环' });
    expect(searchDirectory).toHaveBeenCalledWith({ kind: 'user', q: '安环' });
  });

  it('forwards createReminder names and schedule', async () => {
    create.mockResolvedValueOnce({
      reminder: {
        content: '测试',
        fireAt: '2026-09-17T09:00:00+08:00',
        id: 'rem-1',
        recipients: [],
      },
      status: 'created',
      task: { id: 'task-1', identifier: 'TASK-1' },
    });
    await reminderExecutor.createReminder({
      content: '测试',
      recipients: ['胡玉琴A'],
      schedule: { date: '2026-09-17', kind: 'once', time: '09:00' },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '测试',
        recipients: ['胡玉琴A'],
        schedule: { date: '2026-09-17', kind: 'once', time: '09:00' },
      }),
    );
  });

  it('cancels by taskId', async () => {
    cancel.mockResolvedValueOnce(undefined);
    await reminderExecutor.cancelReminder({ taskId: 'task-1' });
    expect(cancel).toHaveBeenCalledWith('task-1');
  });
});
