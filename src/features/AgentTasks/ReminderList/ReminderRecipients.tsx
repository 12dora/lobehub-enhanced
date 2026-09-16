'use client';

import { Flexbox, Tooltip } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import type { TFunction } from 'i18next';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReminderRecipientView } from './types';

/** Chips beyond this count collapse into a single `+N` chip. */
export const REMINDER_RECIPIENT_CHIP_LIMIT = 6;

/**
 * Chip label for one recipient:
 * - user: `@胡玉琴A · 安环部` (the dot is dropped when the user has no department)
 * - department: `@安环部 · 12 人`
 */
export const buildRecipientLabel = (
  recipient: ReminderRecipientView,
  t: TFunction<'chat'>,
): string => {
  const name = recipient.displayName;

  if (recipient.kind === 'department') {
    const count = recipient.memberCount ?? 0;
    return t('reminderList.recipients.department', { count, name });
  }

  const dept = recipient.deptName?.trim();

  return dept
    ? t('reminderList.recipients.user', { dept, name })
    : t('reminderList.recipients.userOnly', { name });
};

interface ReminderRecipientsProps {
  /** Chips rendered before collapsing into `+N`. */
  max?: number;
  recipients?: ReminderRecipientView[];
}

/**
 * Recipient chips of a reminder. Departments carry their member count so the
 * creator can see how wide an audience a single chip stands for.
 */
const ReminderRecipients = memo<ReminderRecipientsProps>(
  ({ max = REMINDER_RECIPIENT_CHIP_LIMIT, recipients }) => {
    const { t } = useTranslation('chat');

    const labels = useMemo(
      () => (recipients ?? []).map((recipient) => buildRecipientLabel(recipient, t)),
      [recipients, t],
    );

    if (labels.length === 0) return null;

    const visible = labels.slice(0, max);
    const overflow = labels.slice(max);

    return (
      <Flexbox horizontal align={'center'} gap={4} wrap={'wrap'}>
        {visible.map((label, index) => (
          <Tag key={`${label}-${index}`} size={'small'}>
            {label}
          </Tag>
        ))}
        {overflow.length > 0 && (
          <Tooltip title={overflow.join(t('reminderList.repeat.separator'))}>
            <Tag size={'small'}>
              {t('reminderList.recipients.more', { count: overflow.length })}
            </Tag>
          </Tooltip>
        )}
      </Flexbox>
    );
  },
);

ReminderRecipients.displayName = 'ReminderRecipients';

export default ReminderRecipients;
