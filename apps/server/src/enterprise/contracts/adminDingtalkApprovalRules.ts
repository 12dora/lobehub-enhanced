import { z } from 'zod';

export const adminDingtalkApprovalRulesListInputSchema = z
  .object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict();
export type AdminDingtalkApprovalRulesListInput = z.infer<
  typeof adminDingtalkApprovalRulesListInputSchema
>;

export const adminApprovalRuleConditionsSchema = z
  .object({
    fields: z
      .array(
        z
          .object({
            componentId: z.string(),
            label: z.string(),
            op: z.enum(['contains', 'eq', 'gt', 'gte', 'in', 'lt', 'lte', 'ne']),
            value: z.union([z.string(), z.number(), z.array(z.string())]),
          })
          .strict(),
      )
      .optional(),
    match: z.literal('all'),
    originators: z
      .object({
        deptIds: z.array(z.string()).optional(),
        staffIds: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const adminDingtalkApprovalRuleItemSchema = z
  .object({
    action: z.enum(['agree', 'comment', 'redirect', 'refuse']),
    conditions: adminApprovalRuleConditionsSchema,
    createdAt: z.string(),
    dailyCount: z.number().int().nonnegative(),
    dailyCountDate: z.string().nullable(),
    disabledReason: z.enum(['admin', 'expired', 'identity_invalid', 'tier_off', 'user']).nullable(),
    enabled: z.boolean(),
    expiresAt: z.string().nullable(),
    id: z.string(),
    lastRunAt: z.string().nullable(),
    name: z.string(),
    originatorLabels: z.record(z.string(), z.string()),
    processCode: z.string(),
    processName: z.string(),
    redirectToName: z.string().nullable(),
    staffId: z.string(),
    updatedAt: z.string(),
    userDisplayName: z.string().nullable(),
    userEmail: z.string().nullable(),
    userId: z.string(),
  })
  .strict();
export type AdminDingtalkApprovalRuleItem = z.infer<typeof adminDingtalkApprovalRuleItemSchema>;

export const adminDingtalkApprovalRulesListOutputSchema = z
  .object({
    items: z.array(adminDingtalkApprovalRuleItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type AdminDingtalkApprovalRulesListOutput = z.infer<
  typeof adminDingtalkApprovalRulesListOutputSchema
>;

export const adminDingtalkApprovalRulesDisableInputSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
    ruleId: z.string().min(1),
  })
  .strict();
export type AdminDingtalkApprovalRulesDisableInput = z.infer<
  typeof adminDingtalkApprovalRulesDisableInputSchema
>;

export const adminDingtalkApprovalRulesDisableOutputSchema = adminDingtalkApprovalRuleItemSchema;
export type AdminDingtalkApprovalRulesDisableOutput = AdminDingtalkApprovalRuleItem;
