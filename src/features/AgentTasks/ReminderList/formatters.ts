import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { TFunction } from 'i18next';

import type { ReminderRepeatRule } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Reminders are scheduled in China time unless a row says otherwise. */
export const DEFAULT_REMINDER_TIMEZONE = 'Asia/Shanghai';

/**
 * `YYYY-MM-DD HH:mm` in the reminder's timezone (Asia/Shanghai by product
 * decision), so a reminder reads the same for everyone regardless of the
 * browser's own timezone.
 */
export const formatReminderTime = (
  value: Date | number | string | null | undefined,
  tz: string = DEFAULT_REMINDER_TIMEZONE,
): string => {
  if (!value) return '';
  const time = dayjs(value);
  if (!time.isValid()) return '';

  try {
    return time.tz(tz).format('YYYY-MM-DD HH:mm');
  } catch {
    // Unknown IANA id — fall back to the local rendering rather than crashing.
    return time.format('YYYY-MM-DD HH:mm');
  }
};

const sortNumbers = (values: number[]) => [...values].sort((a, b) => a - b);

/**
 * Human repeat summary, e.g. 「每天 09:00」/「每周三 09:00」/「每月 1、15 日 09:00」.
 * Returns an empty string for one-shot reminders.
 */
export const formatRepeatSummary = (
  rule: ReminderRepeatRule | null | undefined,
  t: TFunction<'chat'>,
): string => {
  if (!rule) return '';

  const time = rule.time ?? '';

  switch (rule.freq) {
    case 'daily': {
      return t('reminderList.repeat.daily', { time });
    }

    case 'weekly': {
      const weekdays = sortNumbers(rule.weekdays ?? []);
      if (weekdays.length === 0) return t('reminderList.repeat.daily', { time });

      const days = weekdays
        .map((day) => t(`reminderList.weekday.${day}` as 'reminderList.weekday.1'))
        .join(t('reminderList.repeat.separator'));

      return t('reminderList.repeat.weekly', { days, time });
    }

    case 'monthly': {
      const monthDays = sortNumbers(rule.monthDays ?? []);
      if (monthDays.length === 0) return t('reminderList.repeat.daily', { time });

      const days = monthDays.join(t('reminderList.repeat.separator'));

      return t('reminderList.repeat.monthly', { days, time });
    }

    default: {
      return '';
    }
  }
};
