'use client';

import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminAuditUserSummary } from '@/enterprise/client/services/adminAudit';

import { formatAdminDateTime } from '../shared/format';

const styles = createStaticStyles(({ css }) => ({
  /** Flex, not an auto-fit grid: the email cell gets a wider basis so it stays on one line. */
  summary: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;

    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  cell: css`
    flex: 1 1 110px;
    min-width: 0;
  `,
  emailCell: css`
    flex: 2 1 240px;
    min-width: 0;
  `,
  alert: css`
    flex: 1 1 100%;
  `,
}));

export interface UserSummaryCardProps {
  failed: boolean;
  onRetry: () => void;
  user: AdminAuditUserSummary | undefined;
}

/**
 * Identity and activity totals for the audited user. The fields stay on screen with em dashes
 * when the (optional, AUDIT_READ-gated) summary is unavailable, so the page never loses its shape.
 */
const UserSummaryCard = memo<UserSummaryCardProps>(({ failed, onRetry, user }) => {
  const { t } = useTranslation('admin');

  return (
    <div className={styles.summary}>
      {failed ? (
        <Alert
          showIcon
          className={styles.alert}
          title={t('audit.conversations.user.summaryUnavailable')}
          type="warning"
          action={
            <Button size="small" onClick={onRetry}>
              {t('audit.shared.retryMissingSections')}
            </Button>
          }
        />
      ) : null}
      <div className={styles.emailCell}>
        <Text type="secondary">{t('audit.conversations.user.email')}</Text>
        {user?.email ? (
          <Text ellipsis={{ tooltip: user.email, tooltipWhenOverflow: true }}>{user.email}</Text>
        ) : (
          <div>—</div>
        )}
      </div>
      <div className={styles.cell}>
        <Text type="secondary">{t('audit.conversations.user.username')}</Text>
        <div>{user?.username ?? '—'}</div>
      </div>
      <div className={styles.cell}>
        <Text type="secondary">{t('audit.conversations.user.topics')}</Text>
        <div>{user?.topicCount ?? '—'}</div>
      </div>
      <div className={styles.cell}>
        <Text type="secondary">{t('audit.conversations.user.messages')}</Text>
        <div>{user?.messageCount ?? '—'}</div>
      </div>
      <div className={styles.cell}>
        <Text type="secondary">{t('audit.conversations.user.lastActive')}</Text>
        <div>{formatAdminDateTime(user?.lastActiveAt)}</div>
      </div>
    </div>
  );
});

UserSummaryCard.displayName = 'AuditUserSummaryCard';

export default UserSummaryCard;
