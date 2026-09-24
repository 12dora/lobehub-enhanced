import { z } from 'zod';

import {
  statusAlertRobotSecretInputSchema,
  statusAlertRobotWebhookInputSchema,
  type StatusAlertSettings,
  statusAlertSettingsSchema,
} from '@/types/platform/statusAlerts';

export const adminStatusAlertChannelSchema = z.enum(['workNotice', 'dingtalkRobot', 'email']);

export const adminStatusAlertsRecipientUserSchema = z
  .object({
    avatar: z.string().nullable(),
    /** True when the account is banned. Listed, but never receives a work notice. */
    banned: z.boolean(),
    dingtalkBound: z.boolean(),
    id: z.string(),
    name: z.string(),
  })
  .strict();

export const adminStatusAlertsDingtalkRobotWebhookSchema = z
  .object({
    hint: z.string().nullable(),
    set: z.boolean(),
  })
  .strict();

export const adminStatusAlertsViewSchema = z
  .object({
    dingtalkRobotSecretSet: z.boolean(),
    dingtalkRobotWebhook: adminStatusAlertsDingtalkRobotWebhookSchema,
    effectiveDingtalkApiDailyThreshold: z.number().int().nonnegative(),
    envDisabled: z.boolean(),
    mailConfigured: z.boolean(),
    notifyAppConfigured: z.boolean(),
    recipientUsers: z.array(adminStatusAlertsRecipientUserSchema),
    revision: z.number().int().nonnegative(),
    settings: statusAlertSettingsSchema,
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const adminSystemAlertsGetOutputSchema = adminStatusAlertsViewSchema;

export const adminSystemAlertsUpdateInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    robotSecret: statusAlertRobotSecretInputSchema.optional(),
    robotWebhook: statusAlertRobotWebhookInputSchema.optional(),
    settings: statusAlertSettingsSchema,
  })
  .strict();

export const adminSystemAlertsUpdateOutputSchema = adminStatusAlertsViewSchema;

export const adminSystemAlertsTestInputSchema = z
  .object({
    channel: adminStatusAlertChannelSchema,
  })
  .strict();

export const adminSystemAlertsTestOutputSchema = z
  .object({
    delivered: z.number().int().nonnegative(),
    error: z.string().nullable(),
    ok: z.boolean(),
  })
  .strict();

export type AdminStatusAlertsView = z.infer<typeof adminStatusAlertsViewSchema>;
export type AdminSystemAlertsUpdateInput = z.infer<typeof adminSystemAlertsUpdateInputSchema>;
export type AdminStatusAlertChannel = z.infer<typeof adminStatusAlertChannelSchema>;
export type AdminSystemAlertsTestOutput = z.infer<typeof adminSystemAlertsTestOutputSchema>;
export type { StatusAlertSettings };
