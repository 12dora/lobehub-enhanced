'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { AlarmClockCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  DEFAULT_REMINDER_TIMEZONE,
  formatReminderTime,
} from '@/features/AgentTasks/ReminderList/formatters';

import type { CreateReminderParams, CreateReminderState } from '../../../types';
import { formatReminderRecipientLabel } from '../../../types';
import { ReminderCard, ReminderField } from '../shared';

/**
 * `createReminder` result:
 * - created → task identifier, recipients 「姓名 · 部门」, schedule, next fire
 * - needs_clarification → candidate list 「姓名 · 部门」
 * - needs_confirmation → department audience that must be confirmed first
 */
export const CreateReminderRender = memo<
  BuiltinRenderProps<CreateReminderParams, CreateReminderState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');

  if (pluginState?.needsClarification) {
    const ambiguous = pluginState.ambiguous ?? [];
    const unknown = pluginState.unknown ?? [];

    return (
      <ReminderCard
        icon={TriangleAlertIcon}
        iconColor={cssVar.colorWarning}
        title={t('builtins.lobe-reminder.render.clarify.title')}
      >
        {ambiguous.map((group) => (
          <ReminderField key={group.query} label={group.query}>
            {group.candidates.map((candidate) => (
              <Text fontSize={13} key={candidate.staffId}>
                {candidate.leafDeptName
                  ? `${candidate.name} · ${candidate.leafDeptName}`
                  : candidate.name}
              </Text>
            ))}
          </ReminderField>
        ))}
        {unknown.map((name) => (
          <Text fontSize={13} key={name}>
            {t('builtins.lobe-reminder.render.clarify.unknown', { name })}
          </Text>
        ))}
      </ReminderCard>
    );
  }

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

  const nextFire = formatReminderTime(reminder.nextFireAt, DEFAULT_REMINDER_TIMEZONE);

  return (
    <ReminderCard
      icon={AlarmClockCheckIcon}
      title={t('builtins.lobe-reminder.render.created.title')}
    >
      {reminder.identifier && (
        <ReminderField label={t('builtins.lobe-reminder.render.field.identifier')}>
          <Link to={`/task/${reminder.identifier}`}>{reminder.identifier}</Link>
        </ReminderField>
      )}
      {!!reminder.recipients?.length && (
        <ReminderField label={t('builtins.lobe-reminder.render.field.recipients')}>
          {reminder.recipients.map((recipient) => (
            <Text fontSize={13} key={`${recipient.kind}:${recipient.staffId ?? recipient.deptId}`}>
              {formatReminderRecipientLabel(recipient)}
            </Text>
          ))}
        </ReminderField>
      )}
      {!!reminder.scheduleSummary && (
        <ReminderField label={t('builtins.lobe-reminder.render.field.schedule')}>
          {reminder.scheduleSummary}
        </ReminderField>
      )}
      {!!nextFire && (
        <ReminderField label={t('builtins.lobe-reminder.render.field.nextFire')}>
          {nextFire}
        </ReminderField>
      )}
      {!!reminder.content && (
        <ReminderField label={t('builtins.lobe-reminder.render.field.content')}>
          {reminder.content}
        </ReminderField>
      )}
    </ReminderCard>
  );
});

CreateReminderRender.displayName = 'CreateReminderRender';

export default CreateReminderRender;
