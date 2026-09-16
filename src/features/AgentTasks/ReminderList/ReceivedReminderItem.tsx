'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Popconfirm } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_REMINDER_TIMEZONE, formatReminderTime } from './formatters';
import type { ReceivedReminderView } from './types';

interface ReceivedReminderItemProps {
  delivery: ReceivedReminderView;
  onDelete: (deliveryId: string) => Promise<void> | void;
}

/**
 * One row of 我收到的: the content that was pushed, when it was sent and who set
 * it. 「删除」 only hides the row for the current recipient.
 */
const ReceivedReminderItem = memo<ReceivedReminderItemProps>(({ delivery, onDelete }) => {
  const { t } = useTranslation('chat');
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await onDelete(delivery.id);
    } finally {
      setDeleting(false);
    }
  }, [delivery.id, onDelete]);

  const firedAt = formatReminderTime(delivery.firedAt, DEFAULT_REMINDER_TIMEZONE);

  return (
    <Block gap={8} padding={12} variant={'outlined'}>
      <Flexbox horizontal align={'flex-start'} gap={8} justify={'space-between'}>
        <Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{delivery.content}</Text>
        <Popconfirm
          arrow={false}
          cancelText={t('reminderList.confirm.dismiss')}
          okButtonProps={{ danger: true, loading: deleting }}
          okText={t('reminderList.action.delete')}
          placement={'topRight'}
          title={t('reminderList.confirm.delete')}
          onConfirm={handleConfirm}
        >
          <Button loading={deleting} size={'small'} style={{ flexShrink: 0 }} type={'text'}>
            {t('reminderList.action.delete')}
          </Button>
        </Popconfirm>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
        <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
          {`${t('reminderList.field.sentAt')} ${firedAt}`}
        </Text>
        <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
          {t('reminderList.field.from', { name: delivery.creatorName })}
        </Text>
      </Flexbox>
    </Block>
  );
});

ReceivedReminderItem.displayName = 'ReceivedReminderItem';

export default ReceivedReminderItem;
