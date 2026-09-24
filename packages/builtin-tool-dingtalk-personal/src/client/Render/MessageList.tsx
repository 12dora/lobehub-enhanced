'use client';

import { Icon } from '@lobehub/ui';
import { MessagesSquare, Paperclip } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MessageFile, MessageItem, MessagesState } from '../../types';
import { MESSAGE_TEXT_LIMIT, MESSAGE_VISIBLE_ROW_LIMIT } from '../components/constants';
import { ExpandableList, ResultCard, ResultNote } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { asRows, asText, formatDateTime, formatTimeRange } from './format';

const clip = (text: string) =>
  text.length > MESSAGE_TEXT_LIMIT ? `${text.slice(0, MESSAGE_TEXT_LIMIT)}…` : text;

/**
 * `listGroupMessages` / `searchMessages` result: sender, time and text of each
 * message, with the files it carried as chips (the model downloads them via
 * `downloadMessageFile`).
 */
const MessageList = memo<{ state: MessagesState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const messages = asRows<MessageItem>(state.messages);
  const count =
    typeof state.count === 'number' ? Math.max(state.count, messages.length) : messages.length;
  const range = formatTimeRange(state.startTime, state.endTime);

  const meta = [
    count > 0 ? t('builtins.lobe-dingtalk-personal.render.message.count', { count }) : undefined,
    range,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ResultCard icon={MessagesSquare} meta={meta || undefined} title={title}>
      {messages.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.message.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={messages}
          limit={MESSAGE_VISIBLE_ROW_LIMIT}
          renderItem={(message, index) => {
            const text = asText(message.text);
            const time = formatDateTime(message.createTime);
            const files = asRows<MessageFile>(message.files);

            return (
              <div className={cardStyles.message} key={message.messageId ?? String(index)}>
                <div className={cardStyles.messageHead}>
                  <span className={cardStyles.messageSender}>
                    {asText(message.sender) ??
                      t('builtins.lobe-dingtalk-personal.render.message.unknownSender')}
                  </span>
                  {time && <span className={cardStyles.muted}>{time}</span>}
                </div>
                {text && <div className={cardStyles.messageText}>{clip(text)}</div>}
                {files.length > 0 && (
                  <div className={cardStyles.fileChips}>
                    {files.map((file, fileIndex) => (
                      <span
                        className={cardStyles.fileChip}
                        key={`${file.resourceId ?? ''}-${fileIndex}`}
                      >
                        <Icon icon={Paperclip} size={12} />
                        <span>
                          {asText(file.name) ??
                            t('builtins.lobe-dingtalk-personal.render.unnamed.file')}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        />
      )}
      {(state.hasMore === true || state.truncated === true) && (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.message.more')}</ResultNote>
      )}
    </ResultCard>
  );
});

MessageList.displayName = 'DingtalkPersonalMessageList';

export default MessageList;
