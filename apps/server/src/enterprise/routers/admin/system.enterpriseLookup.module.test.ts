// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEnterpriseErrorBody } from '../../guards/enterpriseErrors';
import type * as ModuleSettingsModule from '../../services/moduleSettings';
import {
  getEnterpriseLookupSettings,
  testEnterpriseLookupProviderHandler,
  updateEnterpriseLookupSettings,
} from './system.enterpriseLookup';

const serviceGet = vi.hoisted(() => vi.fn(async () => ({ configured: true })));
const serviceUpdate = vi.hoisted(() => vi.fn());
const testProvider = vi.hoisted(() => vi.fn());
const reauth = vi.hoisted(() => vi.fn());
const moduleOn = vi.hoisted(() => ({ value: true }));

vi.mock('../../services/moduleSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof ModuleSettingsModule>();
  return {
    ...actual,
    assertModuleEnabled: async (id: Parameters<typeof actual.assertModuleEnabled>[0]) => {
      if (moduleOn.value) return;
      const { throwEnterpriseError } = await import('../../guards/enterpriseErrors');
      throwEnterpriseError(actual.moduleDisabledError(id));
    },
  };
});

vi.mock('../../guards/reauth', () => ({
  assertDangerousReauthWithAudit: (...args: unknown[]) => reauth(...args),
}));

vi.mock('../../services/enterpriseLookup/settings', () => ({
  EnterpriseLookupSettingsService: class {
    get = serviceGet;
    update = serviceUpdate;
  },
  enterpriseLookupSecretChanged: vi.fn(),
  invalidateEnterpriseLookupRuntimeConfig: vi.fn(),
  summarizeEnterpriseLookupAfterDiff: vi.fn(),
  testEnterpriseLookupProvider: (...args: unknown[]) => testProvider(...args),
}));

const ctx = {
  authenticatedAt: new Date(),
  authMethod: 'password',
  serverDB: {},
  userId: 'user-1',
} as never;

const updateInput = {
  config: {},
  expectedRevision: 1,
  reason: 'rotate',
} as never;

const expectModuleDisabled = async (run: () => Promise<unknown>) => {
  try {
    await run();
    throw new Error('expected PLATFORM_MODULE_DISABLED');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected PLATFORM_MODULE_DISABLED') {
      throw error;
    }
    expect(getEnterpriseErrorBody(error)).toMatchObject({
      code: 'PLATFORM_MODULE_DISABLED',
      details: { moduleId: 'enterpriseLookup' },
    });
  }
};

describe('enterprise lookup admin module gate', () => {
  beforeEach(() => {
    moduleOn.value = true;
    serviceGet.mockClear();
    serviceUpdate.mockClear();
    testProvider.mockClear();
    reauth.mockClear();
  });

  it('returns PLATFORM_MODULE_DISABLED before any lookup work when the module is off', async () => {
    moduleOn.value = false;

    await expectModuleDisabled(() => getEnterpriseLookupSettings({ ctx }));
    await expectModuleDisabled(() => updateEnterpriseLookupSettings({ ctx, input: updateInput }));
    await expectModuleDisabled(() =>
      testEnterpriseLookupProviderHandler({ ctx, input: { provider: 'qcc' } as never }),
    );

    expect(serviceGet).not.toHaveBeenCalled();
    expect(serviceUpdate).not.toHaveBeenCalled();
    expect(testProvider).not.toHaveBeenCalled();
    expect(reauth).not.toHaveBeenCalled();
  });

  it('loads settings when the module is on', async () => {
    await expect(getEnterpriseLookupSettings({ ctx })).resolves.toEqual({ configured: true });
    expect(serviceGet).toHaveBeenCalledOnce();
  });
});
