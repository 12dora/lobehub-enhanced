import {
  parseReminderMentions,
  REMINDER_TIMEZONE,
  type ReminderScheduleInput,
} from '@lobechat/types';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { TFunction } from 'i18next';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * A recipient as the task body spells it. The mention grammar is the only
 * client-side source of truth between two saves: `@姓名·部门` is a person,
 * `@部门名` (no middle dot) is a department.
 */
export interface ReminderRecipientChip {
  /** Leaf department of a person; empty for a department mention. */
  dept?: string;
  /** Person name, or the department name for a department mention. */
  name: string;
}

/**
 * Recipients of a reminder task, read from the mention line of its body.
 *
 * Only the FIRST line is scanned: the reminder body is written as
 * `@a·x @b·y` + blank line + content, so an `@` inside the content (an e-mail
 * address, a literal at-sign) can never be mistaken for a recipient.
 */
export const parseReminderRecipients = (instruction?: string | null): ReminderRecipientChip[] => {
  if (!instruction) return [];
  const [firstLine = ''] = instruction.split('\n');

  return parseReminderMentions(firstLine).map((token) => ({
    dept: token.dept,
    name: token.name,
  }));
};

type WeekdayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** ISO weekday (1 = Monday) → locale key, typed so `t()` needs no `as never`. */
const WEEKDAY_KEYS = {
  1: 'taskReminder.weekday.1',
  2: 'taskReminder.weekday.2',
  3: 'taskReminder.weekday.3',
  4: 'taskReminder.weekday.4',
  5: 'taskReminder.weekday.5',
  6: 'taskReminder.weekday.6',
  7: 'taskReminder.weekday.7',
} as const satisfies Record<WeekdayNumber, string>;

/**
 * Human text for a structured schedule, e.g. `每天 09:00` / `每周一、三 09:00`.
 * Used for the save confirmation, where the server only returns the structured
 * input (the persisted `scheduleSummary` lands one refresh later).
 */
export const formatReminderScheduleInput = (
  schedule: ReminderScheduleInput | undefined,
  t: TFunction<'chat'>,
): string => {
  if (!schedule) return '';
  const { time } = schedule;
  const separator = t('taskReminder.schedule.separator');

  switch (schedule.kind) {
    case 'daily': {
      return t('taskReminder.schedule.daily', { time });
    }

    case 'monthly': {
      const days = (schedule.monthDays ?? []).join(separator);
      return t('taskReminder.schedule.monthly', { days, time });
    }

    case 'weekly': {
      const days = (schedule.weekdays ?? [])
        .map((day) => {
          const key = WEEKDAY_KEYS[day as WeekdayNumber];
          // Out-of-range day (bad server payload): print the number rather than
          // a raw i18n key.
          return key ? t(key) : String(day);
        })
        .join(separator);
      return t('taskReminder.schedule.weekly', { days, time });
    }

    default: {
      return t('taskReminder.schedule.once', { date: schedule.date ?? '', time });
    }
  }
};

/**
 * `YYYY-MM-DD HH:mm` in the reminder timezone (Asia/Shanghai by product
 * decision), so a delivery timestamp reads the same for every viewer no matter
 * what the browser's own timezone is.
 */
export const formatReminderTimestamp = (value?: Date | number | string | null): string => {
  if (!value) return '';
  const time = dayjs(value);
  if (!time.isValid()) return '';

  try {
    return time.tz(REMINDER_TIMEZONE).format('YYYY-MM-DD HH:mm');
  } catch {
    // Unknown IANA id (very old runtime) — local rendering beats crashing.
    return time.format('YYYY-MM-DD HH:mm');
  }
};

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

/**
 * Rewrite one ambiguous mention in the draft, e.g. `@胡玉琴` → `@胡玉琴A·外贸组`.
 *
 * Only a whole token is replaced (start of line / after whitespace, ending at
 * whitespace or end of text), so `@胡玉琴` never eats into `@胡玉琴A·外贸组` that
 * the user already disambiguated by hand.
 */
export const replaceReminderMentionToken = (
  markdown: string,
  query: string,
  replacement: string,
): string => {
  const pattern = new RegExp(String.raw`(^|\s)@${escapeRegExp(query)}(?=\s|$)`, 'gu');

  return markdown.replaceAll(pattern, `$1${replacement}`);
};
