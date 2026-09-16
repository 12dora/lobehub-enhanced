/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReminderTaskRow } from './useReminderTaskRow';

const mocks = vi.hoisted(() => ({
  key: undefined as unknown,
  listCreated: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    mocks.key = key;
    if (key) fetcher();
    return {
      data: key ? mocks.rows : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    };
  },
}));

vi.mock('@/services/reminder', () => ({
  reminderService: { listCreated: mocks.listCreated },
}));

const row = (overrides: Record<string, unknown>) => ({
  content: '每日例会',
  firedCount: 0,
  reminderId: 'rmd_1',
  scheduleSummary: '每天 09:00',
  status: 'scheduled',
  taskId: 'task_1',
  taskIdentifier: 'T-7',
  ...overrides,
});

describe('useReminderTaskRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.key = undefined;
    mocks.rows = [row({}), row({ taskId: 'task_2', taskIdentifier: 'T-8' })];
    mocks.listCreated.mockResolvedValue(mocks.rows);
  });

  it('asks for the full set including finished reminders', () => {
    renderHook(() => useReminderTaskRow('T-7'));

    expect(mocks.listCreated).toHaveBeenCalledWith({ includeFinished: true, limit: 200 });
    // Shares the 我发起的 cache key so the table and the panel warm each other.
    expect(mocks.key).toEqual(['reminder:listCreated', true]);
  });

  it('matches the row by task id or by short identifier', () => {
    expect(renderHook(() => useReminderTaskRow('T-8')).result.current.row?.taskId).toBe('task_2');
    expect(renderHook(() => useReminderTaskRow('task_1')).result.current.row?.taskIdentifier).toBe(
      'T-7',
    );
  });

  it('fetches nothing without a task', () => {
    const { result } = renderHook(() => useReminderTaskRow(undefined));

    expect(mocks.key).toBeNull();
    expect(mocks.listCreated).not.toHaveBeenCalled();
    expect(result.current.row).toBeUndefined();
  });
});
