'use client';

import { toast } from '@lobehub/ui/base-ui';
import i18n from 'i18next';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { runAdminMutation } from '@/enterprise/client/features/admin/primitives/runAdminMutation';
import type { AdminReauthAuthMethod } from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import { adminAgentsService } from '@/enterprise/client/services/adminAgents';

import type { AdminAgentsClient } from './types';
import type { AdminAgentRefresh } from './useAdminAgentRefresh';

export interface UseProvisionTaskManagerParams {
  authMethod: AdminReauthAuthMethod | null;
  client?: AdminAgentsClient;
  /** Both pinned cards AND the table: the write adds a catalog row that did not exist before. */
  refresh: AdminAgentRefresh['defaultAndList'];
}

/**
 * Take over the 任务助手 on request.
 *
 * The server provisions this assistant at startup and again before every admin list read, so the
 * card normally finds it already there. This is the explicit fallback for the window before that
 * happened — or for a platform whose bootstrap could not run — which is why it is a button an
 * operator presses rather than the unattended repair the default assistant gets: the task
 * assistant has a working built-in behind it, so nothing is broken while it is missing.
 */
export const useProvisionTaskManager = ({
  authMethod,
  client = adminAgentsService,
  refresh,
}: UseProvisionTaskManagerParams) => {
  const { t } = useTranslation('admin');
  const [provisioning, setProvisioning] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  const provision = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setProvisioning(true);
    const committed = await runAdminMutation({
      authMethod,
      // The card owns the failure surface, so the message stays next to the missing assistant.
      onError: () => setFailed(true),
      run: async () => {
        // The seeded name / prompt are written in the admin's own UI language.
        await client.provisionTaskManager({ locale: i18n.resolvedLanguage || i18n.language });
      },
    });
    setProvisioning(false);
    inFlight.current = false;
    if (!committed) return;
    setFailed(false);

    try {
      await refresh();
    } catch {
      toast.warning(t('agentCatalog.recovery.refreshFailed'));
    }
    toast.success(t('agentCatalog.taskManagerAgent.provision.success'));
  }, [authMethod, client, refresh, t]);

  return { failed, provision, provisioning };
};
