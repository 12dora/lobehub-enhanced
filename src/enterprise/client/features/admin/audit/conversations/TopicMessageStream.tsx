'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, SkeletonText, Text } from '@lobehub/ui/base-ui';
import { useReducedMotion } from 'motion/react';
import { memo, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuditChatMessageList from '../shared/AuditChatMessageList';
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
 * One page of conversation evidence as a read-only chat transcript inside a fixed-height,
 * internally scrolling box, with its own loading / failure / empty states.
 */
const TopicMessageStream = memo<TopicMessageStreamProps>(({ assistantName, bodyHidden, feed }) => {
  const { t } = useTranslation('admin');
  const reduceMotion = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const firstId = feed.items[0]?.id;

  // A new page (pager, body reveal) starts reading from its top, not the old scroll offset.
  useLayoutEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = 0;
  }, [firstId]);

  return (
    <div className={styles.streamBox} ref={boxRef}>
      <div className={styles.stream}>
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
