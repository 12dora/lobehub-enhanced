'use client';

import { Tag } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreatedReminderStatus } from './types';

const STATUS_META = {
  canceled: { color: undefined, labelKey: 'reminderList.status.canceled' },
  completed: { color: 'success', labelKey: 'reminderList.status.completed' },
  scheduled: { color: 'info', labelKey: 'reminderList.status.inProgress' },
} as const satisfies Record<CreatedReminderStatus, { color?: string; labelKey: string }>;

interface ReminderStatusTagProps {
  status: CreatedReminderStatus;
}

/** 进行中 / 已完成 / 已取消 chip of a reminder task. */
const ReminderStatusTag = memo<ReminderStatusTagProps>(({ status }) => {
  const { t } = useTranslation('chat');
  const meta = STATUS_META[status] ?? STATUS_META.scheduled;

  return (
    <Tag color={meta.color} size={'small'} style={{ flexShrink: 0 }}>
      {t(meta.labelKey as 'reminderList.status.canceled')}
    </Tag>
  );
});

ReminderStatusTag.displayName = 'ReminderStatusTag';

export default ReminderStatusTag;
