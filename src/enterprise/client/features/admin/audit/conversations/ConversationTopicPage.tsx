'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';

import AdminPageTemplate from '../../primitives/AdminPageTemplate';
import { formatAdminDateTime, hasPermission } from '../shared/format';
import { useTopicModelLine } from '../shared/topicModelLine';
import ContentAccessDisabledState from './ContentAccessDisabledState';
import TopicAccessBanner from './TopicAccessBanner';
import TopicBodyToggle from './TopicBodyToggle';
import TopicMessagePager from './TopicMessagePager';
import TopicMessageStream from './TopicMessageStream';
import { styles } from './topicPageStyles';
import { useTopicEvidence } from './useTopicEvidence';

const ConversationTopicPage = memo(() => {
  const { t } = useTranslation('admin');
  const { assistantName, formatModelLine } = useTopicModelLine();
  const navigate = useNavigate();
  const { userId = '', topicId = '' } = useParams<{ userId: string; topicId: string }>();
  const { permissions } = useAdminAccess();
  const canConversationRead = hasPermission(
    permissions,
    PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ,
  );
  // policy.get requires AUDIT_READ — optional; conversation evidence may still be available.
  const canAuditRead = hasPermission(permissions, PLATFORM_PERMISSIONS.AUDIT_READ);

  const {
    bodyHidden,
    contentAccessMode,
    detail,
    includeBody,
    isForbidden,
    messages,
    onToggleBody,
    pager,
  } = useTopicEvidence({ canAuditRead, canConversationRead, t, topicId, userId });

  if (isForbidden || contentAccessMode === 'disabled') {
    return <ContentAccessDisabledState />;
  }

  const topic = detail.topic;
  // Loaded topic without a title → "(untitled)"; nothing renderable yet → generic page name.
  const pageTitle = topic
    ? topic.title || t('audit.conversations.untitled')
    : t('audit.conversations.topic.title');

  return (
    <AdminPageTemplate
      banner={<TopicAccessBanner contentAccessMode={contentAccessMode} />}
      description={t('audit.conversations.topic.desc')}
      title={pageTitle}
      actions={
        <Flexbox horizontal align="center" gap={12}>
          <TopicBodyToggle
            contentAccessMode={contentAccessMode}
            includeBody={includeBody}
            onToggleBody={onToggleBody}
          />
          <Button
            type="default"
            onClick={() =>
              navigate(
                `/admin/audit/live?userId=${encodeURIComponent(userId)}&topicId=${encodeURIComponent(topicId)}`,
              )
            }
          >
            {t('audit.conversations.topic.openLive')}
          </Button>
          <Button type="default" onClick={() => navigate(`/admin/audit/conversations/${userId}`)}>
            {t('audit.conversations.topic.back')}
          </Button>
        </Flexbox>
      }
    >
      {detail.failed ? (
        <Alert
          showIcon
          style={{ marginBlockEnd: 12 }}
          title={t('audit.conversations.topic.detailUnavailable')}
          type="warning"
          action={
            <Button size="small" onClick={detail.retry}>
              {t('audit.shared.retryMissingSections')}
            </Button>
          }
        />
      ) : null}
      {topic ? (
        <div className={styles.metaRow}>
          <span>{formatModelLine(topic)}</span>
          <span aria-hidden className={styles.metaSeparator}>
            ·
          </span>
          <span>
            {t('audit.conversations.columns.updatedAt')}: {formatAdminDateTime(topic.updatedAt)}
          </span>
        </div>
      ) : null}

      <TopicMessageStream
        assistantName={assistantName(topic)}
        bodyHidden={bodyHidden}
        feed={messages}
      />

      <TopicMessagePager pager={pager} />
    </AdminPageTemplate>
  );
});

ConversationTopicPage.displayName = 'AuditConversationTopicPage';

export default ConversationTopicPage;
