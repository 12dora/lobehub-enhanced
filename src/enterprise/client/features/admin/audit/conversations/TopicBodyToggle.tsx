'use client';

import { Switch } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AuditContentAccessMode } from '../shared/liveMessageUtils';
import { styles } from './topicPageStyles';

export interface TopicBodyToggleProps {
  contentAccessMode: AuditContentAccessMode | undefined;
  includeBody: boolean;
  onToggleBody: (checked: boolean) => void;
}

/** Explicit, audited body reveal. Only offered when policy allows content at all. */
const TopicBodyToggle = memo<TopicBodyToggleProps>(
  ({ contentAccessMode, includeBody, onToggleBody }) => {
    const { t } = useTranslation('admin');

    if (contentAccessMode !== 'content_allowed') return null;

    const label = t('audit.conversations.topic.bodyToggleLabel');

    return (
      <label className={styles.bodyToggle}>
        <span>{label}</span>
        <Switch
          aria-label={label}
          checked={includeBody}
          onChange={(checked) => onToggleBody(Boolean(checked))}
        />
      </label>
    );
  },
);

TopicBodyToggle.displayName = 'AuditTopicBodyToggle';

export default TopicBodyToggle;
