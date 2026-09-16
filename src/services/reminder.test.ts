import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { reminderService } from './reminder';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    reminder: {
      cancel: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      hideReceived: { mutate: vi.fn() },
      listCreated: { query: vi.fn() },
      listReceived: { query: vi.fn() },
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

  it('cancel and hideReceived mutate ids', async () => {
    await reminderService.cancel('rem_1');
    await reminderService.hideReceived('del_1');
    expect(reminder.cancel.mutate).toHaveBeenCalledWith({ id: 'rem_1' });
    expect(reminder.hideReceived.mutate).toHaveBeenCalledWith({ deliveryId: 'del_1' });
  });

  it('create and searchDirectory forward params', async () => {
    reminder.create.mutate.mockResolvedValueOnce({ id: 'rem_1' });
    reminder.searchDirectory.query.mockResolvedValueOnce({ users: [] });
    await reminderService.create({
      content: '交报告',
      fireAt: '2026-09-17T01:00:00+08:00',
      recipients: [{ kind: 'user', staffId: 's1' }],
    });
    await reminderService.searchDirectory({ q: '安环' });
    expect(reminder.create.mutate).toHaveBeenCalledWith({
      content: '交报告',
      fireAt: '2026-09-17T01:00:00+08:00',
      recipients: [{ kind: 'user', staffId: 's1' }],
    });
    expect(reminder.searchDirectory.query).toHaveBeenCalledWith({ q: '安环' });
  });
});
