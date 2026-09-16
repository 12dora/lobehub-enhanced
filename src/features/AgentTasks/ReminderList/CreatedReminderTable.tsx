'use client';

import { Flexbox, toast, Tooltip } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import type { TableColumnsType } from 'antd';
import { Popconfirm, Table, Typography } from 'antd';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useClientDataSWR } from '@/libs/swr';
import { reminderService } from '@/services/reminder';

import { useNavigateToTaskDetail } from '../shared/taskDetailPath';
import { formatReminderShortTime } from './formatters';
import ReminderRecipients from './ReminderRecipients';
import ReminderStatusTag from './ReminderStatusTag';
import {
  EMPTY_CELL,
  REMINDER_PAGE_SIZE,
  ReminderTableError,
  ReminderTableSkeleton,
} from './ReminderTableStates';
import { createdRemindersKey, mutateReminderLists, REMINDER_LIST_LIMIT } from './swrKeys';
import type { CreatedReminderRow } from './types';

interface CreatedReminderTableProps {
  /** Also list completed/canceled reminder tasks. */
  includeFinished: boolean;
}

/**
 * 我发起的: the reminder tasks the user created, with their schedule, next/last
 * delivery and the two actions that do not need the task detail page (立即发送 /
 * 取消). Editing a reminder happens on `/task/<identifier>`.
 */
const CreatedReminderTable = memo<CreatedReminderTableProps>(({ includeFinished }) => {
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();
  const navigateToTask = useNavigateToTaskDetail();
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useClientDataSWR<CreatedReminderRow[]>(
    createdRemindersKey(includeFinished),
    () =>
      // The router caps `limit` at 200; asking for the maximum keeps the
      // client-side pagination honest instead of paging a silent 50-row slice.
      reminderService.listCreated({
        includeFinished,
        limit: REMINDER_LIST_LIMIT,
      }) as unknown as Promise<CreatedReminderRow[]>,
  );

  const handleOpen = useCallback(
    (row: CreatedReminderRow) => navigateToTask(row.taskIdentifier),
    [navigateToTask],
  );

  const handleCancel = useCallback(
    async (row: CreatedReminderRow) => {
      setPendingTaskId(row.taskId);
      try {
        await reminderService.cancel(row.taskId);
        toast.success(t('reminderList.toast.canceled'));
        await mutateReminderLists();
      } catch {
        toast.error(t('reminderList.toast.cancelFailed'));
      } finally {
        setPendingTaskId(null);
      }
    },
    [t],
  );

  const handleFireNow = useCallback(
    async (row: CreatedReminderRow) => {
      setPendingTaskId(row.taskId);
      try {
        const result = await reminderService.fireNow(row.taskId);
        toast.success(
          t('reminderList.toast.fired', {
            failed: result?.failed ?? 0,
            sent: result?.sent ?? 0,
            skipped: result?.skipped ?? 0,
          }),
        );
        await mutateReminderLists();
      } catch {
        toast.error(t('reminderList.toast.fireFailed'));
      } finally {
        setPendingTaskId(null);
      }
    },
    [t],
  );

  const columns: TableColumnsType<CreatedReminderRow> = useMemo(
    () => [
      {
        dataIndex: 'content',
        ellipsis: true,
        key: 'content',
        render: (content: string, row) => (
          <Tooltip title={content}>
            <Typography.Link ellipsis onClick={() => handleOpen(row)}>
              {content}
            </Typography.Link>
          </Tooltip>
        ),
        title: t('reminderList.column.content'),
        width: 240,
      },
      {
        dataIndex: 'recipients',
        key: 'recipients',
        render: (_: unknown, row) => <ReminderRecipients recipients={row.recipients} />,
        title: t('reminderList.column.recipients'),
        width: 220,
      },
      {
        dataIndex: 'scheduleSummary',
        key: 'scheduleSummary',
        render: (value: string) => value || EMPTY_CELL,
        title: t('reminderList.column.schedule'),
        width: 160,
      },
      {
        dataIndex: 'nextFireAt',
        key: 'nextFireAt',
        render: (value: CreatedReminderRow['nextFireAt']) =>
          formatReminderShortTime(value) || EMPTY_CELL,
        title: t('reminderList.column.nextFire'),
        width: 120,
      },
      {
        dataIndex: 'lastFiredAt',
        key: 'lastFiredAt',
        render: (_: unknown, row) => {
          const firedAt = formatReminderShortTime(row.lastFiredAt);
          if (!firedAt) return EMPTY_CELL;

          const delivery = row.lastDelivery;

          return (
            <Flexbox gap={2}>
              <Text fontSize={13}>{firedAt}</Text>
              {delivery && (
                <Text fontSize={12} type={'secondary'}>
                  {t('reminderList.delivery.counts', {
                    failed: delivery.failed,
                    sent: delivery.sent,
                    skipped: delivery.skipped,
                  })}
                </Text>
              )}
            </Flexbox>
          );
        },
        title: t('reminderList.column.lastFire'),
        width: 160,
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (status: CreatedReminderRow['status']) => <ReminderStatusTag status={status} />,
        title: t('reminderList.column.status'),
        width: 100,
      },
      {
        fixed: isMobile ? undefined : ('right' as const),
        key: 'actions',
        render: (_: unknown, row) => {
          const isScheduled = row.status === 'scheduled';
          const isPending = pendingTaskId === row.taskId;

          return (
            <Flexbox horizontal align={'center'} gap={4}>
              <Button size={'small'} type={'text'} onClick={() => handleOpen(row)}>
                {t('reminderList.action.open')}
              </Button>
              {isScheduled && (
                <Popconfirm
                  cancelText={t('reminderList.confirm.dismiss')}
                  okText={t('reminderList.action.fireNow')}
                  title={t('reminderList.confirm.fireNow')}
                  onConfirm={() => handleFireNow(row)}
                >
                  <Button disabled={isPending} size={'small'} type={'text'}>
                    {t('reminderList.action.fireNow')}
                  </Button>
                </Popconfirm>
              )}
              {isScheduled && (
                <Popconfirm
                  cancelText={t('reminderList.confirm.dismiss')}
                  okText={t('reminderList.action.cancel')}
                  title={t('reminderList.confirm.cancel')}
                  onConfirm={() => handleCancel(row)}
                >
                  <Button danger disabled={isPending} size={'small'} type={'text'}>
                    {t('reminderList.action.cancel')}
                  </Button>
                </Popconfirm>
              )}
            </Flexbox>
          );
        },
        title: t('reminderList.column.actions'),
        width: 200,
      },
    ],
    [handleCancel, handleFireNow, handleOpen, isMobile, pendingTaskId, t],
  );

  if (error) return <ReminderTableError onRetry={() => mutate()} />;
  if (isLoading && !data) return <ReminderTableSkeleton />;

  return (
    <Table<CreatedReminderRow>
      columns={columns}
      dataSource={data ?? []}
      locale={{ emptyText: t('reminderList.empty.created') }}
      rowKey={'taskId'}
      scroll={{ x: 1200 }}
      size={'small'}
      pagination={{
        hideOnSinglePage: true,
        pageSize: REMINDER_PAGE_SIZE,
        size: 'small',
      }}
    />
  );
});

CreatedReminderTable.displayName = 'CreatedReminderTable';

export default CreatedReminderTable;
