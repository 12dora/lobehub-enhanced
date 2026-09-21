import { describe, expect, it } from 'vitest';

import type { AdminSystemEnterpriseLookupSettings } from '@/enterprise/client/services/adminSystem';
import {
  ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX,
  QCC_CATEGORIES,
} from '@/types/platform/enterpriseLookup';

import {
  enterpriseLookupDefaultProviderOptions,
  fingerprintEnterpriseLookupDraft,
  formatEnterpriseLookupTime,
  parseEnterpriseLookupDailyLimit,
  reconcileEnterpriseLookupDefaultProvider,
  resolveEnterpriseLookupProbeKey,
  settleEnterpriseLookupDraft,
  toEnterpriseLookupDraft,
  toEnterpriseLookupUpdateInput,
  validateEnterpriseLookupDraft,
} from './enterpriseLookupDraft';

const view = (
  overrides: Partial<AdminSystemEnterpriseLookupSettings['config']> = {},
  revision = 3,
): AdminSystemEnterpriseLookupSettings => ({
  config: {
    dailyLimitPerUser: 50,
    defaultProvider: 'qcc',
    fallbackEnabled: true,
    qcc: {
      apiKeyFingerprint: 'a1b2c3',
      apiKeyStored: true,
      categories: ['risk', 'company'],
      enabled: true,
    },
    tianyancha: { apiKeyStored: false, enabled: false },
    ...overrides,
  },
  revision,
  status: 'configured',
  updatedAt: null,
});

describe('toEnterpriseLookupDraft', () => {
  it('seeds write-only keys as stored-but-empty and never carries a plaintext value', () => {
    const draft = toEnterpriseLookupDraft(view());

    expect(draft.qccApiKey).toEqual({ cleared: false, stored: true, value: '' });
    expect(draft.tianyanchaApiKey).toEqual({ cleared: false, stored: false, value: '' });
    expect(draft.dailyLimitPerUser).toBe('50');
  });

  /** A reordered server answer must not read as an edit, so categories are canonically ordered. */
  it('normalises the category order, so the fingerprint is stable', () => {
    const a = toEnterpriseLookupDraft(
      view({ qcc: { apiKeyStored: true, categories: ['risk', 'company'], enabled: true } }),
    );
    const b = toEnterpriseLookupDraft(
      view({ qcc: { apiKeyStored: true, categories: ['company', 'risk'], enabled: true } }),
    );

    expect(a.qccCategories).toEqual(['company', 'risk']);
    expect(fingerprintEnterpriseLookupDraft(a)).toBe(fingerprintEnterpriseLookupDraft(b));
  });
});

describe('validateEnterpriseLookupDraft', () => {
  it('accepts the seeded configuration unchanged', () => {
    expect(validateEnterpriseLookupDraft(toEnterpriseLookupDraft(view()))).toEqual({});
  });

  it('demands a key for a provider that was just switched on', () => {
    const draft = { ...toEnterpriseLookupDraft(view()), tianyanchaEnabled: true };

    expect(validateEnterpriseLookupDraft(draft).tianyanchaApiKey).toBe('secretRequired');
    expect(
      validateEnterpriseLookupDraft({
        ...draft,
        tianyanchaApiKey: { cleared: false, stored: false, value: 'typed-now' },
      }).tianyanchaApiKey,
    ).toBeUndefined();
  });

  /** Clearing a stored key leaves an enabled provider with nothing to authenticate with. */
  it('treats an explicitly cleared key as missing', () => {
    const draft = toEnterpriseLookupDraft(view());

    expect(
      validateEnterpriseLookupDraft({
        ...draft,
        qccApiKey: { cleared: true, stored: true, value: '' },
      }).qccApiKey,
    ).toBe('secretRequired');
  });

  it('rejects a key longer than the contract allows', () => {
    const draft = toEnterpriseLookupDraft(view());

    expect(
      validateEnterpriseLookupDraft({
        ...draft,
        qccApiKey: { cleared: false, stored: true, value: 'k'.repeat(513) },
      }).qccApiKey,
    ).toBe('secretTooLong');
  });

  it('refuses an enabled 企查查 with no category to reach', () => {
    const draft = { ...toEnterpriseLookupDraft(view()), qccCategories: [] };

    expect(validateEnterpriseLookupDraft(draft).qccCategories).toBe('categoryRequired');
  });

  it('refuses a default provider that is not enabled', () => {
    const draft = { ...toEnterpriseLookupDraft(view()), defaultProvider: 'tianyancha' as const };

    expect(validateEnterpriseLookupDraft(draft).defaultProvider).toBe('defaultProvider');
  });

  /** Nothing is enabled, so no default can be wrong — the row is simply switched off. */
  it('does not fault the default provider while both providers are off', () => {
    const draft = {
      ...toEnterpriseLookupDraft(view()),
      qccEnabled: false,
      tianyanchaEnabled: false,
    };

    expect(validateEnterpriseLookupDraft(draft)).toEqual({});
  });

  it.each([
    ['', 'dailyLimit'],
    ['-1', 'dailyLimit'],
    ['1.5', 'dailyLimit'],
    ['10001', 'dailyLimit'],
    ['abc', 'dailyLimit'],
  ])('rejects the daily limit %s', (value, expected) => {
    const draft = { ...toEnterpriseLookupDraft(view()), dailyLimitPerUser: value };

    expect(validateEnterpriseLookupDraft(draft).dailyLimitPerUser).toBe(expected);
  });

  it('accepts 0 (unlimited) and the maximum', () => {
    const base = toEnterpriseLookupDraft(view());

    expect(validateEnterpriseLookupDraft({ ...base, dailyLimitPerUser: '0' })).toEqual({});
    expect(
      validateEnterpriseLookupDraft({
        ...base,
        dailyLimitPerUser: String(ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX),
      }),
    ).toEqual({});
    expect(parseEnterpriseLookupDailyLimit('0')).toBe(0);
  });
});

describe('default provider selection', () => {
  it('offers only enabled providers', () => {
    const draft = toEnterpriseLookupDraft(view());

    expect(enterpriseLookupDefaultProviderOptions(draft)).toEqual(['qcc']);
    expect(enterpriseLookupDefaultProviderOptions({ ...draft, tianyanchaEnabled: true })).toEqual([
      'qcc',
      'tianyancha',
    ]);
    expect(enterpriseLookupDefaultProviderOptions({ ...draft, qccEnabled: false })).toEqual([]);
  });

  /** Turning the current default off would otherwise store a default the server refuses. */
  it('moves the default onto the provider that is still enabled', () => {
    const draft = { ...toEnterpriseLookupDraft(view()), tianyanchaEnabled: true };
    const reconciled = reconcileEnterpriseLookupDefaultProvider({ ...draft, qccEnabled: false });

    expect(reconciled.defaultProvider).toBe('tianyancha');
  });

  it('leaves the stored default alone when nothing is enabled', () => {
    const draft = toEnterpriseLookupDraft(view());
    const reconciled = reconcileEnterpriseLookupDefaultProvider({ ...draft, qccEnabled: false });

    expect(reconciled.defaultProvider).toBe('qcc');
  });
});

describe('toEnterpriseLookupUpdateInput', () => {
  it('keeps a stored key, replaces a typed one, and clears an explicitly cleared one', () => {
    const draft = {
      ...toEnterpriseLookupDraft(view({ tianyancha: { apiKeyStored: true, enabled: true } })),
      qccApiKey: { cleared: false, stored: true, value: 'rotated' },
    };

    const input = toEnterpriseLookupUpdateInput(draft, 3);

    expect(input).toEqual({
      config: {
        dailyLimitPerUser: 50,
        defaultProvider: 'qcc',
        fallbackEnabled: true,
        qcc: {
          apiKey: { action: 'replace', value: 'rotated' },
          categories: ['company', 'risk'],
          enabled: true,
        },
        tianyancha: { apiKey: { action: 'keep' }, enabled: true },
      },
      expectedRevision: 3,
    });

    expect(
      toEnterpriseLookupUpdateInput(
        { ...draft, tianyanchaApiKey: { cleared: true, stored: true, value: '' } },
        3,
      ).config.tianyancha.apiKey,
    ).toEqual({ action: 'clear' });
  });

  it('sends the categories in canonical order, whatever order they were ticked in', () => {
    const draft = {
      ...toEnterpriseLookupDraft(view()),
      qccCategories: [...QCC_CATEGORIES].reverse(),
    };

    expect(toEnterpriseLookupUpdateInput(draft, 1).config.qcc.categories).toEqual([
      ...QCC_CATEGORIES,
    ]);
  });
});

describe('settleEnterpriseLookupDraft', () => {
  it('drops the plaintext and re-derives what the server now stores', () => {
    const settled = settleEnterpriseLookupDraft({
      ...toEnterpriseLookupDraft(view()),
      qccApiKey: { cleared: false, stored: false, value: 'typed-now' },
      tianyanchaApiKey: { cleared: true, stored: true, value: '' },
    });

    expect(settled.qccApiKey).toEqual({ cleared: false, stored: true, value: '' });
    expect(settled.tianyanchaApiKey).toEqual({ cleared: false, stored: false, value: '' });
  });
});

describe('formatEnterpriseLookupTime', () => {
  it('accepts both a Date and its ISO string, and reports nothing for an unusable value', () => {
    const iso = '2026-01-02T03:04:05.000Z';

    expect(formatEnterpriseLookupTime(new Date(iso))).toBe(formatEnterpriseLookupTime(iso));
    expect(formatEnterpriseLookupTime(null)).toBeNull();
    expect(formatEnterpriseLookupTime('not-a-date')).toBeNull();
  });
});

describe('resolveEnterpriseLookupProbeKey', () => {
  it.each([
    ['not_configured', 'notConfigured'],
    ['quota_exceeded', 'quotaExceeded'],
    ['timeout', 'timeout'],
    ['unauthorized', 'unauthorized'],
    ['unreachable', 'unreachable'],
  ] as const)('maps %s to its own short message', (reason, suffix) => {
    expect(resolveEnterpriseLookupProbeKey({ ok: false, reason })).toBe(
      `systemGeneral.enterpriseLookup.test.reason.${suffix}`,
    );
  });

  it('falls back to "could not connect" for a failure with no named reason', () => {
    expect(resolveEnterpriseLookupProbeKey({ ok: false })).toBe(
      'systemGeneral.enterpriseLookup.test.reason.unreachable',
    );
  });

  it('reports success on its own key', () => {
    expect(resolveEnterpriseLookupProbeKey({ ok: true, toolCount: 12 })).toBe(
      'systemGeneral.enterpriseLookup.test.success',
    );
  });
});
