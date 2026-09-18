'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, SkeletonText, Text } from '@lobehub/ui/base-ui';
import { useReducedMotion } from 'motion/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AuditChatMessageList from '../shared/AuditChatMessageList';
import AuditOlderMessagesRow from '../shared/AuditOlderMessagesRow';
import { useAuditStreamScroll } from '../shared/useAuditStreamScroll';
import { styles } from './topicPageStyles';
import type { TopicEvidence } from './useTopicEvidence';

export interface TopicMessageStreamProps {
  /** Speaker name for assistant turns (agent title / default assistant). */
  assistantName?: string;
  /** Policy is not content_allowed — never paint bodies, even ones cached from an earlier reveal. */
  bodyHidden?: boolean;
  feed: TopicEvidence['messages'];
}

/**
 * The topic transcript as a read-only chat inside a fixed-height, internally scrolling box —
 * oldest at the top, newest at the bottom, opened at the newest message. Scrolling near the top
 * loads the previous page and keeps the reading position; loading / failure / empty states and the
 * start-of-conversation marker sit inside the box, as in the live message pane.
 */
const TopicMessageStream = memo<TopicMessageStreamProps>(({ assistantName, bodyHidden, feed }) => {
  const { t } = useTranslation('admin');
  const reduceMotion = useReducedMotion();

  const { onScroll, scrollRef } = useAuditStreamScroll({
    itemCount: feed.items.length,
    loadingOlder: feed.loadingOlder,
    onNearTop: () => {
      if (feed.hasOlder && !feed.loadingOlder && !feed.olderError) feed.loadOlder();
    },
    resetKey: feed.resetKey,
  });

  return (
    <div className={styles.streamBox} ref={scrollRef} onScroll={onScroll}>
      <div className={styles.stream}>
        {feed.items.length ? (
          <AuditOlderMessagesRow
            endLabel={t('audit.conversations.topic.startOfConversation')}
            error={feed.olderError ? t('audit.live.errors.loadMoreMessages') : null}
            hasOlder={feed.hasOlder}
            loadingOlder={feed.loadingOlder}
            onLoadOlder={feed.loadOlder}
          />
        ) : null}
        {feed.isLoading && !feed.hasData ? (
          <div aria-label={t('primitives.dataTable.loading')} role="status">
            <SkeletonText animated={!reduceMotion} rows={5} />
          </div>
        ) : null}
        {feed.items.length ? (
          <AuditChatMessageList
            assistantName={assistantName}
            bodyHidden={bodyHidden}
            messages={feed.items}
            reduceMotion={reduceMotion}
          />
        ) : null}
        {feed.hasError && !feed.hasData ? (
          <Flexbox align="flex-start" gap={8}>
            <Text role="alert" type="danger">
              {t('audit.conversations.topic.loadError')}
            </Text>
            <Button size="small" type="default" onClick={feed.retry}>
              {t('primitives.dataTable.retry')}
            </Button>
          </Flexbox>
        ) : null}
        {!feed.items.length && !feed.isLoading && !feed.hasError ? (
          <Text type="secondary">{t('audit.conversations.topic.emptyMessages')}</Text>
        ) : null}
      </div>
    </div>
  );
});

TopicMessageStream.displayName = 'AuditTopicMessageStream';

export default TopicMessageStream;
