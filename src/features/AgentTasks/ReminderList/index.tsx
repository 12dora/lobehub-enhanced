'use client';

import { Flexbox, toast } from '@lobehub/ui';
import { Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import WideScreenContainer from '@/features/WideScreenContainer';
import { useClientDataSWR } from '@/libs/swr';
import { reminderService } from '@/services/reminder';

import CreatedReminderItem from './CreatedReminderItem';
import ReceivedReminderItem from './ReceivedReminderItem';
import type { CreatedReminderView, ReceivedReminderView } from './types';

/**
 * Local SWR keys. The reminder lists are only mounted by this feature, so they
 * stay here instead of the shared registry (which other lanes own this batch).
 */
const CREATED_KEY = ['reminder:listCreated'];
const RECEIVED_KEY = ['reminder:listReceived'];

const SectionSkeleton = memo(() => (
  <Flexbox gap={8}>
    <Skeleton height={64} radius={8} />
    <Skeleton height={64} radius={8} />
  </Flexbox>
));

SectionSkeleton.displayName = 'SectionSkeleton';

interface SectionProps {
  children?: ReactNode;
  title: string;
}

const Section = memo<SectionProps>(({ children, title }) => (
  <Flexbox gap={8}>
    <Text fontSize={13} style={{ color: cssVar.colorTextSecondary }} weight={600}>
      {title}
    </Text>
    {children}
  </Flexbox>
));

Section.displayName = 'Section';

const EmptyHint = memo<{ text: string }>(({ text }) => (
  <Text fontSize={13} style={{ color: cssVar.colorTextTertiary, paddingBlock: 8 }}>
    {text}
  </Text>
));

EmptyHint.displayName = 'EmptyHint';

/**
 * 定时提醒 surface of the tasks page: reminders the user created (cancellable)
 * and reminders the user received (hideable). Same single-column layout on
 * desktop and mobile.
 */
const ReminderList = memo(() => {
  const { t } = useTranslation('chat');

  const {
    data: created,
    error: createdError,
    isLoading: createdLoading,
    mutate: refreshCreated,
  } = useClientDataSWR<CreatedReminderView[]>(
    CREATED_KEY,
    () => reminderService.listCreated() as Promise<CreatedReminderView[]>,
  );

  const {
    data: received,
    error: receivedError,
    isLoading: receivedLoading,
    mutate: refreshReceived,
  } = useClientDataSWR<ReceivedReminderView[]>(
    RECEIVED_KEY,
    () => reminderService.listReceived() as Promise<ReceivedReminderView[]>,
  );

  const handleCancel = useCallback(
    async (id: string) => {
      try {
        await reminderService.cancel(id);
        toast.success(t('reminderList.toast.canceled'));
        await refreshCreated();
      } catch {
        toast.error(t('reminderList.toast.cancelFailed'));
      }
    },
    [refreshCreated, t],
  );

  const handleDelete = useCallback(
    async (deliveryId: string) => {
      try {
        await reminderService.hideReceived(deliveryId);
        toast.success(t('reminderList.toast.deleted'));
        await refreshReceived();
      } catch {
        toast.error(t('reminderList.toast.deleteFailed'));
      }
    },
    [refreshReceived, t],
  );

  return (
    <WideScreenContainer gap={24} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
      <Section title={t('reminderList.section.created')}>
        {createdError ? (
          <Flexbox horizontal align={'center'} gap={8}>
            <EmptyHint text={t('reminderList.loadFailed')} />
            <Button size={'small'} onClick={() => refreshCreated()}>
              {t('reminderList.retry')}
            </Button>
          </Flexbox>
        ) : createdLoading && !created ? (
          <SectionSkeleton />
        ) : created && created.length > 0 ? (
          <Flexbox gap={8}>
            {created.map((reminder) => (
              <CreatedReminderItem key={reminder.id} reminder={reminder} onCancel={handleCancel} />
            ))}
          </Flexbox>
        ) : (
          <EmptyHint text={t('reminderList.empty.created')} />
        )}
      </Section>

      <Section title={t('reminderList.section.received')}>
        {receivedError ? (
          <Flexbox horizontal align={'center'} gap={8}>
            <EmptyHint text={t('reminderList.loadFailed')} />
            <Button size={'small'} onClick={() => refreshReceived()}>
              {t('reminderList.retry')}
            </Button>
          </Flexbox>
        ) : receivedLoading && !received ? (
          <SectionSkeleton />
        ) : received && received.length > 0 ? (
          <Flexbox gap={8}>
            {received.map((delivery) => (
              <ReceivedReminderItem delivery={delivery} key={delivery.id} onDelete={handleDelete} />
            ))}
          </Flexbox>
        ) : (
          <EmptyHint text={t('reminderList.empty.received')} />
        )}
      </Section>
    </WideScreenContainer>
  );
});

ReminderList.displayName = 'ReminderList';

export default ReminderList;
