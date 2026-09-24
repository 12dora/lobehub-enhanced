'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import useSWRInfinite from 'swr/infinite';

import { DEFAULT_PAGE_SIZE as DEFAULT_TABLE_PAGE_SIZE } from '@/enterprise/client/features/admin/primitives/dataTableChange';
import type { AdminReauthAuthMethod } from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import { withAdminReauthRetry } from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import type {
  AdminSystemJobAction,
  SsoAuthSnapshot,
} from '@/enterprise/client/features/admin/system/controller';
import {
  canRunAdminSystemJobAction,
  classifyAdminSystemJobsError,
  didAdminSystemJobRefreshConfirm,
  isAdminSystemConflictError,
  isAdminSystemInvalidInputError,
  isAdminSystemJobMutationAuthoritative,
  shouldPollAdminSystemJobs,
} from '@/enterprise/client/features/admin/system/controller';
import type {
  AdminSystemGetInstanceRevisionsInput,
  AdminSystemInstanceRevisions,
  AdminSystemJob,
  AdminSystemJobsPage,
  AdminSystemService,
} from '@/enterprise/client/services/adminSystem';
import { ADMIN_POLL_INTERVALS } from '@/enterprise/client/shared/pollIntervals';
import { useVisiblePoll } from '@/enterprise/client/shared/useVisiblePoll';
import { useClientDataSWR } from '@/libs/swr';

import { invalidateAdminSystemAlerts } from '../invalidate';
import {
  buildAdminSystemAuthSnapshotKey,
  buildAdminSystemInstancesKey,
  buildAdminSystemJobsKey,
  buildAdminSystemStatusKey,
} from '../swrKeys';

const DEFAULT_PAGE_SIZE = 50;
const ACTIVE_JOB_POLL_INTERVAL_MS = ADMIN_POLL_INTERVALS.jobs;
const SYSTEM_STATUS_POLL_INTERVAL_MS = ADMIN_POLL_INTERVALS.systemStatus;

/**
 * The jobs poll mutates the same status query every 3s. Status's own 30s timer
 * must yield for that loop so the two schedules do not race.
 */
let jobsStatusPollActive = false;
const jobsStatusPollListeners = new Set<() => void>();

const setJobsStatusPollActive = (next: boolean) => {
  if (jobsStatusPollActive === next) return;
  jobsStatusPollActive = next;
  for (const listener of jobsStatusPollListeners) listener();
};

const subscribeJobsStatusPollActive = (onStoreChange: () => void) => {
  jobsStatusPollListeners.add(onStoreChange);
  return () => {
    jobsStatusPollListeners.delete(onStoreChange);
  };
};

const getJobsStatusPollActive = () => jobsStatusPollActive;
const getJobsStatusPollActiveServerSnapshot = () => false;

const useJobsStatusPollActive = (): boolean =>
  useSyncExternalStore(
    subscribeJobsStatusPollActive,
    getJobsStatusPollActive,
    getJobsStatusPollActiveServerSnapshot,
  );

export const resetAdminSystemJobsStatusPollForTest = () => {
  jobsStatusPollActive = false;
};

export const useAdminSystemStatus = (enabled: boolean, service: AdminSystemService) => {
  const jobsPollOwnsRefresh = useJobsStatusPollActive();
  const refreshInterval = useVisiblePoll(
    SYSTEM_STATUS_POLL_INTERVAL_MS,
    enabled && !jobsPollOwnsRefresh,
  );
  return useClientDataSWR(buildAdminSystemStatusKey(enabled), () => service.getStatus(), {
    keepPreviousData: true,
    refreshInterval,
    revalidateOnFocus: false,
  });
};

export const useAdminSystemAuthSnapshotStatus = (
  enabled: boolean,
  fetchStatus: () => Promise<SsoAuthSnapshot>,
) =>
  useClientDataSWR(buildAdminSystemAuthSnapshotKey(enabled), fetchStatus, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

export interface AdminSystemInstancesState {
  backgroundError: unknown;
  data?: AdminSystemInstanceRevisions;
  hasMore: boolean;
  initialError: unknown;
  isLoadingInitial: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  loadMoreError: boolean;
  refresh: () => Promise<AdminSystemInstanceRevisions[] | undefined>;
  retryLoadMore: () => void;
}

export const useAdminSystemInstances = (
  enabled: boolean,
  service: AdminSystemService,
  input: AdminSystemGetInstanceRevisionsInput = { limit: DEFAULT_PAGE_SIZE },
): AdminSystemInstancesState => {
  // The registry keeps one row per past process start, so the default view is live-only.
  // `state` is part of the key (and of the server cursor) — switching filters restarts paging.
  const state = input?.state ?? 'live';
  const swr = useSWRInfinite<AdminSystemInstanceRevisions>(
    (index, previous: AdminSystemInstanceRevisions | null) => {
      if (!enabled) return null;
      if (previous && previous.nextCursor === null) return null;
      const cursor = index === 0 ? input?.cursor : (previous?.nextCursor ?? undefined);
      return buildAdminSystemInstancesKey({ ...input, cursor, state }, enabled);
    },
    ([, pageInput]: readonly [string, AdminSystemGetInstanceRevisionsInput]) =>
      service.getInstanceRevisions(pageInput),
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );
  const pages = swr.data ?? [];
  const loadedPages = swr.data?.length ?? 0;
  const settled = swr.data !== undefined;
  // Bind accumulated pages to the first page's targetRevision. A mid-pagination
  // publish changes the fingerprint — drop later pages so rows are not mixed
  // across independent convergence snapshots.
  const anchorTargetRevision = pages[0]?.targetRevision;
  const consistentPages =
    anchorTargetRevision === undefined
      ? pages
      : pages.filter((page) => page.targetRevision === anchorTargetRevision);
  const targetRevisionDrift = consistentPages.length < pages.length;
  const seen = new Set<string>();
  const items = consistentPages.flatMap((page) =>
    page.items.filter((instance) => {
      if (seen.has(instance.instanceId)) return false;
      seen.add(instance.instanceId);
      return true;
    }),
  );
  const data = consistentPages[0] ? { ...consistentPages[0], items } : undefined;
  const errorPhase = classifyAdminSystemJobsError({
    error: swr.error,
    loadedPages,
    requestedPages: swr.size,
    settled,
  });
  const reachedEnd =
    !targetRevisionDrift && loadedPages > 0 && consistentPages.at(-1)?.nextCursor === null;

  return {
    backgroundError: errorPhase === 'background' ? swr.error : undefined,
    data,
    hasMore: enabled && loadedPages > 0 && !reachedEnd && !targetRevisionDrift,
    initialError: errorPhase === 'initial' ? swr.error : undefined,
    isLoadingInitial: enabled && !settled && swr.isValidating,
    isLoadingMore: swr.isValidating && loadedPages > 0 && swr.size > loadedPages,
    loadMore: () => void swr.setSize((size) => size + 1),
    loadMoreError:
      (errorPhase === 'load_more' && !swr.isValidating) ||
      (targetRevisionDrift && !swr.isValidating),
    refresh: () => swr.mutate(),
    retryLoadMore: () => {
      // Target-bound cursor rejected (or a successfully returned later page drifted):
      // re-sending the same cursor loops forever. Restart from page one.
      const cursorInvalidated =
        targetRevisionDrift ||
        (errorPhase === 'load_more' && isAdminSystemInvalidInputError(swr.error));
      if (cursorInvalidated) {
        void (async () => {
          await swr.setSize(1);
          await swr.mutate();
        })();
        return;
      }
      void swr.setSize(swr.size);
    },
  };
};

export interface AdminSystemJobsState {
  /** Error while the current page has something to show (previous rows are kept). */
  backgroundError: unknown;
  data?: AdminSystemJobsPage;
  /** Jump back to page 1 and reload it (after 清除 the old page numbers no longer apply). */
  goToFirstPage: () => Promise<void>;
  /** Error before any page could be shown. */
  initialError: unknown;
  isLoadingInitial: boolean;
  /**
   * Rows on screen belong to another page (or predate a 清除) while the requested one loads —
   * the table must not present them, or their row actions, as the current page.
   */
  isLoadingPage: boolean;
  jobs: AdminSystemJob[];
  page: number;
  pageSize: number;
  refresh: () => Promise<AdminSystemJobsPage | undefined>;
  setPagination: (page: number, pageSize: number) => void;
  total: number;
}

export const ADMIN_SYSTEM_JOBS_PAGE_SIZE = DEFAULT_TABLE_PAGE_SIZE;

/**
 * 近期任务 as one server page (`admin.system.jobs.list`) with an exact total.
 *
 * While the status aggregate reports active jobs the current page is re-read every 3s — in place,
 * no staged "apply updates" step — and every tick also refreshes the aggregate, which is the only
 * authority that can stop the loop.
 */
export const useAdminSystemJobs = (
  enabled: boolean,
  service: AdminSystemService,
  options: {
    authoritativeActiveCount?: number | null;
    refreshAuthority: () => Promise<unknown>;
  },
): AdminSystemJobsState => {
  const [pagination, setPaginationState] = useState({
    page: 1,
    pageSize: ADMIN_SYSTEM_JOBS_PAGE_SIZE,
  });
  const { page, pageSize } = pagination;
  /**
   * Bumped by 清除: every cached page may still list jobs that are now hidden, so the next read
   * goes to a fresh key (never a cached, possibly deduped one) and shows as loading until it lands.
   */
  const [generation, setGeneration] = useState(0);
  const shouldPoll = enabled && shouldPollAdminSystemJobs(options.authoritativeActiveCount);
  const shouldPollRef = useRef(shouldPoll);
  shouldPollRef.current = shouldPoll;
  const refreshAuthorityRef = useRef(options.refreshAuthority);
  refreshAuthorityRef.current = options.refreshAuthority;
  const refreshAuthority = useCallback(() => {
    void refreshAuthorityRef.current().catch((error: unknown) => {
      console.error('[admin.system] failed to refresh active-job authority', error);
    });
  }, []);

  // Active work only needs watching while somebody is watching: the poll (and the authority
  // refresh it drags along) stops for a background tab and resumes on refocus.
  const refreshInterval = useVisiblePoll(ACTIVE_JOB_POLL_INTERVAL_MS, shouldPoll);
  const swr = useClientDataSWR(
    buildAdminSystemJobsKey({ page, pageSize }, enabled, generation),
    () => service.listJobs({ page, pageSize }),
    {
      keepPreviousData: true,
      refreshInterval,
      revalidateOnFocus: false,
      onError: () => {
        // The status cards must not freeze behind a failing jobs list: keep the aggregate moving.
        if (shouldPollRef.current) refreshAuthority();
      },
      onSuccess: () => {
        if (!shouldPollRef.current) return;
        // A page of terminal rows says nothing about other pages. The aggregate decides when the
        // loop stops, so refresh it on every poll tick instead of inferring zero from this page.
        refreshAuthority();
      },
    },
  );

  // Publish before paint so the status hook can drop its 30s timer in the same frame. While the
  // jobs list is failing it cannot drive the status refresh, so the 30s status poll takes over.
  const jobsPollOwnsStatus = shouldPoll && !swr.error;
  useLayoutEffect(() => {
    setJobsStatusPollActive(jobsPollOwnsStatus);
    return () => setJobsStatusPollActive(false);
  }, [jobsPollOwnsStatus]);

  const data = swr.data as AdminSystemJobsPage | undefined;
  const total = data?.total ?? 0;
  // With `keepPreviousData`, SWR keeps reporting `isLoading` while it shows another key's rows.
  const isLoadingPage = enabled && data !== undefined && Boolean(swr.isLoading);

  // A page emptied underneath the operator (jobs cleared, rows hidden) snaps back to the last one
  // that still has rows instead of stranding them on a blank page.
  useEffect(() => {
    // `keepPreviousData` may still be showing another page while this one loads.
    if (!data || data.page !== page || data.items.length > 0 || page <= 1) return;
    const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
    if (lastPage < page) setPaginationState((current) => ({ ...current, page: lastPage }));
  }, [data, page, pageSize]);

  const mutate = swr.mutate;
  const refresh = useCallback(async () => {
    const result = (await mutate()) as AdminSystemJobsPage | undefined;
    refreshAuthority();
    return result;
  }, [mutate, refreshAuthority]);

  const goToFirstPage = useCallback(async () => {
    // A new key fetches on its own; the aggregate (job totals use the same filter) still needs
    // the refresh.
    setPaginationState((current) => ({ ...current, page: 1 }));
    setGeneration((current) => current + 1);
    await refreshAuthorityRef.current().catch((error: unknown) => {
      console.error('[admin.system] failed to refresh active-job authority', error);
    });
  }, []);

  const setPagination = useCallback((nextPage: number, nextPageSize: number) => {
    setPaginationState({ page: Math.max(1, nextPage), pageSize: nextPageSize });
  }, []);

  return {
    backgroundError: data ? swr.error : undefined,
    data,
    goToFirstPage,
    initialError: data ? undefined : swr.error,
    isLoadingInitial: enabled && !data && !swr.error && Boolean(swr.isValidating || swr.isLoading),
    isLoadingPage,
    jobs: data?.items ?? [],
    page,
    pageSize,
    refresh,
    setPagination,
    total,
  };
};

export interface AdminSystemJobMutations {
  busyJobIds: readonly string[];
  cancel: (job: AdminSystemJob) => Promise<AdminSystemJobMutationResult>;
  /** 清除: hide finished rows (non-destructive), then show page 1 again. */
  clear: () => Promise<AdminSystemJobsClearOutcome>;
  clearing: boolean;
  refreshPendingJobIds: readonly string[];
  retry: (job: AdminSystemJob) => Promise<AdminSystemJobMutationResult>;
  retryRefresh: () => Promise<boolean>;
}

export type AdminSystemJobMutationResult = 'conflict' | 'failed' | 'refresh_failed' | 'succeeded';

export type AdminSystemJobsClearOutcome =
  { hidden: number; ok: true } | { error: unknown; ok: false };

interface UseAdminSystemJobMutationsOptions {
  authMethod: AdminReauthAuthMethod;
  /** Runs after a successful 清除 — the owner resets to page 1 and reloads. */
  onCleared?: () => Promise<void>;
  onRefresh: () => Promise<AdminSystemJobsPage | undefined>;
  service: AdminSystemService;
}

export const useAdminSystemJobMutations = ({
  authMethod,
  onCleared,
  onRefresh,
  service,
}: UseAdminSystemJobMutationsOptions): AdminSystemJobMutations => {
  const busyRef = useRef(new Set<string>());
  const refreshPendingRef = useRef(new Map<string, AdminSystemJob>());
  const clearingRef = useRef(false);
  const [busyJobIds, setBusyJobIds] = useState<readonly string[]>([]);
  const [refreshPendingJobIds, setRefreshPendingJobIds] = useState<readonly string[]>([]);
  const [clearing, setClearing] = useState(false);

  const retryRefresh = useCallback(async () => {
    try {
      const refreshed = await onRefresh();
      for (const [jobId, committed] of refreshPendingRef.current) {
        if (didAdminSystemJobRefreshConfirm(refreshed?.items, committed)) {
          refreshPendingRef.current.delete(jobId);
        }
      }
      setRefreshPendingJobIds([...refreshPendingRef.current.keys()]);
      return refreshPendingRef.current.size === 0;
    } catch (error) {
      console.error('[admin.system] failed to refresh committed job state', error);
      return false;
    }
  }, [onRefresh]);

  const run = useCallback(
    async (job: AdminSystemJob, action: AdminSystemJobAction) => {
      if (
        busyRef.current.has(job.jobId) ||
        refreshPendingRef.current.has(job.jobId) ||
        !canRunAdminSystemJobAction(job, action)
      ) {
        return 'failed' as const;
      }
      const expectedRevision = job.revision;
      if (expectedRevision === null) return 'failed' as const;
      busyRef.current.add(job.jobId);
      setBusyJobIds([...busyRef.current]);
      const requestId = crypto.randomUUID();
      try {
        let committed: AdminSystemJob;
        try {
          committed = await withAdminReauthRetry(
            () => {
              const base = {
                expectedRevision,
                jobId: job.jobId,
                requestId,
              };
              if (action === 'cancel') {
                if (job.status !== 'pending' && job.status !== 'running') {
                  return Promise.reject(new Error('PLATFORM_INVALID_JOB_TRANSITION'));
                }
                return service.cancelJob({ ...base, expectedStatus: job.status });
              }
              if (job.status !== 'cancelled' && job.status !== 'dead' && job.status !== 'failed') {
                return Promise.reject(new Error('PLATFORM_INVALID_JOB_TRANSITION'));
              }
              return service.retryJob({ ...base, expectedStatus: job.status });
            },
            { authMethod },
          );
        } catch (error) {
          if (isAdminSystemConflictError(error)) {
            await onRefresh().catch((refreshError: unknown) => {
              console.error('[admin.system] failed to refresh after a job conflict', refreshError);
            });
            return 'conflict' as const;
          }
          console.error('[admin.system] job mutation failed', error);
          return 'failed' as const;
        }

        // Mutation response is the authoritative CAS result (by-id confirmation).
        // List refresh is best-effort for UI; pagination drift must not lock the row.
        if (!isAdminSystemJobMutationAuthoritative(committed)) {
          refreshPendingRef.current.set(job.jobId, committed);
          setRefreshPendingJobIds([...refreshPendingRef.current.keys()]);
          return 'refresh_failed' as const;
        }
        try {
          const refreshed = await onRefresh();
          if (!didAdminSystemJobRefreshConfirm(refreshed?.items, committed)) {
            // Stale row still visible on the current page with different CAS — keep pending.
            throw new Error('PLATFORM_COMMITTED_JOB_REFRESH_UNCONFIRMED');
          }
          return 'succeeded' as const;
        } catch (error) {
          // Network / hard refresh failure: retain pending so the operator can retry.
          // Pagination omission is not a failure (handled in didAdminSystemJobRefreshConfirm).
          if (
            error instanceof Error &&
            error.message === 'PLATFORM_COMMITTED_JOB_REFRESH_UNCONFIRMED'
          ) {
            refreshPendingRef.current.set(job.jobId, committed);
            setRefreshPendingJobIds([...refreshPendingRef.current.keys()]);
            console.error('[admin.system] job mutation committed but refresh failed', error);
            return 'refresh_failed' as const;
          }
          // Refresh threw (network): still treat mutation as committed; flag for retry UI.
          refreshPendingRef.current.set(job.jobId, committed);
          setRefreshPendingJobIds([...refreshPendingRef.current.keys()]);
          console.error('[admin.system] job mutation committed but refresh failed', error);
          return 'refresh_failed' as const;
        }
      } finally {
        busyRef.current.delete(job.jobId);
        setBusyJobIds([...busyRef.current]);
      }
    },
    [authMethod, onRefresh, service],
  );

  const clear = useCallback(async (): Promise<AdminSystemJobsClearOutcome> => {
    if (clearingRef.current) return { error: new Error('PLATFORM_JOBS_CLEAR_PENDING'), ok: false };
    clearingRef.current = true;
    setClearing(true);
    try {
      const result = await withAdminReauthRetry(() => service.clearJobs(), { authMethod });
      // 清除 writes the shared settings row: an open 告警设置 drawer needs its new revision.
      void invalidateAdminSystemAlerts();
      // The watermark moved: every page number the operator had open now points elsewhere.
      await onCleared?.().catch((error: unknown) => {
        console.error('[admin.system] failed to reload jobs after clearing', error);
      });
      return { hidden: result.hidden, ok: true };
    } catch (error) {
      console.error('[admin.system] failed to clear jobs', error);
      return { error, ok: false };
    } finally {
      clearingRef.current = false;
      setClearing(false);
    }
  }, [authMethod, onCleared, service]);

  return {
    busyJobIds,
    cancel: (job) => run(job, 'cancel'),
    clear,
    clearing,
    refreshPendingJobIds,
    retryRefresh,
    retry: (job) => run(job, 'retry'),
  };
};
