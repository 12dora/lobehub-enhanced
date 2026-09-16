import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Reminders are scheduled in China time unless a row says otherwise. */
export const DEFAULT_REMINDER_TIMEZONE = 'Asia/Shanghai';

const format = (
  value: Date | number | string | null | undefined,
  pattern: string,
  tz: string,
): string => {
  if (!value) return '';
  const time = dayjs(value);
  if (!time.isValid()) return '';

  try {
    return time.tz(tz).format(pattern);
  } catch {
    // Unknown IANA id — fall back to the local rendering rather than crashing.
    return time.format(pattern);
  }
};

/**
 * `YYYY-MM-DD HH:mm` in the reminder's timezone (Asia/Shanghai by product
 * decision), so a reminder reads the same for everyone regardless of the
 * browser's own timezone.
 */
export const formatReminderTime = (
  value: Date | number | string | null | undefined,
  tz: string = DEFAULT_REMINDER_TIMEZONE,
): string => format(value, 'YYYY-MM-DD HH:mm', tz);

/**
 * `MM-DD HH:mm` — the compact form the reminder tables use, where the column is
 * narrow and the year carries no information for near-term reminders.
 */
export const formatReminderShortTime = (
  value: Date | number | string | null | undefined,
  tz: string = DEFAULT_REMINDER_TIMEZONE,
): string => format(value, 'MM-DD HH:mm', tz);
