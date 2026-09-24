'use client';

import { useClientDataSWR } from '@/libs/swr';
import { dingtalkPersonalService, type DingtalkPersonalStatus } from '@/services/dingtalkPersonal';

export const DINGTALK_PERSONAL_STATUS_KEY = 'dingtalkPersonal:status';

/**
 * The member's own authorization, read from the database only (no sidecar call). Every card on the
 * page shares the key, so a login finished in the chat card also flips the settings card.
 */
export const useDingtalkPersonalStatus = (enabled = true) =>
  useClientDataSWR<DingtalkPersonalStatus>(enabled ? DINGTALK_PERSONAL_STATUS_KEY : null, () =>
    dingtalkPersonalService.getStatus(),
  );
