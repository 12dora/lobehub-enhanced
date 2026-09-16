'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Avatar, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import StatusBadge from '../primitives/StatusBadge';
import type { AdminSystemAgentSnapshot } from './useTaskManagerAgent';

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

/** The copy one pinned system assistant owns. Every string is an admin-namespace key. */
export interface SystemAgentCardCopy {
  /** What this assistant is, read as the identity's own second line under its name. */
  description: string;
  loadError: string;
  loading: string;
  /** Shown while the automatic initialization is expected to land on its own. */
  preparing: string;
  provisionError: string;
  /** Says who to ask when this operator may not initialize it. */
  provisionReadOnly: string;
}

export interface SystemAgentCardProps {
  /** Already resolved for display — the card never rewrites what is stored. */
  avatar?: string;
  background?: string;
  /** AGENT_UPDATE or AGENT_ASSIGN — the same gate the table rows use to open the editor. */
  canEdit: boolean;
  /** AGENT_CREATE + AGENT_PUBLISH + AGENT_ASSIGN, the compound the server's provisioning needs. */
  canProvision: boolean;
  copy: SystemAgentCardCopy;
  error: unknown;
  onEdit: (agentId: string) => void;
  /** Re-run the initialization. Absent → the empty state offers no action of its own. */
  onProvision?: () => void;
  /** Re-run the pointer read after a failed revalidation left a cached card on screen. */
  onRetry: () => void;
  /**
   * Label for the explicit takeover button. When set, a settled "not managed" offers it instead
   * of only announcing that the automatic initialization is still expected.
   */
  provisionAction?: string;
  provisionFailed: boolean;
  provisioning: boolean;
  /** Show the catalog status (已发布 / 草稿) next to the identity, and 未托管 when there is none. */
  showStatus?: boolean;
  /** Undefined until the read settles; `null` once it settles with no managed assistant. */
  snapshot: AdminSystemAgentSnapshot | null | undefined;
  /** The heading that names the card. */
  title: string;
  /** What "there is no managed row yet" is called on this card — only used with `showStatus`. */
  unmanagedLabel?: string;
}

/**
 * One pinned system assistant above the catalog table.
 *
 * A system assistant is exactly one row that every member meets — burying it in a paginated,
 * searchable table hides the highest-leverage thing on this page. Pinned here it is always
 * visible, and the table below never repeats it.
 */
export const SystemAgentCard = memo<SystemAgentCardProps>(
  ({
    avatar,
    background,
    canEdit,
    canProvision,
    copy,
    error,
    onEdit,
    onProvision,
    onRetry,
    provisionAction,
    provisionFailed,
    provisioning,
    showStatus = false,
    snapshot,
    title,
    unmanagedLabel,
  }) => {
    const { t } = useTranslation('admin');

    // A failed revalidation on top of a settled read is no reason to hide an assistant members are
    // already talking to: keep the last known state, say it may be behind, and offer the retry.
    // Only a read that never settled has nothing to show, and that alone is terminal.
    const stale = Boolean(error) && snapshot !== undefined;

    const body = (): ReactNode => {
      if (snapshot === undefined) {
        if (error) return <Text type={'danger'}>{copy.loadError}</Text>;
        return <Text type={'secondary'}>{copy.loading}</Text>;
      }

      if (!snapshot) {
        if (!canProvision) return <Text type={'secondary'}>{copy.provisionReadOnly}</Text>;
        if (provisionFailed) {
          return (
            <Flexbox align={'flex-start'} gap={12}>
              <Text type={'danger'}>{copy.provisionError}</Text>
              <Button loading={provisioning} onClick={onProvision}>
                {t('agentCatalog.dependency.retry')}
              </Button>
            </Flexbox>
          );
        }
        // Provisioning is automatic for both system assistants. The explicit button exists only
        // where a missing assistant still leaves a working built-in behind it, so the admin has
        // something to press instead of waiting on a repair they cannot see.
        if (provisionAction && onProvision) {
          return (
            <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
              <Flexbox align={'flex-start'} gap={4}>
                {showStatus && unmanagedLabel ? <Tag size={'small'}>{unmanagedLabel}</Tag> : null}
                <Text type={'secondary'}>{copy.description}</Text>
              </Flexbox>
              <Button loading={provisioning} type={'primary'} onClick={onProvision}>
                {provisionAction}
              </Button>
            </Flexbox>
          );
        }
        return <Text type={'secondary'}>{copy.preparing}</Text>;
      }

      const { item } = snapshot;

      // One compact row: who the assistant is on the left, the single action on the right.
      return (
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={12} style={{ flex: 1, minWidth: 0 }}>
            <Avatar avatar={avatar} background={background} shape={'square'} size={44} />
            <div className={styles.identity}>
              <Text ellipsis weight={600}>
                {item.displayName}
              </Text>
              <Text ellipsis type={'secondary'}>
                {copy.description}
              </Text>
            </div>
            {showStatus ? <StatusBadge status={item.identity.status} /> : null}
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
        {/* The heading names the card; what the assistant *is* reads as its own second line,
            right under its name, instead of a caption up here. */}
        <Text weight={600}>{title}</Text>
        {stale ? (
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Text type={'warning'}>{copy.loadError}</Text>
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

SystemAgentCard.displayName = 'SystemAgentCard';
