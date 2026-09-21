// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { QccCategory } from '@/types/platform/enterpriseLookup';

import { InfraSettingsSecretRequiredError } from '../infraSettings/errors';
import { probeProvider } from './mcpClient';
import {
  applyEnterpriseLookupUpdate,
  enterpriseLookupSecretChanged,
  fingerprintEnterpriseLookupApiKey,
  invalidateEnterpriseLookupRuntimeConfig,
  summarizeEnterpriseLookupAfterDiff,
  testEnterpriseLookupProvider,
  toEnterpriseLookupView,
} from './settings';

vi.mock('./mcpClient', () => ({
  invalidateEnterpriseLookupToolsCache: vi.fn(),
  probeProvider: vi.fn(async () => ({ ok: true, toolCount: 3 })),
}));

vi.mock('../infraSettings/secrets', () => ({
  openInfraSecret: vi.fn(async (ciphertext: string) => ciphertext.replace(/^sealed:/, '')),
  sealInfraSecret: vi.fn(async (plain: string) => `sealed:${plain}`),
}));

const qccEnable = {
  dailyLimitPerUser: 50,
  defaultProvider: 'qcc' as const,
  fallbackEnabled: true,
  qcc: {
    apiKey: { action: 'replace' as const, value: 'qcc-secret' },
    categories: ['company', 'risk'] as QccCategory[],
    enabled: true,
  },
  tianyancha: { enabled: false, apiKey: { action: 'keep' as const } },
};

describe('applyEnterpriseLookupUpdate', () => {
  it('seals a replace action and stores sha256: + first 8 hex fingerprint', async () => {
    const next = await applyEnterpriseLookupUpdate(undefined, qccEnable);
    expect(next.qcc.apiKeyCiphertext).toBe('sealed:qcc-secret');
    expect(next.qcc.apiKeyFingerprint).toBe(fingerprintEnterpriseLookupApiKey('qcc-secret'));
    expect(next.qcc.apiKeyFingerprint).toMatch(/^sha256:[0-9a-f]{8}$/);
    expect(next.qcc.categories).toEqual(['company', 'risk']);
    expect(next.tianyancha.enabled).toBe(false);
  });

  it('rejects enabling without a stored secret', async () => {
    await expect(
      applyEnterpriseLookupUpdate(undefined, {
        ...qccEnable,
        qcc: { ...qccEnable.qcc, apiKey: { action: 'keep' } },
      }),
    ).rejects.toBeInstanceOf(InfraSettingsSecretRequiredError);

    await expect(
      applyEnterpriseLookupUpdate(undefined, {
        ...qccEnable,
        qcc: { ...qccEnable.qcc, apiKey: { action: 'keep' } },
      }),
    ).rejects.toMatchObject({ field: 'qcc.apiKey' });
  });

  it('keeps the previous ciphertext and fingerprint on keep', async () => {
    const stored = await applyEnterpriseLookupUpdate(undefined, qccEnable);
    const next = await applyEnterpriseLookupUpdate(stored, {
      ...qccEnable,
      dailyLimitPerUser: 20,
      qcc: { ...qccEnable.qcc, apiKey: { action: 'keep' } },
    });
    expect(next.qcc.apiKeyCiphertext).toBe('sealed:qcc-secret');
    expect(next.qcc.apiKeyFingerprint).toBe(stored.qcc.apiKeyFingerprint);
    expect(next.dailyLimitPerUser).toBe(20);
  });

  it('clears a provider secret on disable', async () => {
    const stored = await applyEnterpriseLookupUpdate(undefined, qccEnable);
    const next = await applyEnterpriseLookupUpdate(stored, {
      dailyLimitPerUser: 50,
      defaultProvider: 'qcc',
      fallbackEnabled: true,
      qcc: { enabled: false, apiKey: { action: 'clear' } },
      tianyancha: { enabled: false, apiKey: { action: 'keep' } },
    });
    expect(next.qcc.apiKeyCiphertext).toBeUndefined();
    expect(next.qcc.apiKeyFingerprint).toBeUndefined();
    expect(next.qcc.enabled).toBe(false);
    expect(next.qcc.categories).toEqual(['company', 'risk']);
  });

  it('seals a tianyancha replace independently of qcc', async () => {
    const stored = await applyEnterpriseLookupUpdate(undefined, qccEnable);
    const next = await applyEnterpriseLookupUpdate(stored, {
      dailyLimitPerUser: 50,
      defaultProvider: 'qcc',
      fallbackEnabled: true,
      qcc: { enabled: true, apiKey: { action: 'keep' }, categories: ['company'] as QccCategory[] },
      tianyancha: { enabled: true, apiKey: { action: 'replace', value: 'tyc-secret' } },
    });
    expect(next.qcc.apiKeyCiphertext).toBe('sealed:qcc-secret');
    expect(next.tianyancha.apiKeyCiphertext).toBe('sealed:tyc-secret');
    expect(next.tianyancha.apiKeyFingerprint).toBe(fingerprintEnterpriseLookupApiKey('tyc-secret'));
  });

  it('strips a pasted Bearer prefix before sealing and fingerprinting both providers', async () => {
    const next = await applyEnterpriseLookupUpdate(undefined, {
      dailyLimitPerUser: 50,
      defaultProvider: 'qcc',
      fallbackEnabled: true,
      qcc: {
        apiKey: { action: 'replace', value: 'Bearer qcc-secret' },
        categories: ['company'] as QccCategory[],
        enabled: true,
      },
      tianyancha: {
        apiKey: { action: 'replace', value: 'Authorization: Bearer tyc-secret' },
        enabled: true,
      },
    });
    expect(next.qcc.apiKeyCiphertext).toBe('sealed:qcc-secret');
    expect(next.qcc.apiKeyFingerprint).toBe(fingerprintEnterpriseLookupApiKey('qcc-secret'));
    expect(next.tianyancha.apiKeyCiphertext).toBe('sealed:tyc-secret');
    expect(next.tianyancha.apiKeyFingerprint).toBe(fingerprintEnterpriseLookupApiKey('tyc-secret'));
    expect(JSON.stringify(next)).not.toContain('Bearer');
  });

  it('rejects a replace value that is empty after stripping Bearer', async () => {
    await expect(
      applyEnterpriseLookupUpdate(undefined, {
        ...qccEnable,
        qcc: { ...qccEnable.qcc, apiKey: { action: 'replace', value: 'Bearer   ' } },
      }),
    ).rejects.toBeInstanceOf(InfraSettingsSecretRequiredError);

    await expect(
      applyEnterpriseLookupUpdate(undefined, {
        ...qccEnable,
        qcc: { ...qccEnable.qcc, apiKey: { action: 'replace', value: 'Bearer   ' } },
      }),
    ).rejects.toMatchObject({ field: 'qcc.apiKey' });
  });
});

describe('testEnterpriseLookupProvider', () => {
  it('strips a pasted Bearer prefix from the draft key before probing', async () => {
    vi.mocked(probeProvider).mockClear();
    await expect(
      testEnterpriseLookupProvider({} as never, {
        draft: { apiKey: 'Bearer draft-key' },
        provider: 'qcc',
      }),
    ).resolves.toEqual({ ok: true, toolCount: 3 });
    expect(probeProvider).toHaveBeenCalledWith('qcc', 'draft-key');
    expect(probeProvider).toHaveBeenCalledTimes(1);
  });

  it('returns not_configured when the draft key is empty after normalization', async () => {
    vi.mocked(probeProvider).mockClear();
    await expect(
      testEnterpriseLookupProvider({} as never, {
        draft: { apiKey: '  Bearer  ' },
        provider: 'tianyancha',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_configured' });
    expect(probeProvider).not.toHaveBeenCalled();
  });
});

describe('view + afterDiff redaction', () => {
  it('fingerprints like the IM connector (sha256: + 8 hex)', () => {
    const secret = 'super-secret-key';
    const expected = `sha256:${createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8)}`;
    expect(fingerprintEnterpriseLookupApiKey(secret)).toBe(expected);
  });

  it('never includes ciphertext in the view or afterDiff', async () => {
    const config = await applyEnterpriseLookupUpdate(undefined, qccEnable);
    const view = toEnterpriseLookupView(config);
    expect(view.qcc.apiKeyStored).toBe(true);
    expect(view.qcc.apiKeyFingerprint).toBe(config.qcc.apiKeyFingerprint);
    expect(JSON.stringify(view)).not.toContain('ciphertext');
    expect(JSON.stringify(view)).not.toContain('qcc-secret');
    expect(JSON.stringify(view)).not.toContain('sealed:');

    const diff = summarizeEnterpriseLookupAfterDiff(
      config,
      enterpriseLookupSecretChanged(undefined, config),
    );
    expect(diff).toEqual({
      dailyLimitPerUser: 50,
      defaultProvider: 'qcc',
      fallbackEnabled: true,
      qccCategories: ['company', 'risk'],
      qccEnabled: true,
      qccSecretChanged: true,
      tianyanchaEnabled: false,
      tianyanchaSecretChanged: false,
    });
    expect(JSON.stringify(diff)).not.toContain('sealed');
    expect(JSON.stringify(diff)).not.toContain('qcc-secret');
    expect(JSON.stringify(diff)).not.toContain('fingerprint');
  });
});

describe('invalidateEnterpriseLookupRuntimeConfig', () => {
  it('clears provider unhealthy cooldown and the tools/list cache', async () => {
    const { invalidateEnterpriseLookupToolsCache } = await import('./mcpClient');
    const { isProviderUnhealthy, markProviderUnhealthy, resetEnterpriseLookupHealthForTest } =
      await import('./health');

    markProviderUnhealthy('qcc');
    expect(isProviderUnhealthy('qcc')).toBe(true);

    invalidateEnterpriseLookupRuntimeConfig();

    expect(isProviderUnhealthy('qcc')).toBe(false);
    expect(invalidateEnterpriseLookupToolsCache).toHaveBeenCalled();
    resetEnterpriseLookupHealthForTest();
  });
});
