'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/** Placeholder for the first load of a reminder table. */
export const ReminderTableSkeleton = memo(() => (
  <Flexbox gap={8} paddingBlock={8}>
    <Skeleton height={36} radius={8} />
    <Skeleton height={36} radius={8} />
    <Skeleton height={36} radius={8} />
  </Flexbox>
));

ReminderTableSkeleton.displayName = 'ReminderTableSkeleton';

interface ReminderTableErrorProps {
  onRetry: () => void;
}

/** Load failure of a reminder table, with a retry that re-runs the SWR fetcher. */
export const ReminderTableError = memo<ReminderTableErrorProps>(({ onRetry }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox horizontal align={'center'} gap={8} paddingBlock={8}>
      <Text fontSize={13} style={{ color: cssVar.colorTextTertiary }}>
        {t('reminderList.loadFailed')}
      </Text>
      <Button size={'small'} onClick={onRetry}>
        {t('reminderList.retry')}
      </Button>
    </Flexbox>
  );
});

ReminderTableError.displayName = 'ReminderTableError';

/** Dash shown where a reminder row has no time yet. */
export const EMPTY_CELL = '-';

/** Client-side page size of both reminder tables. */
export const REMINDER_PAGE_SIZE = 20;
