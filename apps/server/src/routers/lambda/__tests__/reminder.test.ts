// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearchDirectory = vi.fn();
const mockCreate = vi.fn();
const mockListCreated = vi.fn();
const mockListReceived = vi.fn();
const mockCancel = vi.fn();
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
    ReminderService: vi.fn(() => ({
      cancel: mockCancel,
      create: mockCreate,
      hideReceived: mockHideReceived,
      listCreated: mockListCreated,
      listReceived: mockListReceived,
      searchDirectory: mockSearchDirectory,
    })),
    ReminderServiceError,
  };
});

const { reminderRouter } = await import('../reminder');

const createCaller = () => reminderRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

describe('reminderRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listCreated forwards optional filters', async () => {
    mockListCreated.mockResolvedValueOnce([]);
    await createCaller().listCreated({ limit: 10, status: 'scheduled' });
    expect(mockListCreated).toHaveBeenCalledWith({ limit: 10, status: 'scheduled' });
  });

  it('listReceived forwards the limit', async () => {
    mockListReceived.mockResolvedValueOnce([]);
    await createCaller().listReceived({ limit: 5 });
    expect(mockListReceived).toHaveBeenCalledWith({ limit: 5 });
  });

  it('cancel and hideReceived mutate by id', async () => {
    mockCancel.mockResolvedValueOnce({ id: 'rem_1', status: 'canceled' });
    mockHideReceived.mockResolvedValueOnce(undefined);
    await expect(createCaller().cancel({ id: 'rem_1' })).resolves.toEqual({
      id: 'rem_1',
      status: 'canceled',
    });
    await expect(createCaller().hideReceived({ deliveryId: 'del_1' })).resolves.toEqual({
      success: true,
    });
    expect(mockCancel).toHaveBeenCalledWith('rem_1');
    expect(mockHideReceived).toHaveBeenCalledWith('del_1');
  });

  it('create maps REMINDER_TIME_PAST to BAD_REQUEST', async () => {
    const { ReminderServiceError } = await import('@/server/enterprise/services/reminder');
    mockCreate.mockRejectedValueOnce(new ReminderServiceError('REMINDER_TIME_PAST'));
    await expect(
      createCaller().create({
        content: '交报告',
        fireAt: '2026-09-16T01:00:00+08:00',
        recipients: [{ kind: 'user', staffId: 's1' }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'REMINDER_TIME_PAST' });
  });

  it('searchDirectory forwards q and kind', async () => {
    mockSearchDirectory.mockResolvedValueOnce({ ambiguous: false, departments: [], users: [] });
    await createCaller().searchDirectory({ kind: 'user', q: '胡玉琴' });
    expect(mockSearchDirectory).toHaveBeenCalledWith('胡玉琴', 'user');
  });
});
