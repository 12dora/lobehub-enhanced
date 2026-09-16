'use client';

import { isReminderTaskConfig } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { App, Popconfirm } from 'antd';
import { cssVar } from 'antd-style';
import debug from 'debug';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { reminderService } from '@/services/reminder';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import ReminderRecipients from '../ReminderList/ReminderRecipients';
import { mutateReminderLists } from '../ReminderList/swrKeys';
import type { ReminderRecipientView } from '../ReminderList/types';
import { useReminderTaskRow } from '../ReminderList/useReminderTaskRow';
import { formatReminderTimestamp, parseReminderRecipients } from './reminderText';

const log = debug('agent-tasks:reminder-panel');

interface FieldRowProps {
  children: ReactNode;
  label: string;
}

const FieldRow = memo<FieldRowProps>(({ children, label }) => (
  <Flexbox horizontal align={'flex-start'} gap={12} style={{ minWidth: 0 }} wrap={'wrap'}>
    <Text fontSize={12} style={{ color: cssVar.colorTextTertiary, flex: 'none', width: 72 }}>
      {label}
    </Text>
    <Flexbox align={'flex-start'} flex={1} style={{ minWidth: 0 }}>
      {children}
    </Flexbox>
  </Flexbox>
));

FieldRow.displayName = 'ReminderFieldRow';

/**
 * Reminder facts + actions for a reminder task, rendered by `TaskDetailSections`
 * INSTEAD OF the schedule / assignee / verify / model sections: a reminder never
 * runs an agent, so none of those controls mean anything for it.
 *
 * Recipients, next/last delivery come from the server row (`reminder.listCreated`);
 * the mention line of the body is only the fallback preview while that row loads
 * or right after an edit, since the body is what the user actually edits and the
 * server re-interprets it on save.
 */
const TaskReminderPanel = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const [firing, setFiring] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const detail = useTaskStore(taskDetailSelectors.activeTaskDetail);
  const refreshTaskDetail = useTaskStore((s) => s.internal_refreshTaskDetail);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);

  const config = detail?.config;
  const reminder = isReminderTaskConfig(config) ? config.reminder : undefined;
  const instruction = detail?.instruction;
  const status = detail?.status;

  // The server row carries what the task record cannot: the next planned fire
  // time, the last delivery counts and the RESOLVED recipients (departments
  // with their member count).
  const { row } = useReminderTaskRow(taskId);
  const lastSentAt = row?.lastFiredAt ?? detail?.heartbeat?.lastAt;

  const recipients = useMemo<ReminderRecipientView[]>(() => {
    if (row?.recipients && row.recipients.length > 0) return row.recipients;

    // Fallback for a body that was just edited (or a row that has not loaded
    // yet): the mention line is the draft's own view of the recipients, minus
    // the department member counts the directory resolves.
    return parseReminderRecipients(instruction).map((chip) => ({
      deptName: chip.dept ?? null,
      displayName: chip.name,
      kind: chip.dept ? 'user' : 'department',
    }));
  }, [instruction, row?.recipients]);

  const refresh = useCallback(async () => {
    if (taskId) await refreshTaskDetail(taskId);
    await refreshTaskList().catch(() => {});
    // 定时提醒 tables live on their own SWR caches — keep them in step.
    await mutateReminderLists().catch(() => {});
  }, [refreshTaskDetail, refreshTaskList, taskId]);

  const handleFireNow = useCallback(async () => {
    if (!taskId) return;
    setFiring(true);
    try {
      const result = await reminderService.fireNow(taskId);
      message.success(
        t('taskReminder.fireNow.success', {
          failed: result?.failed ?? 0,
          sent: result?.sent ?? 0,
          skipped: result?.skipped ?? 0,
        }),
      );
      await refresh();
    } catch (error) {
      log('fireNow failed: %O', error);
      message.error(t('taskReminder.fireNow.failed'));
    } finally {
      setFiring(false);
    }
  }, [message, refresh, t, taskId]);

  const handleCancel = useCallback(async () => {
    if (!taskId) return;
    setCanceling(true);
    try {
      await reminderService.cancel(taskId);
      message.success(t('taskReminder.cancel.success'));
      await refresh();
    } catch (error) {
      log('cancel failed: %O', error);
      message.error(t('taskReminder.cancel.failed'));
    } finally {
      setCanceling(false);
    }
  }, [message, refresh, t, taskId]);

  if (!reminder) return null;

  const isFinished = status === 'canceled' || status === 'completed';
  const until = reminder.until ?? reminder.schedule?.until;
  // A finished reminder has no next fire even if the profile still carries one.
  const nextFireAt = isFinished ? undefined : row?.nextFireAt;
  const lastDelivery = row?.lastDelivery;

  return (
    <Block data-testid={'task-reminder-panel'} gap={12} padding={16} variant={'outlined'}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
        <Text weight={500}>{t('taskReminder.title')}</Text>
        {isFinished ? (
          <Tag size={'small'}>
            {status === 'canceled'
              ? t('taskReminder.status.canceled')
              : t('taskReminder.status.completed')}
          </Tag>
        ) : (
          <Flexbox horizontal align={'center'} gap={8}>
            <Popconfirm
              arrow={false}
              cancelText={t('taskReminder.confirm.dismiss')}
              okButtonProps={{ loading: firing }}
              okText={t('taskReminder.confirm.ok')}
              placement={'topRight'}
              title={t('taskReminder.confirm.fireNow')}
              onConfirm={handleFireNow}
            >
              <Button loading={firing} size={'small'}>
                {t('taskReminder.action.fireNow')}
              </Button>
            </Popconfirm>
            <Popconfirm
              arrow={false}
              cancelText={t('taskReminder.confirm.dismiss')}
              okButtonProps={{ danger: true, loading: canceling }}
              okText={t('taskReminder.action.cancel')}
              placement={'topRight'}
              title={t('taskReminder.confirm.cancel')}
              onConfirm={handleCancel}
            >
              <Button loading={canceling} size={'small'} type={'text'}>
                {t('taskReminder.action.cancel')}
              </Button>
            </Popconfirm>
          </Flexbox>
        )}
      </Flexbox>

      <FieldRow label={t('taskReminder.field.recipients')}>
        {recipients.length === 0 ? (
          <Text fontSize={13} type={'secondary'}>
            {t('taskReminder.recipients.empty')}
          </Text>
        ) : (
          <ReminderRecipients max={recipients.length} recipients={recipients} />
        )}
      </FieldRow>

      <FieldRow label={t('taskReminder.field.schedule')}>
        <Text fontSize={13}>{reminder.scheduleSummary}</Text>
      </FieldRow>

      {!!until && (
        <FieldRow label={t('taskReminder.field.until')}>
          <Text fontSize={13}>{until}</Text>
        </FieldRow>
      )}

      <FieldRow label={t('taskReminder.field.nextFire')}>
        <Text fontSize={13} type={nextFireAt ? undefined : 'secondary'}>
          {nextFireAt ? formatReminderTimestamp(nextFireAt) : t('taskReminder.nextFire.none')}
        </Text>
      </FieldRow>

      <FieldRow label={t('taskReminder.field.lastSent')}>
        {lastSentAt ? (
          <Flexbox gap={2}>
            <Text fontSize={13}>{formatReminderTimestamp(lastSentAt)}</Text>
            {!!lastDelivery && (
              <Text fontSize={12} type={'secondary'}>
                {t('reminderList.delivery.counts', {
                  failed: lastDelivery.failed,
                  sent: lastDelivery.sent,
                  skipped: lastDelivery.skipped,
                })}
              </Text>
            )}
          </Flexbox>
        ) : (
          <Text fontSize={13} type={'secondary'}>
            {t('taskReminder.lastSent.never')}
          </Text>
        )}
      </FieldRow>

      <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
        {t('taskReminder.editHint')}
      </Text>
    </Block>
  );
});

TaskReminderPanel.displayName = 'TaskReminderPanel';

export default TaskReminderPanel;
