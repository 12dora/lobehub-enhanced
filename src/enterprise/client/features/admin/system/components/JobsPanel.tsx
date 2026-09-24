'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { openDangerConfirm } from '@/enterprise/client/features/admin/primitives/DangerConfirm';
import DataTable from '@/enterprise/client/features/admin/primitives/DataTable';
import { DEFAULT_PAGE_SIZE_OPTIONS } from '@/enterprise/client/features/admin/primitives/dataTableChange';
import {
  AdminReauthBlockedError,
  AdminReauthCancelledError,
} from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import type { AdminSystemJobAction } from '@/enterprise/client/features/admin/system/controller';
import { canRunAdminSystemJobAction } from '@/enterprise/client/features/admin/system/controller';
import type {
  AdminSystemJobMutations,
  AdminSystemJobsState,
} from '@/enterprise/client/features/admin/system/hooks/useAdminSystem';
import type { AdminSystemJob } from '@/enterprise/client/services/adminSystem';

import { buildJobsColumns } from './jobsColumns';
import { SectionHeader } from './SectionHeader';

export interface JobsPanelProps {
  canOperate: boolean;
  mutations: AdminSystemJobMutations;
  state: AdminSystemJobsState;
}

/** 近期任务: one server page at a time, with 清除 for operators. */
export const JobsPanel = memo<JobsPanelProps>(({ canOperate, mutations, state }) => {
  const { t } = useTranslation('admin');
  const blocked = useMemo(
    () => new Set([...mutations.busyJobIds, ...mutations.refreshPendingJobIds]),
    [mutations.busyJobIds, mutations.refreshPendingJobIds],
  );

  const openAction = useCallback(
    (job: AdminSystemJob, action: AdminSystemJobAction) => {
      if (blocked.has(job.jobId) || !canRunAdminSystemJobAction(job, action)) return;
      // Job control is operational, not destructive: confirm intent, never ask for a reason.
      openDangerConfirm({
        confirmText: t(`system.jobs.actions.${action}` as never),
        title: t(`system.jobs.modal.${action}.title` as never),
        content:
          action === 'cancel'
            ? `${t('system.jobs.modal.cancel.description', { jobId: job.jobId })} ${t(
                'system.jobs.modal.cancel.completedItems',
              )}`
            : t('system.jobs.modal.retry.description', { jobId: job.jobId }),
        onConfirm: async () => {
          const result =
            action === 'cancel' ? await mutations.cancel(job) : await mutations.retry(job);
          if (result === 'succeeded') {
            toast.success(t(`system.jobs.toast.${action}Requested` as never));
          } else if (result === 'conflict') {
            toast.error(t('system.jobs.toast.conflict'));
          } else if (result === 'refresh_failed') {
            toast.error(t('system.jobs.toast.committedRefreshFailed'));
          } else {
            toast.error(t(`system.jobs.toast.${action}Failed` as never));
          }
        },
      });
    },
    [blocked, mutations, t],
  );

  const openClear = useCallback(() => {
    if (mutations.clearing) return;
    // Non-destructive: finished rows are only hidden; running work keeps going.
    openDangerConfirm({
      confirmText: t('system.jobs.actions.clear'),
      content: t('system.jobs.modal.clear.description'),
      title: t('system.jobs.modal.clear.title'),
      onConfirm: async () => {
        const outcome = await mutations.clear();
        if (outcome.ok) {
          toast.success(t('system.jobs.toast.cleared', { count: outcome.hidden }));
          return;
        }
        if (outcome.error instanceof AdminReauthCancelledError) {
          toast.error(t('system.actions.reauthCancelled'));
        } else if (outcome.error instanceof AdminReauthBlockedError) {
          toast.error(t('users.errors.reauthBlocked'));
        } else {
          toast.error(t('system.jobs.toast.clearFailed'));
        }
      },
    });
  }, [mutations, t]);

  const columns = useMemo(
    () =>
      buildJobsColumns({
        blocked,
        busyJobIds: mutations.busyJobIds,
        canOperate,
        openAction,
        t,
      }),
    [blocked, canOperate, mutations.busyJobIds, openAction, t],
  );

  // Another page's (or pre-清除) rows must not stand in for the requested page.
  const tableLoading = state.isLoadingInitial || state.isLoadingPage;

  return (
    <Flexbox gap={8}>
      <SectionHeader
        title={t('system.jobs.title')}
        actions={
          canOperate ? (
            <Button
              disabled={mutations.clearing || state.total === 0}
              loading={mutations.clearing}
              size="small"
              onClick={openClear}
            >
              {t('system.jobs.actions.clear')}
            </Button>
          ) : null
        }
      />
      {!canOperate ? <Alert showIcon message={t('system.jobs.readOnly')} type="info" /> : null}
      {mutations.refreshPendingJobIds.length > 0 ? (
        <Alert
          showIcon
          message={t('system.jobs.committedRefreshFailed')}
          type="warning"
          action={
            <Button size="small" onClick={() => void mutations.retryRefresh()}>
              {t('system.actions.retry')}
            </Button>
          }
        />
      ) : null}
      {state.backgroundError && state.data ? (
        <Alert
          showIcon
          message={t('system.jobs.refreshFailed')}
          type="warning"
          action={
            <Button size="small" onClick={() => void state.refresh()}>
              {t('system.actions.retry')}
            </Button>
          }
        />
      ) : null}
      <DataTable<AdminSystemJob>
        columns={columns}
        dataSource={state.jobs}
        emptyDescription={t('system.jobs.empty')}
        error={Boolean(state.initialError)}
        loading={tableLoading}
        rowKey="jobId"
        scroll={{ x: canOperate ? 1100 : 930 }}
        size="small"
        pagination={{
          current: state.page,
          pageSize: state.pageSize,
          pageSizeOptions: [...DEFAULT_PAGE_SIZE_OPTIONS],
          total: state.total,
        }}
        onPaginationChange={state.setPagination}
        onRetry={() => void state.refresh()}
      />
    </Flexbox>
  );
});

JobsPanel.displayName = 'AdminSystemJobsPanel';
