'use client';

import { mutate } from '@/libs/swr';

import { ADMIN_SYSTEM_ALERTS_KEY } from './swrKeys';

/**
 * Re-read the 告警设置 document after a write that shares its settings row (token rotate / revoke,
 * jobs 清除). On a fresh install such a write creates the row, so the revision an open drawer holds
 * would otherwise be stale and its next save rejected as a conflict nobody caused.
 *
 * Matched by predicate because `useClientDataSWR` appends the workspace id to the key.
 */
export const invalidateAdminSystemAlerts = (): Promise<unknown> =>
  mutate((key) => Array.isArray(key) && key[0] === ADMIN_SYSTEM_ALERTS_KEY).catch(
    (error: unknown) => {
      console.error('[admin.system] failed to refresh alert settings', error);
    },
  );
