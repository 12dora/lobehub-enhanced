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

vi.mock('@/services/reminder', () => ({
  reminderService: {
    cancel: vi.fn(),
    create: vi.fn(),
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
});
