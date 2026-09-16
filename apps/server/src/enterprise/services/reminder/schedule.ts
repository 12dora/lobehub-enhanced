import type { ReminderScheduleInput } from '@lobechat/types';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import type { ReminderRepeatRule } from '@/database/schemas/reminder';

dayjs.extend(utc);
dayjs.extend(timezone);

export const REMINDER_DEFAULT_TZ = 'Asia/Shanghai';
export const FIRE_NOW_SLOT_MS = 60_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Index 1..7 = Monday..Sunday, without the leading 周 so `每周` + 三 → 每周三. */
const WEEKDAY_ZH = ['', '一', '二', '三', '四', '五', '六', '日'] as const;

const uniqueSorted = (values: number[] | undefined, min: number, max: number): number[] => {
  if (!values || values.length === 0) return [];
  return [...new Set(values.filter((value) => value >= min && value <= max))].sort((a, b) => a - b);
};

export const parseClockTime = (time: string): { hour: number; minute: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

export type ReminderScheduleInvalidReason =
  | 'invalid_date'
  | 'invalid_time'
  | 'invalid_until'
  | 'missing_date'
  | 'missing_monthDays'
  | 'missing_weekdays'
  | 'unknown_kind';

/** Kind-specific field check. Returns a reason when the payload cannot be scheduled. */
export const validateReminderSchedule = (
  schedule: ReminderScheduleInput,
): ReminderScheduleInvalidReason | null => {
  if (!parseClockTime(schedule.time)) return 'invalid_time';
  if (schedule.until && !DATE_RE.test(schedule.until)) return 'invalid_until';
  switch (schedule.kind) {
    case 'once': {
      if (!schedule.date) return 'missing_date';
      if (!DATE_RE.test(schedule.date)) return 'invalid_date';
      return null;
    }
    case 'daily': {
      return null;
    }
    case 'weekly': {
      return uniqueSorted(schedule.weekdays, 1, 7).length === 0 ? 'missing_weekdays' : null;
    }
    case 'monthly': {
      return uniqueSorted(schedule.monthDays, 1, 31).length === 0 ? 'missing_monthDays' : null;
    }
    default: {
      return 'unknown_kind';
    }
  }
};

export const fireNowSlotStart = (now: Date): Date => new Date(now.getTime() - FIRE_NOW_SLOT_MS);

/**
 * Local wall-clock start of the cron occurrence being fired (Asia/Shanghai).
 * Repeats use today's `HH:mm`; once uses the absolute date+time.
 */
export const reminderOccurrenceStart = (
  schedule: ReminderScheduleInput,
  now: Date,
  tz: string = REMINDER_DEFAULT_TZ,
): Date => {
  if (schedule.kind === 'once') {
    if (!schedule.date) return fireNowSlotStart(now);
    try {
      return resolveOneShotFireAt({ localDate: schedule.date, time: schedule.time, tz });
    } catch {
      return fireNowSlotStart(now);
    }
  }
  const parsed = parseClockTime(schedule.time);
  if (!parsed) return fireNowSlotStart(now);
  return dayjs(now)
    .tz(tz)
    .hour(parsed.hour)
    .minute(parsed.minute)
    .second(0)
    .millisecond(0)
    .toDate();
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

/** ISO weekday 1–7 (Mon=1, Sun=7) → cron weekday (Sun=0). */
const isoWeekdayToCron = (day: number): number => day % 7;

export const scheduleToRepeatRule = (
  schedule: ReminderScheduleInput,
): ReminderRepeatRule | null => {
  if (schedule.kind === 'once') return null;
  const rule: ReminderRepeatRule = { freq: schedule.kind, time: schedule.time };
  const weekdays = uniqueSorted(schedule.weekdays, 1, 7);
  const monthDays = uniqueSorted(schedule.monthDays, 1, 31);
  if (weekdays.length > 0) rule.weekdays = weekdays;
  if (monthDays.length > 0) rule.monthDays = monthDays;
  if (schedule.until) rule.until = schedule.until;
  return rule;
};

/**
 * Map a structured reminder schedule onto a 5-field cron in Asia/Shanghai.
 * Once: `mm HH D M *`. Daily: `mm HH * * *`. Weekly: `mm HH * * d1,d2` (Sun=0).
 * Monthly: `mm HH d1,d2 * *`.
 */
export const buildReminderCron = (schedule: ReminderScheduleInput): string => {
  const parsed = parseClockTime(schedule.time);
  if (!parsed) {
    throw new Error(`Invalid reminder time: ${schedule.time}`);
  }
  const minute = String(parsed.minute);
  const hour = String(parsed.hour);

  switch (schedule.kind) {
    case 'once': {
      if (!schedule.date) {
        throw new Error('once schedule requires date');
      }
      const parts = schedule.date.split('-');
      const month = Number.parseInt(parts[1] ?? '', 10);
      const day = Number.parseInt(parts[2] ?? '', 10);
      if (!Number.isFinite(month) || !Number.isFinite(day)) {
        throw new Error(`Invalid reminder date: ${schedule.date}`);
      }
      return `${minute} ${hour} ${day} ${month} *`;
    }
    case 'daily': {
      return `${minute} ${hour} * * *`;
    }
    case 'weekly': {
      const weekdays = uniqueSorted(schedule.weekdays, 1, 7);
      if (weekdays.length === 0) {
        throw new Error('weekly schedule requires weekdays');
      }
      return `${minute} ${hour} * * ${weekdays.map(isoWeekdayToCron).join(',')}`;
    }
    case 'monthly': {
      const monthDays = uniqueSorted(schedule.monthDays, 1, 31);
      if (monthDays.length === 0) {
        throw new Error('monthly schedule requires monthDays');
      }
      return `${minute} ${hour} ${monthDays.join(',')} * *`;
    }
    default: {
      throw new Error(
        `Unknown reminder schedule kind: ${(schedule as ReminderScheduleInput).kind}`,
      );
    }
  }
};

/** Human schedule summary, e.g. `每天 09:00` / `每周一、三 09:00` / `2026-09-17 09:00 一次`. */
export const describeReminderSchedule = (schedule: ReminderScheduleInput): string => {
  const time = schedule.time;
  let summary: string;
  switch (schedule.kind) {
    case 'once': {
      summary = `${schedule.date ?? ''} ${time} 一次`.trim();
      break;
    }
    case 'daily': {
      summary = `每天 ${time}`;
      break;
    }
    case 'weekly': {
      const labels = uniqueSorted(schedule.weekdays, 1, 7)
        .map((day) => WEEKDAY_ZH[day])
        .filter(Boolean);
      summary = labels.length === 0 ? `每周 ${time}` : `每周${labels.join('、')} ${time}`;
      break;
    }
    case 'monthly': {
      summary = `${monthlySummary(schedule.monthDays ?? [])} ${time}`;
      break;
    }
    default: {
      summary = time;
    }
  }
  if (schedule.until && schedule.kind !== 'once') {
    return `${summary} 至 ${schedule.until}`;
  }
  return summary;
};

/**
 * Next planned fire instant in Asia/Shanghai.
 * Once returns the absolute wall-clock time (even if past — callers reject stale once).
 * Repeats return the first occurrence strictly after `now`, or null past `until`.
 */
export const nextReminderFireAt = (
  schedule: ReminderScheduleInput,
  now: Date,
  tz: string = REMINDER_DEFAULT_TZ,
): Date | null => {
  if (schedule.kind === 'once') {
    if (!schedule.date) return null;
    return resolveOneShotFireAt({ localDate: schedule.date, time: schedule.time, tz });
  }
  const rule = scheduleToRepeatRule(schedule);
  if (!rule) return null;
  return nextFireAt(rule, now, tz);
};

/** Reconstruct a structured schedule from a legacy `fire_at` + `repeat_rule` pair. */
export const scheduleFromLegacy = (
  fireAt: Date,
  repeat?: ReminderRepeatRule | null,
  tz: string = REMINDER_DEFAULT_TZ,
): ReminderScheduleInput => {
  if (!repeat) {
    const local = dayjs(fireAt).tz(tz);
    return {
      date: local.format('YYYY-MM-DD'),
      kind: 'once',
      time: local.format('HH:mm'),
    };
  }
  const schedule: ReminderScheduleInput = { kind: repeat.freq, time: repeat.time };
  if (repeat.weekdays?.length) schedule.weekdays = uniqueSorted(repeat.weekdays, 1, 7);
  if (repeat.monthDays?.length) schedule.monthDays = uniqueSorted(repeat.monthDays, 1, 31);
  if (repeat.until) schedule.until = repeat.until;
  return schedule;
};
