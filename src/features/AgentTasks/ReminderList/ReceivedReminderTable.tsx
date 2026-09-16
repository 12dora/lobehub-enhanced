'use client';

import { Flexbox, toast, Tooltip } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import type { TableColumnsType } from 'antd';
import { Popconfirm, Table } from 'antd';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { reminderService } from '@/services/reminder';

import { formatReminderShortTime } from './formatters';
import {
  EMPTY_CELL,
  REMINDER_PAGE_SIZE,
  ReminderTableError,
  ReminderTableSkeleton,
} from './ReminderTableStates';
import { mutateReminderLists, receivedRemindersKey, REMINDER_LIST_LIMIT } from './swrKeys';
import type { ReceivedReminderRow, ReminderDeliveryStatus } from './types';

const STATUS_LABEL_KEY = {
  failed: 'reminderList.channel.status.failed',
  sent: 'reminderList.channel.status.sent',
  skipped: 'reminderList.channel.status.skipped',
} as const;

const STATUS_COLOR: Record<ReminderDeliveryStatus, string | undefined> = {
  failed: 'error',
  sent: 'success',
  skipped: undefined,
};

interface ChannelTagProps {
  /** 工作通知 / 机器人 */
  label: string;
  reason?: string | null;
  status?: ReminderDeliveryStatus | null;
}

/**
 * One delivery channel of a received reminder; the tooltip carries the failure
 * reason.
 *
 * A channel with NO status was not attempted for this delivery (and older rows
 * simply do not report the 服务号 robot at all) — render nothing rather than a
 * 未发送 tag, which would claim a send that never existed.
 */
const ChannelTag = memo<ChannelTagProps>(({ label, reason, status }) => {
  const { t } = useTranslation('chat');
  const separator = t('reminderList.recipients.separator');

  if (!status) return null;

  const statusLabel = t(STATUS_LABEL_KEY[status]);

  return (
    <Tooltip title={[label, statusLabel, reason || undefined].filter(Boolean).join(separator)}>
      <Tag color={STATUS_COLOR[status]} size={'small'}>
        {label}
      </Tag>
    </Tooltip>
  );
});

ChannelTag.displayName = 'ChannelTag';

/**
 * 我收到的: the reminder deliveries addressed to the current user, with the
 * per-channel outcome (DingTalk work notice + 服务号 robot). Deleting a row only
 * hides it for this user (`hideReceived`).
 */
const ReceivedReminderTable = memo(() => {
  const { t } = useTranslation('chat');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useClientDataSWR<ReceivedReminderRow[]>(
    receivedRemindersKey(),
    () =>
      // Router maximum — see `CreatedReminderTable`.
      reminderService.listReceived({ limit: REMINDER_LIST_LIMIT }) as unknown as Promise<
        ReceivedReminderRow[]
      >,
  );

  const handleDelete = useCallback(
    async (row: ReceivedReminderRow) => {
      setPendingId(row.id);
      try {
        await reminderService.hideReceived(row.id);
        toast.success(t('reminderList.toast.deleted'));
        await mutateReminderLists();
      } catch {
        toast.error(t('reminderList.toast.deleteFailed'));
      } finally {
        setPendingId(null);
      }
    },
    [t],
  );

  const columns: TableColumnsType<ReceivedReminderRow> = useMemo(
    () => [
      {
        dataIndex: 'firedAt',
        key: 'firedAt',
        render: (value: ReceivedReminderRow['firedAt']) =>
          formatReminderShortTime(value) || EMPTY_CELL,
        title: t('reminderList.column.time'),
        width: 120,
      },
      {
        dataIndex: 'content',
        ellipsis: true,
        key: 'content',
        render: (content: string) => (
          <Tooltip title={content}>
            <Text ellipsis>{content}</Text>
          </Tooltip>
        ),
        title: t('reminderList.column.content'),
        width: 320,
      },
      {
        dataIndex: 'creatorName',
        key: 'creatorName',
        render: (value: string) => value || EMPTY_CELL,
        title: t('reminderList.column.from'),
        width: 120,
      },
      {
        key: 'channel',
        render: (_: unknown, row) => {
          if (!row.status && !row.robotStatus) return EMPTY_CELL;

          return (
            <Flexbox horizontal align={'center'} gap={4}>
              <ChannelTag
                label={t('reminderList.channel.workNotice')}
                reason={row.failedReason}
                status={row.status}
              />
              <ChannelTag
                label={t('reminderList.channel.robot')}
                reason={row.robotFailedReason}
                status={row.robotStatus}
              />
            </Flexbox>
          );
        },
        title: t('reminderList.column.channel'),
        width: 160,
      },
      {
        key: 'actions',
        render: (_: unknown, row) => (
          <Popconfirm
            cancelText={t('reminderList.confirm.dismiss')}
            okText={t('reminderList.action.delete')}
            title={t('reminderList.confirm.delete')}
            onConfirm={() => handleDelete(row)}
          >
            <Button danger disabled={pendingId === row.id} size={'small'} type={'text'}>
              {t('reminderList.action.delete')}
            </Button>
          </Popconfirm>
        ),
        title: t('reminderList.column.actions'),
        width: 100,
      },
    ],
    [handleDelete, pendingId, t],
  );

  if (error) return <ReminderTableError onRetry={() => mutate()} />;
  if (isLoading && !data) return <ReminderTableSkeleton />;

  return (
    <Table<ReceivedReminderRow>
      columns={columns}
      dataSource={data ?? []}
      locale={{ emptyText: t('reminderList.empty.received') }}
      rowKey={'id'}
      scroll={{ x: 820 }}
      size={'small'}
      pagination={{
        hideOnSinglePage: true,
        pageSize: REMINDER_PAGE_SIZE,
        size: 'small',
      }}
    />
  );
});

ReceivedReminderTable.displayName = 'ReceivedReminderTable';

export default ReceivedReminderTable;
