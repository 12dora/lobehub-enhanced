import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import type { ApprovalRuleDisabledReason, ApprovalRuleRow } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);

/** The worker runs, counts and expires rules on China time. */
export const APPROVAL_RULE_TIMEZONE = 'Asia/Shanghai';

/** A `date` column arrives as `YYYY-MM-DD`; a timestamp arrives as an instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

/** `YYYY-MM-DD` in the rule timezone — the form an expiry is set in. */
export const formatRuleDate = (
  value: Date | number | string | null | undefined,
  tz: string = APPROVAL_RULE_TIMEZONE,
): string => format(value, 'YYYY-MM-DD', tz);

/** `YYYY-MM-DD HH:mm` in the rule timezone, for run timestamps. */
export const formatRuleDateTime = (
  value: Date | number | string | null | undefined,
  tz: string = APPROVAL_RULE_TIMEZONE,
): string => format(value, 'YYYY-MM-DD HH:mm', tz);

/**
 * Has the rule's validity window closed? A rule without an expiry is permanent.
 * The comparison is on the instant, not on the rendered day, so a rule that
 * lapsed an hour ago reads as expired immediately.
 */
export const isRuleExpired = (
  expiresAt: Date | number | string | null | undefined,
  now: Date | number | string = Date.now(),
): boolean => {
  if (!expiresAt) return false;
  const expiry = dayjs(expiresAt);
  if (!expiry.isValid()) return false;

  return !expiry.isAfter(dayjs(now));
};

/**
 * Why a stopped rule cannot be switched back on by its owner, or `undefined` when
 * it can. Only a rule the owner stopped themselves (or one with no recorded
 * reason) is theirs to resume; an administrator's decision, a lapsed DingTalk
 * identity and a closed automation tier are not, and the server refuses those too.
 *
 * A non-`user` reason wins over the expiry, matching the status chip; expiry is
 * the honest answer for everything else, since re-enabling would not make a rule
 * whose window has closed run again.
 */
export const enableBlockedReason = (
  rule: Pick<ApprovalRuleRow, 'disabledReason' | 'expiresAt'>,
  now: Date | number | string = Date.now(),
): ApprovalRuleDisabledReason | undefined => {
  const reason = rule.disabledReason;
  if (reason && reason !== 'user') return reason;
  if (isRuleExpired(rule.expiresAt, now)) return 'expired';

  return undefined;
};

/** Calendar day of a value in the rule timezone, or `''` when unusable. */
const ruleDay = (value: Date | number | string | null | undefined, tz: string): string => {
  if (!value) return '';
  // A bare `YYYY-MM-DD` is already a calendar day: converting it through a
  // timezone would shift it (local midnight east of Shanghai lands on the
  // previous day) and silently reset a counter that is still current.
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return value.trim();

  return format(value, 'YYYY-MM-DD', tz);
};

/**
 * Executions used today. The stored counter belongs to `dailyCountDate` and is
 * reset by the worker on its next run, so a counter from an earlier day must
 * read as 0 here — otherwise a rule looks exhausted the morning after it was.
 */
export const todayRunCount = (
  rule: Pick<ApprovalRuleRow, 'dailyCount' | 'dailyCountDate'>,
  now: Date | number | string = Date.now(),
  tz: string = APPROVAL_RULE_TIMEZONE,
): number => {
  const count = rule.dailyCount ?? 0;
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (ruleDay(rule.dailyCountDate, tz) !== ruleDay(now, tz)) return 0;

  return count;
};
