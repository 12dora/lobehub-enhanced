import { z } from 'zod';

export const ENTERPRISE_LOOKUP_INFRA_SETTINGS_ID = 'enterprise_lookup' as const;

export const ENTERPRISE_LOOKUP_PROVIDERS = ['qcc', 'tianyancha'] as const;
export type EnterpriseLookupProvider = (typeof ENTERPRISE_LOOKUP_PROVIDERS)[number];

export const QCC_CATEGORIES = [
  'company',
  'risk',
  'ipr',
  'operation',
  'executive',
  'regulation',
  'case',
  'tender',
  'history',
  'document',
] as const;
export type QccCategory = (typeof QCC_CATEGORIES)[number];

/** Vendor default: every QCC category except `history` (实名认证) and `document`. */
export const QCC_DEFAULT_CATEGORIES: QccCategory[] = QCC_CATEGORIES.filter(
  (category) => category !== 'history' && category !== 'document',
);

export const ENTERPRISE_LOOKUP_DAILY_LIMIT_DEFAULT = 50;
export const ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX = 10_000;

const enterpriseLookupSecretActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
  z
    .object({
      action: z.literal('replace'),
      value: z.string().min(1).max(512),
    })
    .strict(),
]);
export type EnterpriseLookupSecretAction = z.infer<typeof enterpriseLookupSecretActionSchema>;

export const enterpriseLookupProviderSchema = z.enum(ENTERPRISE_LOOKUP_PROVIDERS);
export const qccCategorySchema = z.enum(QCC_CATEGORIES);

export const enterpriseLookupQccPersistedSchema = z
  .object({
    apiKeyCiphertext: z.string().min(1).optional(),
    apiKeyFingerprint: z.string().min(1).optional(),
    categories: z.array(qccCategorySchema).max(QCC_CATEGORIES.length),
    enabled: z.boolean(),
  })
  .strict();
export type EnterpriseLookupQccPersisted = z.infer<typeof enterpriseLookupQccPersistedSchema>;

export const enterpriseLookupTianyanchaPersistedSchema = z
  .object({
    apiKeyCiphertext: z.string().min(1).optional(),
    apiKeyFingerprint: z.string().min(1).optional(),
    enabled: z.boolean(),
  })
  .strict();
export type EnterpriseLookupTianyanchaPersisted = z.infer<
  typeof enterpriseLookupTianyanchaPersistedSchema
>;

export const enterpriseLookupPersistedSchema = z
  .object({
    dailyLimitPerUser: z.number().int().min(0).max(ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX),
    defaultProvider: enterpriseLookupProviderSchema,
    fallbackEnabled: z.boolean(),
    qcc: enterpriseLookupQccPersistedSchema,
    tianyancha: enterpriseLookupTianyanchaPersistedSchema,
  })
  .strict();
export type EnterpriseLookupPersistedConfig = z.infer<typeof enterpriseLookupPersistedSchema>;

/** Decrypted runtime projection — only enabled providers that have a key. */
export interface EnterpriseLookupRuntimeConfig {
  dailyLimitPerUser: number;
  defaultProvider: EnterpriseLookupProvider;
  fallbackEnabled: boolean;
  qcc?: { apiKey: string; categories: QccCategory[] };
  tianyancha?: { apiKey: string };
}

export const enterpriseLookupAdminQccViewSchema = z
  .object({
    apiKeyFingerprint: z.string().min(1).optional(),
    apiKeyStored: z.boolean(),
    categories: z.array(qccCategorySchema).max(QCC_CATEGORIES.length),
    enabled: z.boolean(),
  })
  .strict();

export const enterpriseLookupAdminTianyanchaViewSchema = z
  .object({
    apiKeyFingerprint: z.string().min(1).optional(),
    apiKeyStored: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();

export const enterpriseLookupAdminConfigViewSchema = z
  .object({
    dailyLimitPerUser: z.number().int().min(0).max(ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX),
    defaultProvider: enterpriseLookupProviderSchema,
    fallbackEnabled: z.boolean(),
    qcc: enterpriseLookupAdminQccViewSchema,
    tianyancha: enterpriseLookupAdminTianyanchaViewSchema,
  })
  .strict();
export type EnterpriseLookupAdminConfigView = z.infer<typeof enterpriseLookupAdminConfigViewSchema>;

export const enterpriseLookupSettingsStatusSchema = z.enum(['configured', 'not_configured']);
export type EnterpriseLookupSettingsStatus = z.infer<typeof enterpriseLookupSettingsStatusSchema>;

export const enterpriseLookupUpdateSchema = z
  .object({
    dailyLimitPerUser: z.number().int().min(0).max(ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX),
    defaultProvider: enterpriseLookupProviderSchema,
    fallbackEnabled: z.boolean(),
    qcc: z
      .object({
        apiKey: enterpriseLookupSecretActionSchema.default({ action: 'keep' }),
        categories: z.array(qccCategorySchema).max(QCC_CATEGORIES.length).optional(),
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
export type EnterpriseLookupUpdate = z.input<typeof enterpriseLookupUpdateSchema>;

export const createDefaultEnterpriseLookupConfig = (): EnterpriseLookupPersistedConfig => ({
  dailyLimitPerUser: ENTERPRISE_LOOKUP_DAILY_LIMIT_DEFAULT,
  defaultProvider: 'qcc',
  fallbackEnabled: true,
  qcc: {
    categories: [...QCC_DEFAULT_CATEGORIES],
    enabled: false,
  },
  tianyancha: { enabled: false },
});

export const normalizeEnterpriseLookupConfig = (raw: unknown): EnterpriseLookupPersistedConfig => {
  const defaults = createDefaultEnterpriseLookupConfig();
  if (!raw || typeof raw !== 'object') return defaults;
  const input = raw as Record<string, unknown>;
  const qccRaw = input.qcc && typeof input.qcc === 'object' ? input.qcc : {};
  const tianyanchaRaw =
    input.tianyancha && typeof input.tianyancha === 'object' ? input.tianyancha : {};
  const parsed = enterpriseLookupPersistedSchema.safeParse({
    ...defaults,
    ...input,
    qcc: { ...defaults.qcc, ...qccRaw },
    tianyancha: { ...defaults.tianyancha, ...tianyanchaRaw },
  });
  return parsed.success ? parsed.data : defaults;
};
