'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AuditContentAccessMode } from '../shared/liveMessageUtils';
import { styles } from './topicPageStyles';

export interface TopicAccessBannerProps {
  contentAccessMode: AuditContentAccessMode | undefined;
}

/**
 * States that this policy only lets the auditor see metadata. The body-reveal switch for
 * `content_allowed` lives in the page actions (TopicBodyToggle); every other mode renders nothing.
 */
const TopicAccessBanner = memo<TopicAccessBannerProps>(({ contentAccessMode }) => {
  const { t } = useTranslation('admin');

  if (contentAccessMode !== 'metadata_only') return null;

  return (
    <div className={styles.banner} role="status">
      {t('audit.conversations.topic.metadataOnlyBanner')}
    </div>
  );
});

TopicAccessBanner.displayName = 'AuditTopicAccessBanner';

export default TopicAccessBanner;
