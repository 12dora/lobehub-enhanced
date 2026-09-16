import { z } from 'zod';

/** Hard cap shared by tRPC `reminder.create` and the server tool runtime. */
export const MAX_REMINDER_RECIPIENTS = 50;

export const reminderTimeSchema = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'HH:mm');
export const reminderDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const reminderRecipientsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_REMINDER_RECIPIENTS);

/**
 * Kind-specific schedule: once → date, weekly → non-empty weekdays,
 * monthly → non-empty monthDays. Imported by both the tRPC router and the
 * server tool runtime so the two faces reject the same payloads.
 */
export const reminderScheduleSchema = z
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
