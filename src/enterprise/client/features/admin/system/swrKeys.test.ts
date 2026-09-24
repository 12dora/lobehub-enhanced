import { describe, expect, it } from 'vitest';

import {
  ADMIN_SYSTEM_ALERTS_KEY,
  ADMIN_SYSTEM_AUTH_SNAPSHOT_KEY,
  ADMIN_SYSTEM_INSTANCES_KEY,
  ADMIN_SYSTEM_JOBS_KEY,
  ADMIN_SYSTEM_STATUS_API_KEY,
  ADMIN_SYSTEM_STATUS_KEY,
  buildAdminSystemAlertsKey,
  buildAdminSystemAuthSnapshotKey,
  buildAdminSystemInstancesKey,
  buildAdminSystemJobsKey,
  buildAdminSystemStatusApiKey,
  buildAdminSystemStatusKey,
} from './swrKeys';

describe('Admin System SWR permission gates', () => {
  it('returns null keys when SYSTEM_READ is unavailable', () => {
    expect(buildAdminSystemStatusKey(false)).toBeNull();
    expect(buildAdminSystemAuthSnapshotKey(false)).toBeNull();
    expect(buildAdminSystemInstancesKey({ limit: 50 }, false)).toBeNull();
    expect(buildAdminSystemJobsKey({ page: 1, pageSize: 20 }, false)).toBeNull();
    expect(buildAdminSystemAlertsKey(false)).toBeNull();
    expect(buildAdminSystemStatusApiKey(false)).toBeNull();
  });

  it('keeps cursor and state inputs in enabled keys', () => {
    expect(buildAdminSystemStatusKey(true)).toEqual([ADMIN_SYSTEM_STATUS_KEY]);
    expect(buildAdminSystemAuthSnapshotKey(true)).toEqual([ADMIN_SYSTEM_AUTH_SNAPSHOT_KEY]);
    expect(
      buildAdminSystemInstancesKey({ cursor: 'instance-next', limit: 20, state: 'all' }, true),
    ).toEqual([ADMIN_SYSTEM_INSTANCES_KEY, { cursor: 'instance-next', limit: 20, state: 'all' }]);
    // Filter changes must produce a distinct key so pages are never mixed across row sets.
    expect(buildAdminSystemInstancesKey({ limit: 20, state: 'live' }, true)).not.toEqual(
      buildAdminSystemInstancesKey({ limit: 20, state: 'all' }, true),
    );
  });

  it('keys each jobs page by page number, page size and 清除 generation', () => {
    expect(buildAdminSystemJobsKey({ page: 2, pageSize: 50 }, true)).toEqual([
      ADMIN_SYSTEM_JOBS_KEY,
      2,
      50,
      0,
    ]);
    expect(buildAdminSystemJobsKey({ page: 1, pageSize: 20 }, true)).not.toEqual(
      buildAdminSystemJobsKey({ page: 1, pageSize: 50 }, true),
    );
    // After 清除 no page cached under the old watermark may be reused.
    expect(buildAdminSystemJobsKey({ page: 1, pageSize: 20 }, true, 1)).not.toEqual(
      buildAdminSystemJobsKey({ page: 1, pageSize: 20 }, true),
    );
  });

  it('keys the alert-settings drawer queries', () => {
    expect(buildAdminSystemAlertsKey(true)).toEqual([ADMIN_SYSTEM_ALERTS_KEY]);
    expect(buildAdminSystemStatusApiKey(true)).toEqual([ADMIN_SYSTEM_STATUS_API_KEY]);
  });
});
