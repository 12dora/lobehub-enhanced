'use client';

import { Button, SkeletonText, Text } from '@lobehub/ui/base-ui';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AdminAuditConversationDetail,
  AdminAuditConversationMessage,
} from '@/enterprise/client/services/adminAudit';

import AuditChatMessageList from '../shared/AuditChatMessageList';
import { sortMessagesChronological } from '../shared/liveMessageUtils';
import { useTopicModelLine } from '../shared/topicModelLine';
import MessagePaneHeader from './MessagePaneHeader';
import { styles } from './messagePaneStyles';
import { useLiveStreamScroll } from './useLiveStreamScroll';
import { useMessageEntrance } from './useMessageEntrance';

export interface MessagePaneProps {
  bodyHidden: boolean;
  hasOlder: boolean;
  loading?: boolean;
  loadingOlder?: boolean;
  messages: AdminAuditConversationMessage[];
  onLoadOlder: () => void;
  topic?: AdminAuditConversationDetail | null;
  userId: string;
}

const MessagePane = memo<MessagePaneProps>(
  ({ topic, userId, messages, bodyHidden, hasOlder, onLoadOlder, loading, loadingOlder }) => {
    const { t } = useTranslation('admin');
    const reduceMotion = useReducedMotion();
    const { assistantName } = useTopicModelLine();

    const ordered = useMemo(() => sortMessagesChronological(messages), [messages]);

    const enterIds = useMessageEntrance({
      loadingOlder,
      ordered,
      reduceMotion,
      topicId: topic?.id,
    });

    const { onScroll, scrollRef, scrollToBottom, showJump } = useLiveStreamScroll({
      itemCount: ordered.length,
      loadingOlder,
      topicId: topic?.id,
    });

    if (!topic) {
      return (
        <div className={styles.empty}>
          <Text type="secondary">{t('audit.live.messages.pickTopic')}</Text>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <MessagePaneHeader topic={topic} userId={userId} />

        <div className={styles.streamViewport}>
          <div className={styles.stream} ref={scrollRef} onScroll={onScroll}>
            {hasOlder ? (
              <div className={styles.older}>
                <Button loading={loadingOlder} size="small" type="default" onClick={onLoadOlder}>
                  {t('audit.live.messages.loadOlder')}
                </Button>
              </div>
            ) : null}
            {loading && !ordered.length ? (
              <div aria-label={t('primitives.dataTable.loading')} role="status">
                <SkeletonText animated={!reduceMotion} rows={4} />
              </div>
            ) : null}
            <AuditChatMessageList
              assistantName={assistantName(topic)}
              bodyHidden={bodyHidden}
              enterIds={enterIds}
              messages={ordered}
              reduceMotion={reduceMotion}
            />
            {!ordered.length && !loading ? (
              <Text type="secondary">{t('audit.live.messages.empty')}</Text>
            ) : null}
          </div>
          {/* Overlay sibling of the scroller: pinned to the box, never in the scrolling flow. */}
          <AnimatePresence initial={false}>
            {showJump ? (
              <m.div
                animate={{ opacity: 1, y: 0 }}
                className={styles.jump}
                exit={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                key="jump"
                transition={{ duration: reduceMotion ? 0 : 0.14 }}
              >
                <Button size="small" type="primary" onClick={scrollToBottom}>
                  {t('audit.live.messages.jumpNew')}
                </Button>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    );
  },
);

MessagePane.displayName = 'AuditLiveMessagePane';

export default MessagePane;
