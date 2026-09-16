/**
 * Reminder tasks (定时提醒 as tasks).
 *
 * A reminder is a regular task whose `config.reminder` is present. It is armed through the
 * task automation module (`automationMode='schedule'`, cron in Asia/Shanghai) and, when the
 * scheduler tick fires, is delivered deterministically (DingTalk work notice + 服务号 robot +
 * in-app bell) without running an agent. The task body (`instruction`) carries the recipients
 * as mention tokens on its first line, e.g. `@胡玉琴A·外贸组 @邵军军·业务部`, followed by a blank
 * line and the reminder text.
 */

export const REMINDER_TIMEZONE = 'Asia/Shanghai';

export type ReminderScheduleKind = 'once' | 'daily' | 'weekly' | 'monthly';

export interface ReminderScheduleInput {
  /** YYYY-MM-DD (Asia/Shanghai); required when kind is `once`. */
  date?: string;
  kind: ReminderScheduleKind;
  /** Day-of-month numbers 1-31; used when kind is `monthly`. */
  monthDays?: number[];
  /** HH:mm in Asia/Shanghai. */
  time: string;
  /** Inclusive end date YYYY-MM-DD for repeating reminders. */
  until?: string;
  /** Weekdays 1-7 (Monday = 1); used when kind is `weekly`. */
  weekdays?: number[];
}

/** Persisted under `tasks.config.reminder`. Presence marks the task as a reminder task. */
export interface TaskReminderConfig {
  kind: 'reminder';
  /** Complete the task after the first delivery (one-shot reminder). */
  once: boolean;
  /** `reminders.id` — the profile row holding content/recipients/delivery history. */
  reminderId: string;
  /** Structured schedule the cron was derived from (source of truth for re-interpretation). */
  schedule: ReminderScheduleInput;
  /** Human summary, e.g. `每天 09:00` / `每周一、三 09:00` / `2026-09-17 09:00 一次`. */
  scheduleSummary: string;
  /** Inclusive end date YYYY-MM-DD for repeats; null = indefinitely. */
  until?: string | null;
}

export type ReminderRecipientKind = 'department' | 'user';

/** A recipient resolved against the DingTalk directory mirror. */
export interface ResolvedReminderRecipient {
  deptId?: string;
  deptName: string;
  deptPath: string;
  displayName: string;
  kind: ReminderRecipientKind;
  memberCount?: number;
  staffId?: string;
}

export interface ReminderMentionToken {
  /** Department name after `·`, when given. */
  dept?: string;
  /** Person or department name right after `@`. */
  name: string;
  /** Raw token as written, e.g. `@胡玉琴A·外贸组`. */
  raw: string;
}

/**
 * Mention grammar: `@<name>` or `@<name>·<dept>` (U+00B7 middle dot), name/dept 1-32 chars
 * without whitespace, `@` or `·`. Tokens must start at the beginning of the text or after
 * whitespace so e-mail addresses are not mistaken for mentions.
 */
export const REMINDER_MENTION_REGEX = /(^|\s)@([^\s@·]{1,32})(?:·([^\s@·]{1,32}))?/g;

export const parseReminderMentions = (text: string): ReminderMentionToken[] => {
  const tokens: ReminderMentionToken[] = [];
  for (const match of text.matchAll(REMINDER_MENTION_REGEX)) {
    const [, , name, dept] = match;
    tokens.push({ dept: dept || undefined, name, raw: dept ? `@${name}·${dept}` : `@${name}` });
  }
  return tokens;
};

/** Remove every mention token from the text and normalise whitespace. */
export const stripReminderMentions = (text: string): string =>
  text
    .replaceAll(REMINDER_MENTION_REGEX, '$1')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

/** Canonical token for a resolved recipient: `@姓名·最小部门` or `@部门名`. */
export const formatReminderMentionToken = (recipient: ResolvedReminderRecipient): string => {
  if (recipient.kind === 'department') return `@${recipient.displayName}`;
  return recipient.deptName
    ? `@${recipient.displayName}·${recipient.deptName}`
    : `@${recipient.displayName}`;
};

/** Canonical body layout: mention line, blank line, content. */
export const buildReminderInstruction = (
  recipients: ResolvedReminderRecipient[],
  content: string,
): string => {
  const mentionLine = recipients.map(formatReminderMentionToken).join(' ');
  const body = content.trim();
  return mentionLine ? `${mentionLine}\n\n${body}` : body;
};

export const isReminderTaskConfig = (config: unknown): config is { reminder: TaskReminderConfig } =>
  !!config &&
  typeof config === 'object' &&
  (config as { reminder?: { kind?: string } }).reminder?.kind === 'reminder';
