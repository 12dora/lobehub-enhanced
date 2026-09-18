'use client';

import { AnimatePresence, m } from 'motion/react';
import { memo } from 'react';

import type { AdminAuditConversationMessage } from '@/enterprise/client/services/adminAudit';

import AuditChatMessage from './AuditChatMessage';
import { styles } from './auditChatStyles';

export interface AuditChatMessageListProps {
  assistantName?: string;
  bodyHidden?: boolean;
  /**
   * Ids that play the one-time tail-append entrance (see live `useMessageEntrance`). Framer reads
   * `initial` only on mount, so this must be computed during render. Omit for static evidence.
   */
  enterIds?: ReadonlySet<string>;
  /** Rendered in the given order — callers own chronology. */
  messages: AdminAuditConversationMessage[];
  reduceMotion?: boolean | null;
  userName?: string;
}

/**
 * Read-only conversation transcript shared by Live View and Conversation history. It owns only
 * the turns; scrolling, paging, loading and empty states stay with each surface.
 */
const AuditChatMessageList = memo<AuditChatMessageListProps>(
  ({ assistantName, bodyHidden, enterIds, messages, reduceMotion, userName }) => (
    <div className={styles.list} role="list">
      <AnimatePresence initial={false}>
        {messages.map((message) => {
          const shouldEnter = Boolean(enterIds?.has(message.id));
          return (
            <m.div
              animate={{ opacity: 1, y: 0 }}
              initial={shouldEnter ? { opacity: 0, y: 6 } : false}
              key={message.id}
              role="listitem"
              transition={{ duration: reduceMotion || !shouldEnter ? 0 : 0.16 }}
            >
              <AuditChatMessage
                assistantName={assistantName}
                bodyHidden={bodyHidden}
                message={message}
                userName={userName}
              />
            </m.div>
          );
        })}
      </AnimatePresence>
    </div>
  ),
);

AuditChatMessageList.displayName = 'AuditChatMessageList';

export default AuditChatMessageList;
