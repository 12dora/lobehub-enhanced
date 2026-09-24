'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Bell } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminLoadingSurface } from '@/enterprise/client/features/admin/pages/AdminStateSurfaces';
import AdminPageTemplate from '@/enterprise/client/features/admin/primitives/AdminPageTemplate';
import type { SsoAuthSnapshot } from '@/enterprise/client/features/admin/system/controller';
import type {
  AdminSystemInstancesState,
  AdminSystemJobMutations,
  AdminSystemJobsState,
} from '@/enterprise/client/features/admin/system/hooks/useAdminSystem';
import {
  type AdminStatusAlertsService,
  type AdminStatusApiService,
  adminSystemService,
  type AdminSystemStatus,
} from '@/enterprise/client/services/adminSystem';

import { AlertSettingsDrawer } from './alerts/AlertSettingsDrawer';
import { InstancesTable } from './components/InstancesTable';
import { JobsPanel } from './components/JobsPanel';
import {
  CapabilityReadiness,
  RecentEventList,
  RuntimeErrorList,
  StatusSummaryBadge,
  WorkerHealthList,
} from './components/RuntimeHealth';
import { SectionHeader } from './components/SectionHeader';
import {
  BuildSummary,
  DependencyGrid,
  JobsSummary,
  OidcSummary,
  PublishFailures,
} from './components/SystemOverview';

const styles = createStaticStyles(({ css }) => ({
  section: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface AsyncSnapshot<T> {
  data?: T;
  error: unknown;
  isLoading: boolean;
}

export interface SystemPageViewProps {
  alertSettingsOpen: boolean;
  /** Injectable for tests; defaults to the tRPC-backed service. */
  alertsService?: AdminStatusAlertsService & AdminStatusApiService;
  authSnapshot?: SsoAuthSnapshot | null;
  canOperate: boolean;
  /** SYSTEM_READ granted and access resolved — gates the drawer's own queries. */
  canRead: boolean;
  instances: AdminSystemInstancesState;
  isRefreshing: boolean;
  jobs: AdminSystemJobsState;
  mutations: AdminSystemJobMutations;
  onAlertSettingsOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onShowOfflineInstancesChange: (showOffline: boolean) => void;
  showOfflineInstances: boolean;
  status: AsyncSnapshot<AdminSystemStatus> & { retry: () => void };
}

export const SystemPageView = memo<SystemPageViewProps>(
  ({
    alertSettingsOpen,
    alertsService = adminSystemService,
    authSnapshot,
    canOperate,
    canRead,
    instances,
    isRefreshing,
    jobs,
    mutations,
    onAlertSettingsOpenChange,
    onRefresh,
    onShowOfflineInstancesChange,
    showOfflineInstances,
    status,
  }) => {
    const { t } = useTranslation('admin');

    return (
      <AdminPageTemplate
        notice={status.data ? <StatusSummaryBadge status={status.data} /> : undefined}
        title={t('system.title')}
        actions={
          <>
            <Button icon={Bell} onClick={() => onAlertSettingsOpenChange(true)}>
              {t('system.actions.alertSettings')}
            </Button>
            <Button loading={isRefreshing} type="primary" onClick={onRefresh}>
              {t('system.actions.refresh')}
            </Button>
          </>
        }
      >
        {status.error && status.data ? (
          <Alert
            showIcon
            title={t('system.status.refreshFailed')}
            type="warning"
            action={
              <Button size="small" onClick={status.retry}>
                {t('system.actions.retry')}
              </Button>
            }
          />
        ) : null}

        {status.error && !status.data ? (
          <Alert
            showIcon
            description={t('system.status.loadFailedDescription')}
            title={t('system.status.loadFailed')}
            type="error"
            action={
              <Button size="small" type="primary" onClick={status.retry}>
                {t('system.actions.retry')}
              </Button>
            }
          />
        ) : status.isLoading && !status.data ? (
          <AdminLoadingSurface />
        ) : status.data ? (
          <Flexbox gap={20}>
            <BuildSummary status={status.data} />
            <DependencyGrid status={status.data} />
            <CapabilityReadiness status={status.data} />
            <WorkerHealthList status={status.data} />
            <RuntimeErrorList status={status.data} />
            <RecentEventList status={status.data} />
            <OidcSummary snapshot={authSnapshot} status={status.data} />
            <JobsSummary status={status.data} />
            <PublishFailures status={status.data} />
          </Flexbox>
        ) : null}

        <div className={styles.section}>
          <SectionHeader help={t('system.instances.help')} title={t('system.instances.title')} />
          <InstancesTable
            showOffline={showOfflineInstances}
            state={instances}
            onShowOfflineChange={onShowOfflineInstancesChange}
          />
        </div>

        <div className={styles.section}>
          <JobsPanel canOperate={canOperate} mutations={mutations} state={jobs} />
        </div>

        <AlertSettingsDrawer
          canOperate={canOperate}
          canRead={canRead}
          open={alertSettingsOpen}
          service={alertsService}
          onClose={() => onAlertSettingsOpenChange(false)}
        />
      </AdminPageTemplate>
    );
  },
);

SystemPageView.displayName = 'AdminSystemPageView';
