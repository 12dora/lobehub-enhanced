import type {
  AdminSystemGetInstanceRevisionsInput,
  AdminSystemJobsListInput,
} from '@/enterprise/client/services/adminSystem';

export const ADMIN_SYSTEM_STATUS_KEY = 'admin.system.getStatus';
export const ADMIN_SYSTEM_AUTH_SNAPSHOT_KEY = 'admin.system.getAuthSnapshotStatus';
export const ADMIN_SYSTEM_INSTANCES_KEY = 'admin.system.getInstanceRevisions';
export const ADMIN_SYSTEM_JOBS_KEY = 'admin.system.jobs.list';
export const ADMIN_SYSTEM_ALERTS_KEY = 'admin.system.alerts.get';
export const ADMIN_SYSTEM_STATUS_API_KEY = 'admin.system.statusApi.get';

export const buildAdminSystemStatusKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_STATUS_KEY] as const) : null;

export const buildAdminSystemAuthSnapshotKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_AUTH_SNAPSHOT_KEY] as const) : null;

export const buildAdminSystemInstancesKey = (
  input: AdminSystemGetInstanceRevisionsInput,
  enabled: boolean,
) => (enabled ? ([ADMIN_SYSTEM_INSTANCES_KEY, input] as const) : null);

/**
 * One key per server page: page and page size are both part of the row set, and `generation`
 * (bumped by 清除) retires every page cached before the watermark moved.
 */
export const buildAdminSystemJobsKey = (
  input: AdminSystemJobsListInput,
  enabled: boolean,
  generation = 0,
) => (enabled ? ([ADMIN_SYSTEM_JOBS_KEY, input.page, input.pageSize, generation] as const) : null);

export const buildAdminSystemAlertsKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_ALERTS_KEY] as const) : null;

export const buildAdminSystemStatusApiKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_STATUS_API_KEY] as const) : null;
