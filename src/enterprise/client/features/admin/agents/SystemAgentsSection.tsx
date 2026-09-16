'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { useDefaultInboxAvatar } from '@/hooks/useDefaultInboxAvatar';

import { SystemAgentCard } from './SystemAgentCard';
import type { AdminSystemAgentSnapshot } from './useTaskManagerAgent';

/** The published version the pinned card reads its avatar and background from. */
const currentVersion = (snapshot: AdminSystemAgentSnapshot | null | undefined) =>
  snapshot?.detail?.versions.find(({ id }) => id === snapshot.item.identity.currentVersionId);

export interface SystemAgentPinProps {
  /** AGENT_UPDATE or AGENT_ASSIGN — the same gate the table rows use to open the editor. */
  canEdit: boolean;
  /** AGENT_CREATE + AGENT_PUBLISH + AGENT_ASSIGN, as the server's provisioning demands. */
  canProvision: boolean;
  error: unknown;
  onEdit: (agentId: string) => void;
  /** Re-run the initialization — a retry for the inbox, the takeover for the task assistant. */
  onProvision: () => void;
  /** Re-run the pointer read after a failed revalidation left a cached card on screen. */
  onRetry: () => void;
  provisionFailed: boolean;
  provisioning: boolean;
  /** Undefined until the read settles; `null` once it settles with no managed assistant. */
  snapshot: AdminSystemAgentSnapshot | null | undefined;
}

export interface SystemAgentsSectionProps {
  /** The 默认助理 (`default-inbox`): every member's first assistant. */
  defaultInbox: SystemAgentPinProps;
  /** The 任务助手 (`task-manager`): the assistant behind every member's task page. */
  taskManager: SystemAgentPinProps;
}

/**
 * The platform's reserved assistants, pinned above the catalog table.
 *
 * Both are single rows the platform owns end to end: the admin edits what they say and which
 * model they run on, but never their identifier, their lifecycle or who receives them. They are
 * pinned rather than listed because there is exactly one of each and both are the highest-leverage
 * thing on this page; the table below filters every system row out so nothing is said twice.
 */
export const SystemAgentsSection = memo<SystemAgentsSectionProps>(
  ({ defaultInbox, taskManager }) => {
    const { t } = useTranslation('admin');
    const inboxVersion = currentVersion(defaultInbox.snapshot);
    const taskVersion = currentVersion(taskManager.snapshot);
    // The default assistant's built-in avatar is what members see as the published brand icon, so
    // the card must not claim otherwise. Display only; nothing is stored.
    const inboxAvatar = useDefaultInboxAvatar(inboxVersion?.config.avatar);

    return (
      <Flexbox gap={12}>
        <SystemAgentCard
          {...defaultInbox}
          avatar={inboxAvatar}
          background={inboxVersion?.config.backgroundColor ?? undefined}
          title={t('agentCatalog.defaultAgent.title')}
          copy={{
            description: t('agentCatalog.defaultAgent.description'),
            loadError: t('agentCatalog.defaultAgent.loadError'),
            loading: t('agentCatalog.defaultAgent.loading'),
            preparing: t('agentCatalog.defaultAgent.preparing'),
            provisionError: t('agentCatalog.defaultAgent.provision.error'),
            provisionReadOnly: t('agentCatalog.defaultAgent.provision.readOnly'),
          }}
        />
        {/* The task assistant has a working built-in behind it, so a missing managed row is not a
            broken platform — it gets a takeover button instead of an unattended repair. */}
        <SystemAgentCard
          {...taskManager}
          showStatus
          avatar={taskVersion?.config.avatar ?? DEFAULT_AVATAR}
          background={taskVersion?.config.backgroundColor ?? undefined}
          provisionAction={t('agentCatalog.taskManagerAgent.provision.action')}
          title={t('agentCatalog.taskManagerAgent.title')}
          unmanagedLabel={t('agentCatalog.taskManagerAgent.unmanaged')}
          copy={{
            description: t('agentCatalog.taskManagerAgent.description'),
            loadError: t('agentCatalog.taskManagerAgent.loadError'),
            loading: t('agentCatalog.taskManagerAgent.loading'),
            preparing: t('agentCatalog.taskManagerAgent.preparing'),
            provisionError: t('agentCatalog.taskManagerAgent.provision.error'),
            provisionReadOnly: t('agentCatalog.taskManagerAgent.provision.readOnly'),
          }}
        />
      </Flexbox>
    );
  },
);

SystemAgentsSection.displayName = 'SystemAgentsSection';
