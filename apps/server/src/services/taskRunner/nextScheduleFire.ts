import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Field matcher kept in step with `packages/utils/src/cronEval.ts` so the next
 * fire this helper reports is the same clock the schedule dispatcher uses.
 * `origin` is the first value `*` expands to (1 for day-of-month and month).
 */
const matchesCronField = (field: string, value: number, origin: number): boolean => {
  if (field === '*') return true;

  return field.split(',').some((raw) => {
    const expr = raw.trim();
    if (!expr) return false;

    const slash = expr.indexOf('/');
    const rangeExpr = slash === -1 ? expr : expr.slice(0, slash);
    const step = slash === -1 ? 1 : Number.parseInt(expr.slice(slash + 1), 10);
    if (!Number.isFinite(step) || step <= 0) return false;

    if (rangeExpr === '*') {
      return value >= origin && (value - origin) % step === 0;
    }

    if (rangeExpr.includes('-')) {
      const dash = rangeExpr.indexOf('-');
      const start = Number.parseInt(rangeExpr.slice(0, dash), 10);
      const end = Number.parseInt(rangeExpr.slice(dash + 1), 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (value < start || value > end) return false;
      return (value - start) % step === 0;
    }

    const exact = Number.parseInt(rangeExpr, 10);
    if (!Number.isFinite(exact)) return false;
    // Cron Sunday is 0 or 7.
    if (origin === 0 && exact === 7 && value === 0) return true;
    return value === exact;
  });
};

const expandField = (field: string, min: number, max: number): number[] | null => {
  const values: number[] = [];
  for (let value = min; value <= max; value++) {
    if (matchesCronField(field, value, min === 0 ? 0 : min)) values.push(value);
  }
  return values.length > 0 ? values : null;
};

/**
 * Soonest cron instant at or after the start of `now`'s minute, in `timezone`.
 * Returns null when the pattern is not a 5-field cron we can evaluate — callers
 * fail open and allow the run.
 */
export const nextScheduleFire = (
  pattern: string,
  timezoneName: string | null | undefined,
  now: Date,
): Date | null => {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [cronMinute, cronHour, cronDay, cronMonth, cronWeekday] = parts;

  const minutes = expandField(cronMinute, 0, 59);
  const hours = expandField(cronHour, 0, 23);
  if (!minutes || !hours) return null;

  const zone = timezoneName || 'UTC';
  let start: dayjs.Dayjs;
  try {
    start = dayjs(now).tz(zone).startOf('minute');
    if (!start.isValid()) return null;
  } catch {
    return null;
  }

  for (let dayOffset = 0; dayOffset <= 366; dayOffset++) {
    const day = start.add(dayOffset, 'day').startOf('day');
    if (!matchesCronField(cronDay, day.date(), 1)) continue;
    if (!matchesCronField(cronMonth, day.month() + 1, 1)) continue;
    if (!matchesCronField(cronWeekday, day.day(), 0)) continue;

    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = day.hour(hour).minute(minute).second(0).millisecond(0);
        if (candidate.valueOf() >= start.valueOf()) return candidate.toDate();
      }
    }
  }

  return null;
};

export const formatScheduleFire = (date: Date, timezoneName: string | null | undefined): string => {
  const zone = timezoneName || 'UTC';
  try {
    return dayjs(date).tz(zone).format('YYYY-MM-DD HH:mm');
  } catch {
    return dayjs(date).utc().format('YYYY-MM-DD HH:mm');
  }
};

export const scheduledRunDeferredMessage = (when: string): string =>
  `已按计划在 ${when} 执行，无需立即运行`;

export const isScheduledRunDeferredMessage = (message: string): boolean =>
  message.startsWith('已按计划在 ') && message.endsWith('执行，无需立即运行');

export interface ScheduleRunGateTask {
  automationMode?: string | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
}

export interface ScheduleRunGateParams {
  requestedByAgent?: boolean;
  runNow?: boolean;
  trigger?: string | null;
}

/**
 * Agent-initiated runTask on a schedule-mode task whose next fire is still in
 * the future. Scheduler ticks (trigger schedule/heartbeat) and explicit
 * runNow/force are allowed. Returns the user-facing refusal, or null to proceed.
 */
export const agentFutureScheduleRefusal = (
  task: ScheduleRunGateTask,
  params: ScheduleRunGateParams,
  now: Date,
): string | null => {
  if (!params.requestedByAgent || params.runNow) return null;
  if ((params.trigger ?? 'manual') !== 'manual') return null;
  if (task.automationMode !== 'schedule' || !task.schedulePattern) return null;

  const next = nextScheduleFire(task.schedulePattern, task.scheduleTimezone, now);
  if (!next || next.getTime() <= now.getTime()) return null;
  return scheduledRunDeferredMessage(formatScheduleFire(next, task.scheduleTimezone));
};
