'use client';

import { isReminderTaskConfig } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { App, Popconfirm } from 'antd';
import { cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { reminderService } from '@/services/reminder';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import {
  formatReminderRecipientChip,
  formatReminderTimestamp,
  parseReminderRecipients,
} from './reminderText';

/** `fireNow` result — typed locally so the panel does not depend on the router's inferred shape. */
interface FireNowResult {
  failed: number;
  firedAt: string;
  sent: number;
  skipped: number;
}

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
 * Recipients are read back from the mention line of the body — the body is the
 * single source of truth the user edits, and the server re-interprets it on save.
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
  const lastSentAt = detail?.heartbeat?.lastAt;

  const recipients = useMemo(() => parseReminderRecipients(instruction), [instruction]);

  const refresh = useCallback(async () => {
    if (taskId) await refreshTaskDetail(taskId);
    await refreshTaskList().catch(() => {});
  }, [refreshTaskDetail, refreshTaskList, taskId]);

  const handleFireNow = useCallback(async () => {
    if (!taskId) return;
    setFiring(true);
    try {
      const result = (await reminderService.fireNow(taskId)) as FireNowResult;
      message.success(
        t('taskReminder.fireNow.success', {
          failed: result?.failed ?? 0,
          sent: result?.sent ?? 0,
          skipped: result?.skipped ?? 0,
        }),
      );
      await refresh();
    } catch (error) {
      console.error('[TaskReminderPanel] fireNow failed:', error);
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
      console.error('[TaskReminderPanel] cancel failed:', error);
      message.error(t('taskReminder.cancel.failed'));
    } finally {
      setCanceling(false);
    }
  }, [message, refresh, t, taskId]);

  if (!reminder) return null;

  const isFinished = status === 'canceled' || status === 'completed';
  const until = reminder.until ?? reminder.schedule?.until;

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
          <Flexbox horizontal align={'center'} gap={4} wrap={'wrap'}>
            {recipients.map((recipient, index) => (
              <Tag key={`${recipient.name}-${recipient.dept ?? ''}-${index}`} size={'small'}>
                {formatReminderRecipientChip(recipient, t)}
              </Tag>
            ))}
          </Flexbox>
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

      <FieldRow label={t('taskReminder.field.lastSent')}>
        <Text fontSize={13} type={lastSentAt ? undefined : 'secondary'}>
          {lastSentAt ? formatReminderTimestamp(lastSentAt) : t('taskReminder.lastSent.never')}
        </Text>
      </FieldRow>

      <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
        {t('taskReminder.editHint')}
      </Text>
    </Block>
  );
});

TaskReminderPanel.displayName = 'TaskReminderPanel';

export default TaskReminderPanel;
