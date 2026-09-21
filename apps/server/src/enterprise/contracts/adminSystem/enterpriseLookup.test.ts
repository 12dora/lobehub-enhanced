import { describe, expect, it } from 'vitest';

import {
  adminSystemGetEnterpriseLookupSettingsOutputSchema,
  adminSystemTestEnterpriseLookupProviderInputSchema,
  adminSystemTestEnterpriseLookupProviderOutputSchema,
  adminSystemUpdateEnterpriseLookupSettingsInputSchema,
  normalizeEnterpriseLookupApiKey,
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

  it('normalizes a pasted Bearer prefix on replace and draft keys', () => {
    expect(
      adminSystemUpdateEnterpriseLookupSettingsInputSchema.parse({
        config: {
          ...enabledQcc,
          qcc: { ...enabledQcc.qcc, apiKey: { action: 'replace', value: 'Bearer qcc-key' } },
        },
        expectedRevision: 0,
      }),
    ).toMatchObject({
      config: { qcc: { apiKey: { action: 'replace', value: 'qcc-key' } } },
    });
    expect(
      adminSystemTestEnterpriseLookupProviderInputSchema.parse({
        draft: { apiKey: 'Authorization: Bearer draft-key' },
        provider: 'qcc',
      }),
    ).toEqual({
      draft: { apiKey: 'draft-key' },
      provider: 'qcc',
    });
  });

  it('rejects keys that are empty after stripping a Bearer prefix', () => {
    expect(
      adminSystemUpdateEnterpriseLookupSettingsInputSchema.safeParse({
        config: {
          ...enabledQcc,
          qcc: { ...enabledQcc.qcc, apiKey: { action: 'replace', value: 'Bearer   ' } },
        },
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      adminSystemUpdateEnterpriseLookupSettingsInputSchema.safeParse({
        config: {
          ...enabledQcc,
          qcc: { ...enabledQcc.qcc, apiKey: { action: 'replace', value: '' } },
        },
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      adminSystemTestEnterpriseLookupProviderInputSchema.safeParse({
        draft: { apiKey: '  Bearer  ' },
        provider: 'qcc',
      }).success,
    ).toBe(false);
  });
});

describe('normalizeEnterpriseLookupApiKey', () => {
  it('trims whitespace, wrapping quotes, Authorization labels, and Bearer tokens', () => {
    expect(normalizeEnterpriseLookupApiKey('  MMWW  ')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('"MMWW"')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey("'MMWW'")).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('`MMWW`')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('""MMWW""')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('Bearer MMWW')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('bearer MMWW')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('BEARER Bearer MMWW')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('Authorization: Bearer MMWW')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('authorization:bearer MMWW')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('"Authorization: Bearer MMWW"')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('Bearer "MMWW"')).toBe('MMWW');
    expect(normalizeEnterpriseLookupApiKey('  `Bearer  Bearer   MMWW`  ')).toBe('MMWW');
  });

  it('returns empty when only scheme/label/whitespace remain, and leaves a raw key alone', () => {
    expect(normalizeEnterpriseLookupApiKey('')).toBe('');
    expect(normalizeEnterpriseLookupApiKey('   ')).toBe('');
    expect(normalizeEnterpriseLookupApiKey('Bearer')).toBe('');
    expect(normalizeEnterpriseLookupApiKey('Bearer   ')).toBe('');
    expect(normalizeEnterpriseLookupApiKey('Authorization:')).toBe('');
    expect(normalizeEnterpriseLookupApiKey('""')).toBe('');
    expect(normalizeEnterpriseLookupApiKey('qcc-key')).toBe('qcc-key');
    expect(normalizeEnterpriseLookupApiKey('BearerMMWW')).toBe('BearerMMWW');
  });
});
