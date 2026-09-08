'use client';

import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDefaultInboxAvatar } from '@/hooks/useDefaultInboxAvatar';

import type { AdminDefaultAgentSnapshot } from './useAdminAgents';

const styles = createStaticStyles(({ css }) => ({
  identity: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  `,
  root: css`
    padding: 16px;
  `,
}));

export interface DefaultAgentSectionProps {
  /** AGENT_UPDATE or AGENT_ASSIGN — the same gate the table rows use to open the editor. */
  canEdit: boolean;
  /**
   * AGENT_CREATE + AGENT_PUBLISH + AGENT_ASSIGN: initializing the default writes a published Agent
   * and points every member at it — the same compound the server requires.
   */
  canProvision: boolean;
  error: unknown;
  onEdit: (agentId: string) => void;
  /** Re-run the automatic initialization after it failed. */
  onProvisionRetry: () => void;
  /** Re-run the pointer read after a failed revalidation left a cached card on screen. */
  onRetry: () => void;
  /** The automatic initialization failed — the card owns that message, not a toast. */
  provisionFailed: boolean;
  provisioning: boolean;
  /** Undefined until the pointer read settles; `null` once it settles with no managed default. */
  snapshot: AdminDefaultAgentSnapshot | null | undefined;
}

/**
 * The 默认助理 pinned above the catalog table.
 *
 * The default assistant is the one every member meets first, and it is exactly one row — burying
 * it in a paginated, searchable table hides the highest-leverage thing on this page. Pinned here
 * it is always visible, and the table below never repeats it.
 */
export const DefaultAgentSection = memo<DefaultAgentSectionProps>(
  ({
    canEdit,
    canProvision,
    error,
    onEdit,
    onProvisionRetry,
    onRetry,
    provisionFailed,
    provisioning,
    snapshot,
  }) => {
    const { t } = useTranslation('admin');
    // The avatar lives on the current version, not on the list row. The version itself is never
    // shown: saving IS publishing here, so there is no version for an admin to reason about.
    const version = snapshot?.detail?.versions.find(
      ({ id }) => id === snapshot.item.identity.currentVersionId,
    );
    // This card is always the default assistant, whose built-in avatar members see as the
    // published brand icon — the card must not claim otherwise. Display only; nothing is stored.
    const avatar = useDefaultInboxAvatar(version?.config.avatar);

    // A failed revalidation on top of a settled read is no reason to hide the assistant every
    // member is already talking to: keep the last known state, say it may be behind, and offer the
    // retry. Only a read that never settled has nothing to show, and that alone is terminal.
    const stale = Boolean(error) && snapshot !== undefined;

    const body = () => {
      if (snapshot === undefined) {
        if (error) return <Text type={'danger'}>{t('agentCatalog.defaultAgent.loadError')}</Text>;
        return <Text type={'secondary'}>{t('agentCatalog.defaultAgent.loading')}</Text>;
      }

      // There is no "start managing the default" step: it must simply be there, so a settled
      // "no default" is a state being repaired, not a choice waiting on the admin.
      if (!snapshot) {
        if (!canProvision) {
          return (
            <Text type={'secondary'}>{t('agentCatalog.defaultAgent.provision.readOnly')}</Text>
          );
        }
        if (provisionFailed) {
          return (
            <Flexbox align={'flex-start'} gap={12}>
              <Text type={'danger'}>{t('agentCatalog.defaultAgent.provision.error')}</Text>
              <Button loading={provisioning} onClick={onProvisionRetry}>
                {t('agentCatalog.dependency.retry')}
              </Button>
            </Flexbox>
          );
        }
        return <Text type={'secondary'}>{t('agentCatalog.defaultAgent.preparing')}</Text>;
      }

      const { item } = snapshot;

      // One compact row: who the assistant is on the left, the single action on the right. The
      // status and the model are deliberately absent — this card is always the published default,
      // and the model is an editor-level detail that says nothing an admin acts on from here.
      return (
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={12} style={{ flex: 1, minWidth: 0 }}>
            <Avatar
              avatar={avatar}
              background={version?.config.backgroundColor ?? undefined}
              shape={'square'}
              size={44}
            />
            <div className={styles.identity}>
              <Text ellipsis weight={600}>
                {item.displayName}
              </Text>
              <Text ellipsis type={'secondary'}>
                {t('agentCatalog.defaultAgent.description')}
              </Text>
            </div>
          </Flexbox>
          {canEdit ? (
            <Button type={'primary'} onClick={() => onEdit(item.identity.id)}>
              {t('agentCatalog.action.edit')}
            </Button>
          ) : null}
        </Flexbox>
      );
    };

    return (
      <Block className={styles.root} gap={12} variant={'outlined'}>
        {/* The heading names the card; what the default assistant *is* now reads as the
            assistant's own second line, right under its name, instead of a caption up here. */}
        <Text weight={600}>{t('agentCatalog.defaultAgent.title')}</Text>
        {stale ? (
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Text type={'warning'}>{t('agentCatalog.defaultAgent.loadError')}</Text>
            <Button size={'small'} onClick={onRetry}>
              {t('agentCatalog.dependency.retry')}
            </Button>
          </Flexbox>
        ) : null}
        {body()}
      </Block>
    );
  },
);

DefaultAgentSection.displayName = 'DefaultAgentSection';
