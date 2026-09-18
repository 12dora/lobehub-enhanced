'use client';

import { Tag, Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR, DEFAULT_USER_AVATAR } from '@/const/meta';
import type { AdminAuditConversationMessage } from '@/enterprise/client/services/adminAudit';
import Avatar from '@/features/Conversation/ChatItem/components/Avatar';
import { getModelDisplayName } from '@/utils/modelLabels';

import { styles } from './auditChatStyles';
import {
  auditChatPlacement,
  describeAuditMessageError,
  hasAuditMessageError,
} from './auditChatUtils';
import AuditMarkdown, { RedactionChip } from './AuditMarkdown';
import { formatAdminDateTime } from './format';
import { linkifyText } from './linkifyText';
import { MessageAttachments } from './MessageAttachments';

/** System / tool payloads are often JSON or prompts — shown verbatim, never as markdown. */
const renderPlain = (content: string): ReactNode =>
  content
    .split(/(\[REDACTED[^\]]*\])/g)
    .map((part, i) =>
      part.startsWith('[REDACTED') ? (
        <RedactionChip key={i}>{part}</RedactionChip>
      ) : (
        <span key={i}>{linkifyText(part)}</span>
      ),
    );

const toIsoOrUndefined = (value: Date | string | number): string | undefined => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export interface AuditChatMessageProps {
  /** Display name for assistant turns (agent title / default assistant); falls back to the role label. */
  assistantName?: string;
  /** Policy hides bodies (metadata_only) — show the placeholder, never content or attachments. */
  bodyHidden?: boolean;
  message: AdminAuditConversationMessage;
  /** Display name for user turns; falls back to the role label. */
  userName?: string;
}

/**
 * One read-only chat turn rendered the way the end-user chat shows it: avatar + name + time
 * header, user text in a right-aligned bubble, assistant markdown flowing left, system / tool
 * turns centered, subdued and collapsed. No actions — audit evidence is never mutated here.
 */
const AuditChatMessage = memo<AuditChatMessageProps>(
  ({ assistantName, bodyHidden, message, userName }) => {
    const { t } = useTranslation('admin');
    const reduceMotion = useReducedMotion();
    const placement = auditChatPlacement(message.role);
    const [collapsed, setCollapsed] = useState(placement === 'center');

    const roleLabel = t(`audit.live.message.role.${message.role}` as never, {
      defaultValue: message.role,
    }) as string;
    const hasText = message.content != null && message.content !== '';
    // A body that exists but was not requested must not leak its files either.
    const attachmentsHidden =
      bodyHidden || (Boolean(message.hasContent) && message.content == null);
    const errorDetail = describeAuditMessageError(message.error);

    const content = bodyHidden ? (
      <Text type="secondary">{t('audit.live.message.bodyHidden')}</Text>
    ) : hasText ? (
      placement === 'center' ? (
        <div className={styles.plain}>{renderPlain(message.content!)}</div>
      ) : (
        <AuditMarkdown content={message.content!} />
      )
    ) : message.hasContent ? (
      <Text type="secondary">{t('audit.conversations.topic.bodyNotLoaded')}</Text>
    ) : (
      <Text type="secondary">—</Text>
    );

    const body = (
      <>
        {content}
        <MessageAttachments attachments={attachmentsHidden ? [] : message.attachments} />
        {hasAuditMessageError(message.error) ? (
          <div className={styles.error} role="note">
            {t('audit.chat.messageError')}
            {errorDetail ? ` · ${errorDetail}` : null}
          </div>
        ) : null}
      </>
    );

    const time = (
      <time className={styles.time} dateTime={toIsoOrUndefined(message.createdAt)}>
        {formatAdminDateTime(message.createdAt)}
      </time>
    );

    if (placement === 'center') {
      const open = !collapsed;
      return (
        <div
          className={cx(styles.item, styles.itemCenter)}
          data-message-id={message.id}
          data-placement={placement}
        >
          <div className={styles.system}>
            <div className={styles.systemHeader}>
              <span>
                <Tag size="small">{roleLabel}</Tag> {time}
              </span>
              <button
                aria-expanded={open}
                className={styles.toggle}
                type="button"
                onClick={() => setCollapsed((c) => !c)}
              >
                {collapsed ? t('audit.live.message.expand') : t('audit.live.message.collapse')}
              </button>
            </div>
            {reduceMotion ? (
              open ? (
                <div className={styles.body}>{body}</div>
              ) : null
            ) : (
              <AnimatePresence initial={false}>
                {open ? (
                  <m.div
                    animate={{ height: 'auto', opacity: 1 }}
                    className={styles.body}
                    exit={{ height: 0, opacity: 0 }}
                    initial={{ height: 0, opacity: 0 }}
                    key="body"
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  >
                    {body}
                  </m.div>
                ) : null}
              </AnimatePresence>
            )}
          </div>
        </div>
      );
    }

    const isUser = placement === 'right';
    const name = isUser ? userName || roleLabel : assistantName || roleLabel;
    const modelLabel = isUser ? '' : getModelDisplayName(message.model, message.provider);

    return (
      <div
        className={cx(styles.item, isUser ? styles.itemRight : styles.itemLeft)}
        data-message-id={message.id}
        data-placement={placement}
      >
        <div className={cx(styles.header, isUser && styles.headerReverse)}>
          <Avatar
            alt={name}
            avatar={{ avatar: isUser ? DEFAULT_USER_AVATAR : DEFAULT_AVATAR, title: name }}
          />
          <span className={styles.name}>{name}</span>
          {modelLabel ? <Tag size="small">{modelLabel}</Tag> : null}
          {time}
        </div>
        <div className={cx(styles.body, isUser ? styles.bubble : styles.bodyAssistant)}>{body}</div>
      </div>
    );
  },
);

AuditChatMessage.displayName = 'AuditChatMessage';

export default AuditChatMessage;
