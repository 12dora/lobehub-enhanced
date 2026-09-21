import { describe, expect, it } from 'vitest';

import {
  createDefaultEnterpriseLookupConfig,
  enterpriseLookupPersistedSchema,
  enterpriseLookupUpdateSchema,
  normalizeEnterpriseLookupConfig,
  QCC_DEFAULT_CATEGORIES,
} from './enterpriseLookup';

describe('enterpriseLookup types', () => {
  it('defaults are disabled with vendor category defaults', () => {
    const config = createDefaultEnterpriseLookupConfig();
    expect(enterpriseLookupPersistedSchema.parse(config)).toMatchObject({
      dailyLimitPerUser: 50,
      defaultProvider: 'qcc',
      fallbackEnabled: true,
      qcc: { enabled: false },
      tianyancha: { enabled: false },
    });
    expect(config.qcc.categories).toEqual(QCC_DEFAULT_CATEGORIES);
    expect(config.qcc.categories).not.toContain('history');
    expect(config.qcc.categories).not.toContain('document');
  });

  it('normalizes unknown JSON to defaults', () => {
    expect(normalizeEnterpriseLookupConfig(null).qcc.enabled).toBe(false);
    expect(normalizeEnterpriseLookupConfig({ extra: 1 }).defaultProvider).toBe('qcc');
    expect(
      normalizeEnterpriseLookupConfig({
        dailyLimitPerUser: 10,
        defaultProvider: 'tianyancha',
        fallbackEnabled: false,
        qcc: { enabled: true, categories: ['company'] },
        tianyancha: { enabled: true, apiKeyFingerprint: 'sha256:deadbeef' },
      }),
    ).toMatchObject({
      dailyLimitPerUser: 10,
      defaultProvider: 'tianyancha',
      fallbackEnabled: false,
      qcc: { categories: ['company'], enabled: true },
      tianyancha: { apiKeyFingerprint: 'sha256:deadbeef', enabled: true },
    });
  });

  it('rejects enabling a provider while clearing its key', () => {
    expect(
      enterpriseLookupUpdateSchema.safeParse({
        dailyLimitPerUser: 50,
        defaultProvider: 'qcc',
        fallbackEnabled: true,
        qcc: { apiKey: { action: 'clear' }, enabled: true },
        tianyancha: { enabled: false },
      }).success,
    ).toBe(false);
  });

  it('requires defaultProvider to be enabled when any provider is enabled', () => {
    expect(
      enterpriseLookupUpdateSchema.safeParse({
        dailyLimitPerUser: 50,
        defaultProvider: 'tianyancha',
        fallbackEnabled: true,
        qcc: { enabled: true, apiKey: { action: 'replace', value: 'k' } },
        tianyancha: { enabled: false },
      }).success,
    ).toBe(false);
    expect(
      enterpriseLookupUpdateSchema.safeParse({
        dailyLimitPerUser: 50,
        defaultProvider: 'qcc',
        fallbackEnabled: true,
        qcc: { enabled: true, apiKey: { action: 'replace', value: 'k' } },
        tianyancha: { enabled: false },
      }).success,
    ).toBe(true);
  });

  it('allows any defaultProvider when every provider is disabled', () => {
    expect(
      enterpriseLookupUpdateSchema.safeParse({
        dailyLimitPerUser: 0,
        defaultProvider: 'tianyancha',
        fallbackEnabled: false,
        qcc: { enabled: false },
        tianyancha: { enabled: false },
      }).success,
    ).toBe(true);
  });

  it('caps the per-user daily limit at 10000', () => {
    const base = {
      dailyLimitPerUser: 10_001,
      defaultProvider: 'qcc' as const,
      fallbackEnabled: true,
      qcc: { enabled: false },
      tianyancha: { enabled: false },
    };
    expect(enterpriseLookupUpdateSchema.safeParse(base).success).toBe(false);
    expect(enterpriseLookupUpdateSchema.safeParse({ ...base, dailyLimitPerUser: 0 }).success).toBe(
      true,
    );
  });
});
