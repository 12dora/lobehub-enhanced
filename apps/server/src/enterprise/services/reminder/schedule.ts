import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import type { ReminderRepeatRule } from '@/database/schemas/reminder';

dayjs.extend(utc);
dayjs.extend(timezone);

export const REMINDER_DEFAULT_TZ = 'Asia/Shanghai';

/** Index 1..7 = Monday..Sunday, without the leading 周 so `每周` + 三 → 每周三. */
const WEEKDAY_ZH = ['', '一', '二', '三', '四', '五', '六', '日'] as const;

export const parseClockTime = (time: string): { hour: number; minute: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** ISO weekday: Monday = 1 … Sunday = 7. */
export const isoWeekday = (local: dayjs.Dayjs): number => ((local.day() + 6) % 7) + 1;

export const formatServerNowIso = (now: Date = new Date(), tz = REMINDER_DEFAULT_TZ): string =>
  dayjs(now).tz(tz).format('YYYY-MM-DDTHH:mm:ssZ');

export const isDue = (fireAt: Date, now: Date): boolean => fireAt.getTime() <= now.getTime();

/**
 * Absolute one-shot fire in `tz`. Unlike cron daily catch-up, a fire at
 * tomorrow 09:00 created at 15:00 today is not due today.
 */
export const resolveOneShotFireAt = (input: {
  localDate: string;
  time: string;
  tz?: string;
}): Date => {
  const tz = input.tz ?? REMINDER_DEFAULT_TZ;
  const parsed = parseClockTime(input.time);
  if (!parsed) {
    throw new Error(`Invalid reminder time: ${input.time}`);
  }
  const local = dayjs.tz(
    `${input.localDate} ${pad2(parsed.hour)}:${pad2(parsed.minute)}:00`,
    'YYYY-MM-DD HH:mm:ss',
    tz,
  );
  if (!local.isValid()) {
    throw new Error(`Invalid reminder date: ${input.localDate}`);
  }
  return local.toDate();
};

/** First occurrence of `HH:mm` in `tz` strictly after `after`. */
export const nextClockTime = (time: string, after: Date, tz: string): Date | null => {
  const parsed = parseClockTime(time);
  if (!parsed) return null;
  const localAfter = dayjs(after).tz(tz);
  let candidate = localAfter.hour(parsed.hour).minute(parsed.minute).second(0).millisecond(0);
  if (!candidate.isAfter(localAfter)) {
    candidate = candidate.add(1, 'day');
  }
  return candidate.toDate();
};

const uniqueSorted = (values: number[] | undefined, min: number, max: number): number[] => {
  if (!values || values.length === 0) return [];
  return [...new Set(values.filter((value) => value >= min && value <= max))].sort((a, b) => a - b);
};

const isOnOrBeforeUntil = (fireAt: Date, until: string | undefined, tz: string): boolean => {
  if (!until) return true;
  return dayjs(fireAt).tz(tz).format('YYYY-MM-DD') <= until;
};

const nextDaily = (time: string, after: Date, tz: string): Date | null =>
  nextClockTime(time, after, tz);

const nextWeekly = (weekdays: number[], time: string, after: Date, tz: string): Date | null => {
  const parsed = parseClockTime(time);
  if (!parsed || weekdays.length === 0) return null;
  const localAfter = dayjs(after).tz(tz);
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = localAfter.add(offset, 'day');
    if (!weekdays.includes(isoWeekday(day))) continue;
    const candidate = day.hour(parsed.hour).minute(parsed.minute).second(0).millisecond(0);
    if (candidate.isAfter(localAfter)) return candidate.toDate();
  }
  return null;
};

/**
 * Next monthly fire. Days that do not exist in a month clamp to that month's
 * last day so a 31st still fires across February.
 */
const nextMonthly = (monthDays: number[], time: string, after: Date, tz: string): Date | null => {
  const parsed = parseClockTime(time);
  if (!parsed || monthDays.length === 0) return null;
  const localAfter = dayjs(after).tz(tz);
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const monthStart = localAfter.add(monthOffset, 'month').startOf('month');
    const daysInMonth = monthStart.daysInMonth();
    for (const targetDay of monthDays) {
      const day = Math.min(targetDay, daysInMonth);
      const candidate = monthStart
        .date(day)
        .hour(parsed.hour)
        .minute(parsed.minute)
        .second(0)
        .millisecond(0);
      if (candidate.isAfter(localAfter)) return candidate.toDate();
    }
  }
  return null;
};

const computeNext = (rule: ReminderRepeatRule, after: Date, tz: string): Date | null => {
  switch (rule.freq) {
    case 'daily': {
      return nextDaily(rule.time, after, tz);
    }
    case 'weekly': {
      return nextWeekly(uniqueSorted(rule.weekdays, 1, 7), rule.time, after, tz);
    }
    case 'monthly': {
      return nextMonthly(uniqueSorted(rule.monthDays, 1, 31), rule.time, after, tz);
    }
    default: {
      return null;
    }
  }
};

/** First occurrence of `rule` strictly after `after`. `null` when past `until`. */
export const nextFireAt = (
  rule: ReminderRepeatRule,
  after: Date,
  tz: string = REMINDER_DEFAULT_TZ,
): Date | null => {
  const next = computeNext(rule, after, tz);
  if (!next) return null;
  if (!isOnOrBeforeUntil(next, rule.until, tz)) return null;
  return next;
};

/** First occurrence of `rule` strictly after `now` (same as {@link nextFireAt}). */
export const initialFireAt = (
  rule: ReminderRepeatRule,
  now: Date,
  tz: string = REMINDER_DEFAULT_TZ,
): Date | null => nextFireAt(rule, now, tz);

const weeklySummary = (weekdays: number[]): string => {
  const labels = uniqueSorted(weekdays, 1, 7)
    .map((day) => WEEKDAY_ZH[day])
    .filter(Boolean);
  if (labels.length === 0) return '每周';
  return `每周${labels.join('、周')}`;
};

const monthlySummary = (monthDays: number[]): string => {
  const days = uniqueSorted(monthDays, 1, 31);
  if (days.length === 0) return '每月';
  return `每月${days.map((day) => `${day}日`).join('、')}`;
};

export const formatRepeatSummary = (rule: ReminderRepeatRule | null | undefined): string | null => {
  if (!rule) return null;
  if (rule.freq === 'daily') return '每天';
  if (rule.freq === 'weekly') return weeklySummary(rule.weekdays ?? []);
  if (rule.freq === 'monthly') return monthlySummary(rule.monthDays ?? []);
  return null;
};

export const formatFireClock = (at: Date, tz: string): string => dayjs(at).tz(tz).format('HH:mm');

/**
 * Work-notice markdown body. Title field is always 「提醒」.
 * Repeats append a 「（每周三）」-style summary after the clock time.
 */
export const buildReminderNotice = (input: {
  content: string;
  creatorName: string;
  firedAt: Date;
  repeatRule?: ReminderRepeatRule | null;
  timezone: string;
}): { text: string; title: string } => {
  const clock = formatFireClock(input.firedAt, input.timezone);
  const summary = formatRepeatSummary(input.repeatRule ?? null);
  const timeLine = summary
    ? `${clock}（${summary}） · 来自 ${input.creatorName}`
    : `${clock} · 来自 ${input.creatorName}`;
  return {
    text: `### 提醒\n${input.content}\n\n${timeLine}`,
    title: '提醒',
  };
};
