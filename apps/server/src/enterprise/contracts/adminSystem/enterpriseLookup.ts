import { z } from 'zod';

import {
  ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX,
  enterpriseLookupAdminConfigViewSchema,
  enterpriseLookupProviderSchema,
  enterpriseLookupSettingsStatusSchema,
  QCC_CATEGORIES,
} from '@/types/platform/enterpriseLookup';

import { reasonSchema } from './common';

/**
 * Strip copy-paste artifacts from a vendor API key: trim, wrapping
 * quotes/backticks, a leading `Authorization:` label, and one or more
 * leading case-insensitive `Bearer` scheme tokens. Never log `input`.
 */
export const normalizeEnterpriseLookupApiKey = (input: string): string => {
  let value = input;
  for (let i = 0; i < 8; i += 1) {
    let next = value.trim();
    if (next.length >= 2) {
      const quote = next[0];
      if ((quote === '"' || quote === "'" || quote === '`') && next.at(-1) === quote) {
        next = next.slice(1, -1);
      }
    }
    next = next.replace(/^Authorization\s*:\s*/i, '');
    next = next.replace(/^(?:Bearer(?:\s+|$))+/i, '');
    if (next === value) return next;
    value = next;
  }
  return value.trim();
};

const enterpriseLookupApiKeyValueSchema = z
  .string()
  .min(1)
  .max(512)
  .transform(normalizeEnterpriseLookupApiKey)
  .pipe(z.string().min(1).max(512));

const enterpriseLookupSecretActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
  z
    .object({
      action: z.literal('replace'),
      value: enterpriseLookupApiKeyValueSchema,
    })
    .strict(),
]);

export const adminSystemEnterpriseLookupConfigSchema = z
  .object({
    dailyLimitPerUser: z.number().int().min(0).max(ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX),
    defaultProvider: enterpriseLookupProviderSchema,
    fallbackEnabled: z.boolean(),
    qcc: z
      .object({
        apiKey: enterpriseLookupSecretActionSchema.default({ action: 'keep' }),
        categories: z.array(z.enum(QCC_CATEGORIES)).max(QCC_CATEGORIES.length).optional(),
        enabled: z.boolean(),
      })
      .strict(),
    tianyancha: z
      .object({
        apiKey: enterpriseLookupSecretActionSchema.default({ action: 'keep' }),
        enabled: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.qcc.enabled && value.qcc.apiKey.action === 'clear') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'qcc.apiKey cannot be cleared while the provider is enabled',
        path: ['qcc', 'apiKey'],
      });
    }
    if (value.tianyancha.enabled && value.tianyancha.apiKey.action === 'clear') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tianyancha.apiKey cannot be cleared while the provider is enabled',
        path: ['tianyancha', 'apiKey'],
      });
    }
    if (value.qcc.enabled && value.qcc.categories && value.qcc.categories.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'qcc.categories must contain at least one category when enabled',
        path: ['qcc', 'categories'],
      });
    }
    if (value.qcc.categories) {
      const unique = new Set(value.qcc.categories);
      if (unique.size !== value.qcc.categories.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'qcc.categories must be unique',
          path: ['qcc', 'categories'],
        });
      }
    }
    const anyEnabled = value.qcc.enabled || value.tianyancha.enabled;
    if (!anyEnabled) return;
    if (value.defaultProvider === 'qcc' && !value.qcc.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'defaultProvider must be an enabled provider',
        path: ['defaultProvider'],
      });
    }
    if (value.defaultProvider === 'tianyancha' && !value.tianyancha.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'defaultProvider must be an enabled provider',
        path: ['defaultProvider'],
      });
    }
  });

export const adminSystemGetEnterpriseLookupSettingsOutputSchema = z
  .object({
    config: enterpriseLookupAdminConfigViewSchema,
    revision: z.number().int().nonnegative(),
    status: enterpriseLookupSettingsStatusSchema,
    updatedAt: z.date().nullable(),
  })
  .strict();

export const adminSystemUpdateEnterpriseLookupSettingsInputSchema = z
  .object({
    config: adminSystemEnterpriseLookupConfigSchema,
    expectedRevision: z.number().int().nonnegative(),
    reason: reasonSchema.optional(),
  })
  .strict();

export const adminSystemUpdateEnterpriseLookupSettingsOutputSchema =
  adminSystemGetEnterpriseLookupSettingsOutputSchema;

export const adminSystemTestEnterpriseLookupProviderInputSchema = z
  .object({
    draft: z
      .object({
        apiKey: enterpriseLookupApiKeyValueSchema.optional(),
      })
      .strict()
      .optional(),
    provider: enterpriseLookupProviderSchema,
  })
  .strict();

export const adminSystemTestEnterpriseLookupProviderOutputSchema = z
  .object({
    ok: z.boolean(),
    reason: z
      .enum(['not_configured', 'quota_exceeded', 'timeout', 'unauthorized', 'unreachable'])
      .optional(),
    toolCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export type AdminSystemEnterpriseLookupConfig = z.input<
  typeof adminSystemEnterpriseLookupConfigSchema
>;
export type AdminSystemGetEnterpriseLookupSettings = z.infer<
  typeof adminSystemGetEnterpriseLookupSettingsOutputSchema
>;
export type AdminSystemUpdateEnterpriseLookupSettingsInput = z.input<
  typeof adminSystemUpdateEnterpriseLookupSettingsInputSchema
>;
export type AdminSystemUpdateEnterpriseLookupSettingsOutput = z.infer<
  typeof adminSystemUpdateEnterpriseLookupSettingsOutputSchema
>;
export type AdminSystemTestEnterpriseLookupProviderInput = z.input<
  typeof adminSystemTestEnterpriseLookupProviderInputSchema
>;
export type AdminSystemTestEnterpriseLookupProviderOutput = z.infer<
  typeof adminSystemTestEnterpriseLookupProviderOutputSchema
>;
