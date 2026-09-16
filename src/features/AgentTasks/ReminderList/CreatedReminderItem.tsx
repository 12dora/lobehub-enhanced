'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Popconfirm } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_REMINDER_TIMEZONE, formatReminderTime, formatRepeatSummary } from './formatters';
import ReminderRecipients from './ReminderRecipients';
import ReminderStatusTag from './ReminderStatusTag';
import type { CreatedReminderView } from './types';

interface CreatedReminderItemProps {
  onCancel: (id: string) => Promise<void> | void;
  reminder: CreatedReminderView;
}

/**
 * One row of 我发起的: status, next fire time, repeat summary, recipients and
 * the creator. Only a still-scheduled reminder can be canceled.
 */
const CreatedReminderItem = memo<CreatedReminderItemProps>(({ onCancel, reminder }) => {
  const { t } = useTranslation('chat');
  const [canceling, setCanceling] = useState(false);

  const repeatSummary = useMemo(
    () => formatRepeatSummary(reminder.repeatRule, t),
    [reminder.repeatRule, t],
  );
  const isScheduled = reminder.status === 'scheduled';
  const sentLike =
    reminder.status === 'sent' || reminder.status === 'failed' || reminder.status === 'expired';
  const timeValue = isScheduled
    ? reminder.fireAt
    : (reminder.lastFiredAt ?? (sentLike ? reminder.fireAt : null));
  const fireAt = formatReminderTime(timeValue, reminder.timezone || DEFAULT_REMINDER_TIMEZONE);
  const showFireAt = Boolean(timeValue);
  const fireAtLabel = isScheduled
    ? t('reminderList.field.nextFire')
    : t('reminderList.field.sentAt');

  const handleConfirm = useCallback(async () => {
    setCanceling(true);
    try {
      await onCancel(reminder.id);
    } finally {
      setCanceling(false);
    }
  }, [onCancel, reminder.id]);

  return (
    <Block gap={8} padding={12} variant={'outlined'}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
          <ReminderStatusTag status={reminder.status} />
          {showFireAt && <Text fontSize={13}>{`${fireAtLabel} ${fireAt}`}</Text>}
          {repeatSummary && (
            <Text fontSize={12} type={'secondary'}>
              {`${t('reminderList.field.repeat')} ${repeatSummary}`}
            </Text>
          )}
        </Flexbox>
        {reminder.status === 'scheduled' && (
          <Popconfirm
            arrow={false}
            cancelText={t('reminderList.confirm.dismiss')}
            okButtonProps={{ danger: true, loading: canceling }}
            okText={t('reminderList.action.cancel')}
            placement={'topRight'}
            title={t('reminderList.confirm.cancel')}
            onConfirm={handleConfirm}
          >
            <Button loading={canceling} size={'small'} type={'text'}>
              {t('reminderList.action.cancel')}
            </Button>
          </Popconfirm>
        )}
      </Flexbox>
      <Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{reminder.content}</Text>
      {!!reminder.recipients?.length && (
        <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
          <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
            {t('reminderList.field.recipients')}
          </Text>
          <ReminderRecipients recipients={reminder.recipients} />
        </Flexbox>
      )}
      <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
        {`${t('reminderList.field.creator')} ${reminder.creatorName}`}
      </Text>
    </Block>
  );
});

CreatedReminderItem.displayName = 'CreatedReminderItem';

export default CreatedReminderItem;
