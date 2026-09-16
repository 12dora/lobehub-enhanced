import { z } from 'zod';

/** Hard cap shared by tRPC `reminder.create` and the server tool runtime. */
export const MAX_REMINDER_RECIPIENTS = 50;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * Models often send `H:mm` or `HH:mm:ss`. Normalise to `HH:mm`; leave anything
 * else untouched so the HH:mm regex can still reject it.
 */
export const normalizeReminderClockTime = (value: string): string => {
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!match) return value.trim();
  const hour = Number.parseInt(match[1], 10);
  if (hour > 23) return value.trim();
  return `${pad2(hour)}:${match[2]}`;
};

const isDroppedScheduleField = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/** Drop empty strings / empty arrays (and nulls) so unused kind fields can be omitted. */
export const preprocessReminderSchedule = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (isDroppedScheduleField(field)) continue;
    next[key] =
      typeof field === 'string' && key === 'time' ? normalizeReminderClockTime(field) : field;
  }
  return next;
};

export const reminderTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');
export const reminderDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const reminderRecipientsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_REMINDER_RECIPIENTS);

const reminderScheduleObjectSchema = z
  .object({
    date: reminderDateSchema.optional(),
    kind: z.enum(['daily', 'monthly', 'once', 'weekly']),
    monthDays: z.array(z.number().int().min(1).max(31)).optional(),
    time: reminderTimeSchema,
    until: reminderDateSchema.optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  })
  .strict()
  .superRefine((schedule, ctx) => {
    if (schedule.kind === 'once' && !schedule.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date is required when kind is once',
        path: ['date'],
      });
    }
    if (schedule.kind === 'weekly' && !schedule.weekdays?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'weekdays is required when kind is weekly',
        path: ['weekdays'],
      });
    }
    if (schedule.kind === 'monthly' && !schedule.monthDays?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'monthDays is required when kind is monthly',
        path: ['monthDays'],
      });
    }
  });

/**
 * Kind-specific schedule: once → date, weekly → non-empty weekdays,
 * monthly → non-empty monthDays. Imported by both the tRPC router and the
 * server tool runtime so the two faces reject the same payloads.
 *
 * Preprocess drops empty strings / empty arrays (models often fill unused
 * fields) and normalises `H:mm` / `HH:mm:ss` to `HH:mm`.
 */
export const reminderScheduleSchema = z.preprocess(
  preprocessReminderSchedule,
  reminderScheduleObjectSchema,
);

const issuePath = (issue: z.ZodIssue): string =>
  issue.path.length > 0 ? issue.path.map(String).join('.') : 'schedule';

const isMissingTimeIssue = (issue: z.ZodIssue): boolean => {
  if (issue.path[0] !== 'time') return false;
  if (issue.code === z.ZodIssueCode.invalid_type) return true;
  return /required/i.test(issue.message);
};

/** Human tool error when `reminderScheduleSchema` fails (always mention the missing field). */
export const formatReminderScheduleParseError = (error: z.ZodError): string => {
  if (error.issues.some(isMissingTimeIssue)) {
    return 'Missing required field: schedule.time (HH:mm in Asia/Shanghai). Omit unused fields instead of sending empty strings or empty arrays.';
  }
  const details = error.issues.map((issue) => `${issuePath(issue)}: ${issue.message}`).join('; ');
  return `Invalid schedule: ${details}. Omit unused fields instead of sending empty strings or empty arrays.`;
};
