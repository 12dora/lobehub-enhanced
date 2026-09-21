import { describe, expect, it } from 'vitest';

import {
  adminSystemGetEnterpriseLookupSettingsOutputSchema,
  adminSystemTestEnterpriseLookupProviderInputSchema,
  adminSystemTestEnterpriseLookupProviderOutputSchema,
  adminSystemUpdateEnterpriseLookupSettingsInputSchema,
} from './enterpriseLookup';

const enabledQcc = {
  dailyLimitPerUser: 50,
  defaultProvider: 'qcc' as const,
  fallbackEnabled: true,
  qcc: {
    apiKey: { action: 'replace' as const, value: 'qcc-key' },
    categories: ['company', 'risk'] as const,
    enabled: true,
  },
  tianyancha: { enabled: false },
};

describe('admin system enterprise-lookup contracts', () => {
  it('accepts a write-only get view and rejects ciphertext fields', () => {
    const view = {
      config: {
        dailyLimitPerUser: 50,
        defaultProvider: 'qcc',
        fallbackEnabled: true,
        qcc: {
          apiKeyFingerprint: 'sha256:deadbeef',
          apiKeyStored: true,
          categories: ['company'],
          enabled: true,
        },
        tianyancha: { apiKeyStored: false, enabled: false },
      },
      revision: 1,
      status: 'configured',
      updatedAt: new Date('2026-09-21T00:00:00.000Z'),
    };
    expect(adminSystemGetEnterpriseLookupSettingsOutputSchema.parse(view)).toEqual(view);
    expect(
      adminSystemGetEnterpriseLookupSettingsOutputSchema.safeParse({
        ...view,
        config: {
          ...view.config,
          qcc: { ...view.config.qcc, apiKeyCiphertext: 'sealed' },
        },
      }).success,
    ).toBe(false);
    expect(
      adminSystemGetEnterpriseLookupSettingsOutputSchema.safeParse({
        ...view,
        config: {
          ...view.config,
          qcc: { ...view.config.qcc, apiKey: 'plaintext' },
        },
      }).success,
    ).toBe(false);
  });

  it('requires an enabled defaultProvider and a replace/keep key when enabling', () => {
    expect(
      adminSystemUpdateEnterpriseLookupSettingsInputSchema.parse({
        config: enabledQcc,
        expectedRevision: 0,
      }),
    ).toMatchObject({
      config: {
        qcc: { apiKey: { action: 'replace', value: 'qcc-key' }, enabled: true },
      },
      expectedRevision: 0,
    });
    expect(
      adminSystemUpdateEnterpriseLookupSettingsInputSchema.safeParse({
        config: {
          ...enabledQcc,
          defaultProvider: 'tianyancha',
        },
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      adminSystemUpdateEnterpriseLookupSettingsInputSchema.safeParse({
        config: {
          ...enabledQcc,
          qcc: { ...enabledQcc.qcc, apiKey: { action: 'clear' } },
        },
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts a draft-key probe and a bounded failure reason', () => {
    expect(
      adminSystemTestEnterpriseLookupProviderInputSchema.parse({
        draft: { apiKey: 'draft-key' },
        provider: 'qcc',
      }),
    ).toEqual({
      draft: { apiKey: 'draft-key' },
      provider: 'qcc',
    });
    expect(
      adminSystemTestEnterpriseLookupProviderInputSchema.safeParse({
        provider: 'qcc',
        reason: 'probe',
      }).success,
    ).toBe(false);
    expect(
      adminSystemTestEnterpriseLookupProviderOutputSchema.parse({
        ok: false,
        reason: 'unauthorized',
      }),
    ).toEqual({ ok: false, reason: 'unauthorized' });
    expect(
      adminSystemTestEnterpriseLookupProviderOutputSchema.safeParse({
        ok: false,
        reason: 'stack trace at secret',
      }).success,
    ).toBe(false);
  });
});
