// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AdminSystemJob,
  AdminSystemJobsPage,
  AdminSystemService,
} from '@/enterprise/client/services/adminSystem';

import {
  resetAdminSystemJobsStatusPollForTest,
  useAdminSystemJobMutations,
  useAdminSystemJobs,
  useAdminSystemStatus,
} from './useAdminSystem';

interface SWRConfig {
  keepPreviousData?: boolean;
  onError?: (error: unknown) => void;
  onSuccess?: (incoming: unknown) => void;
  refreshInterval?: number;
}

type SWRKey = readonly unknown[] | null;

interface SWRCall {
  config: SWRConfig;
  fetcher: () => Promise<unknown>;
  key: SWRKey;
}

const mocks = vi.hoisted(() => ({
  calls: [] as SWRCall[],
  globalMutate: vi.fn(async (_matcher: unknown) => [] as unknown[]),
  jobs: {
    data: undefined as unknown,
    error: undefined as Error | undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  },
}));

vi.mock('swr/infinite', () => ({
  // Instances still page by cursor; these tests do not exercise that hook.
  default: () => ({ data: [], isValidating: false, mutate: vi.fn(), setSize: vi.fn(), size: 1 }),
}));

vi.mock('@/libs/swr', () => ({
  mutate: mocks.globalMutate,
  useClientDataSWR: (key: SWRKey, fetcher: () => Promise<unknown>, config: SWRConfig) => {
    mocks.calls.push({ config, fetcher, key });
    if (key?.[0] === 'admin.system.jobs.list') return mocks.jobs;
    return { error: undefined };
  },
}));

vi.mock('@/enterprise/client/features/admin/reauth/requestAdminReauth', () => ({
  withAdminReauthRetry: (operation: () => Promise<unknown>) => operation(),
}));

const latest = (name: string) => [...mocks.calls].reverse().find((call) => call.key?.[0] === name);

const job = (overrides: Partial<AdminSystemJob> = {}): AdminSystemJob => ({
  attempt: 1,
  canCancel: true,
  canRetry: false,
  createdAt: new Date('2026-07-20T00:00:00.000Z'),
  errorCategory: null,
  failedCount: 0,
  finishedAt: null,
  jobId: 'pjob_0000000000000001',
  kind: 'agent_rollout',
  maxAttempts: 3,
  progress: { done: 0, total: 1 },
  revision: 1,
  startedAt: new Date('2026-07-20T00:00:01.000Z'),
  status: 'running',
  typeId: 'platform.agent.rollout.v1',
  updatedAt: new Date('2026-07-20T00:00:02.000Z'),
  ...overrides,
});

const page = (
  items: AdminSystemJob[],
  overrides: Partial<AdminSystemJobsPage> = {},
): AdminSystemJobsPage =>
  ({
    clearedAt: null,
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
    ...overrides,
  }) as AdminSystemJobsPage;

const service = (overrides: Partial<AdminSystemService> = {}): AdminSystemService => ({
  cancelJob: vi.fn(),
  clearJobs: vi.fn(),
  getInstanceRevisions: vi.fn(),
  getStatus: vi.fn(),
  listJobs: vi.fn(),
  retryJob: vi.fn(),
  ...overrides,
});

describe('useAdminSystemJobs server pages', () => {
  beforeEach(() => {
    resetAdminSystemJobsStatusPollForTest();
    mocks.calls.length = 0;
    mocks.jobs.data = page([job({ status: 'succeeded' })], { total: 45 });
    mocks.jobs.error = undefined;
    mocks.jobs.isLoading = false;
    mocks.jobs.isValidating = false;
    mocks.jobs.mutate.mockReset().mockImplementation(async () => mocks.jobs.data);
  });

  it('loads page 1 with the default page size of 20 and exposes the exact total', async () => {
    const listJobs = vi.fn().mockResolvedValue(mocks.jobs.data);
    const { result } = renderHook(() =>
      useAdminSystemJobs(true, service({ listJobs }), {
        authoritativeActiveCount: 0,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );

    const call = latest('admin.system.jobs.list')!;
    expect(call.key).toEqual(['admin.system.jobs.list', 1, 20, 0]);
    expect(call.config.keepPreviousData).toBe(true);
    await call.fetcher();
    expect(listJobs).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(result.current).toMatchObject({ page: 1, pageSize: 20, total: 45 });
    expect(result.current.jobs).toHaveLength(1);
  });

  it('requests a new server page when the table paginates', async () => {
    const listJobs = vi.fn().mockResolvedValue(mocks.jobs.data);
    const { result } = renderHook(() =>
      useAdminSystemJobs(true, service({ listJobs }), {
        authoritativeActiveCount: 0,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );

    act(() => result.current.setPagination(3, 50));
    const call = latest('admin.system.jobs.list')!;
    expect(call.key).toEqual(['admin.system.jobs.list', 3, 50, 0]);
    await call.fetcher();
    expect(listJobs).toHaveBeenLastCalledWith({ page: 3, pageSize: 50 });
  });

  it('polls the current page every 3s while the aggregate reports active jobs', async () => {
    const refreshAuthority = vi.fn().mockResolvedValue(undefined);
    const { rerender, result } = renderHook(
      ({ activeCount }) =>
        useAdminSystemJobs(true, service(), {
          authoritativeActiveCount: activeCount,
          refreshAuthority,
        }),
      { initialProps: { activeCount: 2 } },
    );

    act(() => result.current.setPagination(2, 20));
    const polling = latest('admin.system.jobs.list')!;
    // The page the operator is looking at is the one that refreshes — no staged first page.
    expect(polling.key).toEqual(['admin.system.jobs.list', 2, 20, 0]);
    expect(polling.config.refreshInterval).toBe(3000);

    await act(async () => {
      polling.config.onSuccess?.(page([job({ status: 'succeeded' })]));
      await Promise.resolve();
    });
    // Each tick re-reads the aggregate: it is the only authority that can stop the loop.
    expect(refreshAuthority).toHaveBeenCalledTimes(1);

    rerender({ activeCount: 0 });
    const stopped = latest('admin.system.jobs.list')!;
    expect(stopped.key).toEqual(['admin.system.jobs.list', 2, 20, 0]);
    expect(stopped.config.refreshInterval).toBe(0);

    await act(async () => {
      stopped.config.onSuccess?.(page([]));
      await Promise.resolve();
    });
    expect(refreshAuthority).toHaveBeenCalledTimes(1);
  });

  it('does not poll when the aggregate is unavailable, even with active rows visible', () => {
    mocks.jobs.data = page([job({ status: 'running' })]);
    renderHook(() =>
      useAdminSystemJobs(true, service(), {
        authoritativeActiveCount: null,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );

    expect(latest('admin.system.jobs.list')?.config.refreshInterval).toBe(0);
  });

  it('stops the active-job poll while the tab is hidden', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      renderHook(() =>
        useAdminSystemJobs(true, service(), {
          authoritativeActiveCount: 2,
          refreshAuthority: vi.fn().mockResolvedValue(undefined),
        }),
      );

      // The key stays live (the list still renders); only the 3s cadence goes quiet.
      expect(latest('admin.system.jobs.list')?.key).toEqual(['admin.system.jobs.list', 1, 20, 0]);
      expect(latest('admin.system.jobs.list')?.config.refreshInterval).toBe(0);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }
  });

  it('returns a null key without read permission', () => {
    renderHook(() =>
      useAdminSystemJobs(false, service(), {
        authoritativeActiveCount: 1,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );

    expect(mocks.calls.at(-1)?.key).toBeNull();
    expect(mocks.calls.at(-1)?.config.refreshInterval).toBe(0);
  });

  it('separates an initial load failure from a background refresh failure', () => {
    mocks.jobs.data = undefined;
    mocks.jobs.error = new Error('offline');
    const { rerender, result } = renderHook(() =>
      useAdminSystemJobs(true, service(), {
        authoritativeActiveCount: 0,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );
    expect(result.current.initialError).toBeInstanceOf(Error);
    expect(result.current.backgroundError).toBeUndefined();

    mocks.jobs.data = page([job({ status: 'succeeded' })]);
    rerender();
    expect(result.current.initialError).toBeUndefined();
    expect(result.current.backgroundError).toBeInstanceOf(Error);
  });

  it('goes back to page 1 on a fresh key and refreshes the aggregate after 清除', async () => {
    const refreshAuthority = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAdminSystemJobs(true, service(), {
        authoritativeActiveCount: 0,
        refreshAuthority,
      }),
    );

    act(() => result.current.setPagination(3, 20));
    await act(async () => {
      await result.current.goToFirstPage();
    });
    expect(result.current.page).toBe(1);
    // Every page cached before the watermark moved is retired, page 1 included.
    expect(latest('admin.system.jobs.list')?.key).toEqual(['admin.system.jobs.list', 1, 20, 1]);
    expect(refreshAuthority).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.goToFirstPage();
    });
    expect(latest('admin.system.jobs.list')?.key).toEqual(['admin.system.jobs.list', 1, 20, 2]);
  });

  it('shows the table as loading while rows of another page stand in', () => {
    mocks.jobs.isLoading = true;
    const { result } = renderHook(() =>
      useAdminSystemJobs(true, service(), {
        authoritativeActiveCount: 0,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );

    // `keepPreviousData` still hands back the old rows; they must not pass for the new page.
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.isLoadingPage).toBe(true);
    expect(result.current.isLoadingInitial).toBe(false);

    mocks.jobs.isLoading = false;
    const { result: settled } = renderHook(() =>
      useAdminSystemJobs(true, service(), {
        authoritativeActiveCount: 0,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );
    expect(settled.current.isLoadingPage).toBe(false);
  });

  it('keeps the status cards refreshing while the jobs list fails', async () => {
    const refreshAuthority = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(() => {
      useAdminSystemStatus(true, service());
      useAdminSystemJobs(true, service(), {
        authoritativeActiveCount: 2,
        refreshAuthority,
      });
    });

    // Healthy: the 3s jobs poll owns the status refresh.
    expect(latest('admin.system.getStatus')?.config.refreshInterval).toBe(0);

    await act(async () => {
      latest('admin.system.jobs.list')!.config.onError?.(new Error('db down'));
      await Promise.resolve();
    });
    // A failing tick still moves the aggregate…
    expect(refreshAuthority).toHaveBeenCalledTimes(1);

    // …and once the list is in error, the 30s status poll takes over again.
    mocks.jobs.error = new Error('db down');
    rerender();
    expect(latest('admin.system.getStatus')?.config.refreshInterval).toBe(30_000);
  });

  it('snaps back to the last non-empty page when the current page empties', () => {
    const { rerender, result } = renderHook(() =>
      useAdminSystemJobs(true, service(), {
        authoritativeActiveCount: 0,
        refreshAuthority: vi.fn().mockResolvedValue(undefined),
      }),
    );

    act(() => result.current.setPagination(4, 20));
    mocks.jobs.data = page([], { page: 4, total: 30 });
    rerender();
    expect(result.current.page).toBe(2);
  });
});

describe('useAdminSystemStatus polling', () => {
  beforeEach(() => {
    resetAdminSystemJobsStatusPollForTest();
    mocks.calls.length = 0;
  });

  it('polls status on a visibility-gated interval', () => {
    renderHook(() => useAdminSystemStatus(true, service()));
    expect(mocks.calls.at(-1)?.key).toEqual(['admin.system.getStatus']);
    expect(mocks.calls.at(-1)?.config.refreshInterval).toBe(30_000);
  });

  it('stops the status poll while the tab is hidden', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      renderHook(() => useAdminSystemStatus(true, service()));
      expect(mocks.calls.at(-1)?.key).toEqual(['admin.system.getStatus']);
      expect(mocks.calls.at(-1)?.config.refreshInterval).toBe(0);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }
  });

  it('does not poll status without read permission', () => {
    renderHook(() => useAdminSystemStatus(false, service()));
    expect(mocks.calls.at(-1)?.key).toBeNull();
    expect(mocks.calls.at(-1)?.config.refreshInterval).toBe(0);
  });

  it('suppresses the 30s status cadence while the jobs poll owns refresh', () => {
    mocks.jobs.data = page([job({ status: 'succeeded' })]);
    const { rerender } = renderHook(
      ({ activeCount }) => {
        useAdminSystemStatus(true, service());
        useAdminSystemJobs(true, service(), {
          authoritativeActiveCount: activeCount,
          refreshAuthority: vi.fn().mockResolvedValue(undefined),
        });
      },
      { initialProps: { activeCount: 2 } },
    );

    expect(latest('admin.system.jobs.list')?.config.refreshInterval).toBe(3000);
    expect(latest('admin.system.getStatus')?.config.refreshInterval).toBe(0);

    const beforeStop = mocks.calls.length;
    rerender({ activeCount: 0 });
    const afterStop = mocks.calls.slice(beforeStop);
    expect(afterStop).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          config: expect.objectContaining({ refreshInterval: 0 }),
          key: ['admin.system.jobs.list', 1, 20, 0],
        }),
        expect.objectContaining({
          config: expect.objectContaining({ refreshInterval: 30_000 }),
          key: ['admin.system.getStatus'],
        }),
      ]),
    );
  });
});

describe('useAdminSystemJobMutations refresh lock', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('succeeds on an authoritative mutation response even if the page omits the job', async () => {
    const original = job();
    const committed = job({
      canCancel: false,
      finishedAt: new Date('2026-07-20T00:00:03.000Z'),
      revision: 2,
      status: 'cancelled',
    });
    // Pagination shift: the cancelled job is no longer on the current page.
    const onRefresh = vi
      .fn<() => Promise<AdminSystemJobsPage | undefined>>()
      .mockResolvedValue(page([job({ jobId: 'pjob_0000000000000099' })]));
    const client = service({ cancelJob: vi.fn().mockResolvedValue(committed) });
    const { result } = renderHook(() =>
      useAdminSystemJobMutations({ authMethod: null, onRefresh, service: client }),
    );

    await act(async () => {
      expect(await result.current.cancel(original)).toBe('succeeded');
    });
    expect(result.current.refreshPendingJobIds).toEqual([]);
  });

  it('locks a committed row when the current page still shows a stale CAS snapshot', async () => {
    const original = job();
    const committed = job({
      canCancel: false,
      finishedAt: new Date('2026-07-20T00:00:03.000Z'),
      revision: 2,
      status: 'cancelled',
    });
    const onRefresh = vi
      .fn<() => Promise<AdminSystemJobsPage | undefined>>()
      .mockResolvedValueOnce(page([original]))
      .mockResolvedValueOnce(page([committed]));
    const client = service({ cancelJob: vi.fn().mockResolvedValue(committed) });
    const { result } = renderHook(() =>
      useAdminSystemJobMutations({ authMethod: null, onRefresh, service: client }),
    );

    await act(async () => {
      expect(await result.current.cancel(original)).toBe('refresh_failed');
    });
    expect(result.current.refreshPendingJobIds).toEqual([original.jobId]);

    await act(async () => {
      expect(await result.current.retryRefresh()).toBe(true);
    });
    expect(result.current.refreshPendingJobIds).toEqual([]);
  });

  it('rejects a duplicate row action while the first request is pending', async () => {
    const original = job();
    const committed = job({ revision: 2, status: 'cancelled' });
    let resolveCancel: (value: AdminSystemJob) => void = () => undefined;
    const pendingCancel = new Promise<AdminSystemJob>((resolve) => {
      resolveCancel = resolve;
    });
    const cancelJob = vi.fn().mockReturnValue(pendingCancel);
    const client = service({ cancelJob });
    const { result } = renderHook(() =>
      useAdminSystemJobMutations({
        authMethod: null,
        onRefresh: vi.fn().mockResolvedValue(page([committed])),
        service: client,
      }),
    );

    let firstRequest: Promise<string> | undefined;
    act(() => {
      firstRequest = result.current.cancel(original);
    });
    await expect(result.current.cancel(original)).resolves.toBe('failed');
    expect(cancelJob).toHaveBeenCalledTimes(1);

    resolveCancel(committed);
    await act(async () => {
      await firstRequest;
    });
    expect(result.current.busyJobIds).toEqual([]);
  });
});

describe('useAdminSystemJobMutations clear', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('clears finished jobs, then hands control back to reload page 1', async () => {
    const clearJobs = vi
      .fn()
      .mockResolvedValue({ clearedAt: '2026-09-25T00:00:00.000Z', hidden: 7 });
    const onCleared = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAdminSystemJobMutations({
        authMethod: null,
        onCleared,
        onRefresh: vi.fn().mockResolvedValue(page([])),
        service: service({ clearJobs }),
      }),
    );

    mocks.globalMutate.mockClear();
    await act(async () => {
      expect(await result.current.clear()).toEqual({ hidden: 7, ok: true });
    });
    expect(clearJobs).toHaveBeenCalledTimes(1);
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(result.current.clearing).toBe(false);
    // 清除 writes the shared settings row: an open 告警设置 drawer re-reads its revision.
    expect(mocks.globalMutate).toHaveBeenCalledTimes(1);
    const matcher = mocks.globalMutate.mock.calls[0]?.[0] as (key: unknown) => boolean;
    expect(matcher(['admin.system.alerts.get'])).toBe(true);
    expect(matcher(['admin.system.jobs.list', 1, 20, 0])).toBe(false);
  });

  it('reports a failed clear without reloading', async () => {
    const failure = new Error('forbidden');
    const onCleared = vi.fn();
    const { result } = renderHook(() =>
      useAdminSystemJobMutations({
        authMethod: null,
        onCleared,
        onRefresh: vi.fn().mockResolvedValue(page([])),
        service: service({ clearJobs: vi.fn().mockRejectedValue(failure) }),
      }),
    );

    await act(async () => {
      expect(await result.current.clear()).toEqual({ error: failure, ok: false });
    });
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('ignores a second clear while the first is still running', async () => {
    let resolveClear: (value: { clearedAt: string; hidden: number }) => void = () => undefined;
    const clearJobs = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveClear = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useAdminSystemJobMutations({
        authMethod: null,
        onRefresh: vi.fn().mockResolvedValue(page([])),
        service: service({ clearJobs }),
      }),
    );

    let first: Promise<unknown> | undefined;
    act(() => {
      first = result.current.clear();
    });
    await expect(result.current.clear()).resolves.toMatchObject({ ok: false });
    expect(clearJobs).toHaveBeenCalledTimes(1);

    resolveClear({ clearedAt: '2026-09-25T00:00:00.000Z', hidden: 0 });
    await act(async () => {
      await first;
    });
  });
});
