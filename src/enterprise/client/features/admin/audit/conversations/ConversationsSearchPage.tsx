'use client';

import { Empty } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type { UserPublicRef } from '@/server/enterprise/contracts/adminUsers';

import AdminPageTemplate from '../../primitives/AdminPageTemplate';
import { displayUserLabel } from '../../primitives/userLabel';
import UserSearchSelect from '../../primitives/UserSearchSelect';
import { hasPermission } from '../shared/format';

const styles = createStaticStyles(({ css }) => ({
  hero: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;

    max-width: 560px;
    margin-block: 48px;
    margin-inline: auto;
    padding-block: 32px;
    padding-inline: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    text-align: center;

    background: ${cssVar.colorBgContainer};
  `,
  search: css`
    width: 100%;
  `,
}));

const ConversationsSearchPage = memo(() => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { permissions } = useAdminAccess();
  const canConversationRead = hasPermission(
    permissions,
    PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ,
  );
  const canAuditRead = hasPermission(permissions, PLATFORM_PERMISSIONS.AUDIT_READ);
  const [picked, setPicked] = useState<UserPublicRef | undefined>();

  const onSelect = useCallback(
    (nextId: string | undefined, user?: UserPublicRef) => {
      setPicked(user);
      if (nextId) navigate(`/admin/audit/conversations/${nextId}`);
    },
    [navigate],
  );

  if (!canConversationRead) {
    return (
      <AdminPageTemplate title={t('audit.conversations.page.title')}>
        <Empty description={t('audit.noPermission')} />
      </AdminPageTemplate>
    );
  }

  return (
    <AdminPageTemplate
      description={t('audit.conversations.page.desc')}
      title={t('audit.conversations.page.title')}
    >
      <div className={styles.hero}>
        <Text as="h2" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          {t('audit.conversations.search.heading')}
        </Text>
        <Text type="secondary">{t('audit.conversations.search.hint')}</Text>
        <div className={styles.search}>
          <UserSearchSelect
            enabled={canAuditRead}
            placeholder={t('audit.conversations.search.placeholder')}
            style={{ width: '100%' }}
            userId={picked?.id}
            valueLabel={picked ? displayUserLabel(picked) : undefined}
            onChange={onSelect}
          />
        </div>
        {picked ? <Text type="secondary">{displayUserLabel(picked)}</Text> : null}
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('audit.conversations.search.policyNote')}
        </Text>
      </div>
    </AdminPageTemplate>
  );
});

ConversationsSearchPage.displayName = 'AuditConversationsSearchPage';

export default ConversationsSearchPage;
