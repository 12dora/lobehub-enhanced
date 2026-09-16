'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { AlarmClockCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_REMINDER_TIMEZONE,
  formatReminderTime,
  formatRepeatSummary,
} from '@/features/AgentTasks/ReminderList/formatters';
import ReminderRecipients from '@/features/AgentTasks/ReminderList/ReminderRecipients';

import type { CreateReminderParams, CreateReminderState } from '../../../types';
import { ReminderCard, ReminderField } from '../shared';

/**
 * `createReminder` result:
 * - success → a compact card with recipients, time, repeat, content and creator
 * - `needsConfirmation` → a notice listing the departments and their member
 *   counts, telling the user the reminder was NOT created yet
 */
export const CreateReminderRender = memo<
  BuiltinRenderProps<CreateReminderParams, CreateReminderState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');
  const { t: tChat } = useTranslation('chat');

  if (pluginState?.needsConfirmation) {
    const audience = pluginState.audience ?? [];

    return (
      <ReminderCard
        icon={TriangleAlertIcon}
        iconColor={cssVar.colorWarning}
        title={t('builtins.lobe-reminder.render.confirm.title')}
      >
        {audience.map((item) => (
          <Text fontSize={13} key={item.deptId}>
            {t('builtins.lobe-reminder.render.department', {
              count: item.memberCount,
              name: item.name,
            })}
          </Text>
        ))}
        <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
          {t('builtins.lobe-reminder.render.confirm.hint')}
        </Text>
      </ReminderCard>
    );
  }

  const reminder = pluginState?.reminder;

  if (!reminder) return null;

  const repeatSummary = formatRepeatSummary(reminder.repeat ?? reminder.repeatRule, tChat);

  return (
    <ReminderCard
      icon={AlarmClockCheckIcon}
      title={t('builtins.lobe-reminder.render.created.title')}
    >
      {!!reminder.recipients?.length && (
        <ReminderField label={t('builtins.lobe-reminder.render.field.recipients')}>
          <ReminderRecipients recipients={reminder.recipients} />
        </ReminderField>
      )}
      <ReminderField label={t('builtins.lobe-reminder.render.field.time')}>
        {formatReminderTime(reminder.fireAt, DEFAULT_REMINDER_TIMEZONE)}
      </ReminderField>
      {!!repeatSummary && (
        <ReminderField label={t('builtins.lobe-reminder.render.field.repeat')}>
          {repeatSummary}
        </ReminderField>
      )}
      <ReminderField label={t('builtins.lobe-reminder.render.field.content')}>
        {reminder.content}
      </ReminderField>
      <ReminderField label={t('builtins.lobe-reminder.render.field.creator')}>
        {reminder.creatorName}
      </ReminderField>
    </ReminderCard>
  );
});

CreateReminderRender.displayName = 'CreateReminderRender';

export default CreateReminderRender;
