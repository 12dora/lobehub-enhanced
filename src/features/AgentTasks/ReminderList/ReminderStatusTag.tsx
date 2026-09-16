'use client';

import { Tag } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReminderStatus } from './types';

const STATUS_META = {
  canceled: { color: undefined, labelKey: 'reminderList.status.canceled' },
  expired: { color: undefined, labelKey: 'reminderList.status.expired' },
  failed: { color: 'error', labelKey: 'reminderList.status.failed' },
  scheduled: { color: 'info', labelKey: 'reminderList.status.scheduled' },
  sent: { color: 'success', labelKey: 'reminderList.status.sent' },
} as const satisfies Record<ReminderStatus, { color?: string; labelKey: string }>;

interface ReminderStatusTagProps {
  status: ReminderStatus;
}

/** 待发送 / 已发送 / 已取消 / 已过期 / 发送失败 chip. */
const ReminderStatusTag = memo<ReminderStatusTagProps>(({ status }) => {
  const { t } = useTranslation('chat');
  const meta = STATUS_META[status] ?? STATUS_META.scheduled;

  return (
    <Tag color={meta.color} size={'small'} style={{ flexShrink: 0 }}>
      {t(meta.labelKey as 'reminderList.status.scheduled')}
    </Tag>
  );
});

ReminderStatusTag.displayName = 'ReminderStatusTag';

export default ReminderStatusTag;
