// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AdminEnterpriseLookupSettingsService,
  AdminSystemEnterpriseLookupSettings,
} from '@/enterprise/client/services/adminSystem';

import { useEnterpriseLookupEditor } from './useEnterpriseLookupEditor';

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({ authMethod: 'password', permissions: [] }),
}));

vi.mock('../../primitives/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock('../../primitives/runAdminMutation', () => ({
  runAdminMutation: async ({
    onError,
    run,
  }: {
    onError?: (error: unknown) => Promise<void> | void;
    run: () => Promise<void>;
  }) => {
    try {
      await run();
      return true;
    } catch (error) {
      await onError?.(error);
      return false;
    }
  },
}));

vi.mock('./invalidate', () => ({
  invalidateAdminEnterpriseLookupSettings: () => Promise.resolve(),
}));

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
      categories: ['company', 'risk'],
      enabled: true,
    },
    tianyancha: { apiKeyStored: false, enabled: false },
    ...overrides,
  },
  revision,
  status: 'configured',
  updatedAt: null,
});

const setup = (
  initial: AdminSystemEnterpriseLookupSettings,
  overrides: Partial<AdminEnterpriseLookupSettingsService> = {},
) => {
  const service: AdminEnterpriseLookupSettingsService = {
    getEnterpriseLookupSettings: vi.fn(),
    testEnterpriseLookupProvider: vi.fn().mockResolvedValue({ ok: true, toolCount: 9 }),
    updateEnterpriseLookupSettings: vi.fn().mockResolvedValue(view({}, 9)),
    ...overrides,
  };
  const rendered = renderHook(
    ({ current }: { current: AdminSystemEnterpriseLookupSettings }) =>
      useEnterpriseLookupEditor({ canOperate: true, service, view: current }),
    { initialProps: { current: initial } },
  );
  return { ...rendered, service };
};

describe('useEnterpriseLookupEditor', () => {
  it('never lets a background snapshot overwrite a dirty draft, and says the server moved', () => {
    const { rerender, result } = setup(view());

    act(() => result.current.patch({ dailyLimitPerUser: '200' }));
    expect(result.current.dirty).toBe(true);

    rerender({ current: view({ dailyLimitPerUser: 10 }, 7) });

    expect(result.current.draft.dailyLimitPerUser).toBe('200');
    expect(result.current.stale).toBe(true);
  });

  /**
   * Discarding goes to the CURRENT snapshot, not the baseline the draft started from: the stale one
   * would show values the server no longer holds, still behind the reload banner.
   */
  it('discards onto the current snapshot and adopts its revision', async () => {
    const { rerender, result, service } = setup(view());

    act(() => result.current.patch({ dailyLimitPerUser: '200' }));
    rerender({ current: view({ dailyLimitPerUser: 10 }, 7) });

    act(() => result.current.cancelEdit());

    expect(result.current.draft.dailyLimitPerUser).toBe('10');
    expect(result.current.dirty).toBe(false);
    expect(result.current.stale).toBe(false);

    act(() => result.current.patch({ dailyLimitPerUser: '80' }));
    await act(async () => {
      await result.current.save();
    });

    expect(service.updateEnterpriseLookupSettings).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 7 }),
    );
  });

  it('keeps the plaintext key for exactly one request and reports it as stored afterwards', async () => {
    const { result } = setup(view({ tianyancha: { apiKeyStored: false, enabled: true } }));

    act(() =>
      result.current.patch({
        tianyanchaApiKey: { cleared: false, stored: false, value: 'typed-now' },
      }),
    );
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.draft.tianyanchaApiKey).toEqual({
      cleared: false,
      stored: true,
      value: '',
    });
    expect(result.current.saveCount).toBe(1);
  });

  it('turns a CAS rejection into a reload offer rather than a retry', async () => {
    const { result } = setup(view(), {
      updateEnterpriseLookupSettings: vi
        .fn()
        .mockRejectedValue({ data: { errorData: { code: 'PLATFORM_REVISION_CONFLICT' } } }),
    });

    act(() => result.current.patch({ dailyLimitPerUser: '80' }));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.conflict).toBe(true);
    expect(result.current.saveCount).toBe(0);
  });

  it('blocks a save that the server would reject, and marks the field', async () => {
    const { result, service } = setup(view());

    act(() => result.current.patch({ tianyanchaEnabled: true }));
    await act(async () => {
      await result.current.save();
    });

    expect(service.updateEnterpriseLookupSettings).not.toHaveBeenCalled();
    expect(result.current.errors.tianyanchaApiKey).toBe(
      'systemGeneral.enterpriseLookup.errors.secretRequired',
    );
  });

  /** The card asks per provider, so one unhealthy provider must not hide the other's answer. */
  it('keeps one probe result per provider', async () => {
    const testEnterpriseLookupProvider = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, toolCount: 9 })
      .mockResolvedValueOnce({ ok: false, reason: 'unauthorized' });
    const { result } = setup(view({ tianyancha: { apiKeyStored: true, enabled: true } }), {
      testEnterpriseLookupProvider,
    });

    await act(async () => {
      await result.current.test('qcc');
    });
    await act(async () => {
      await result.current.test('tianyancha');
    });

    expect(result.current.probes.qcc).toEqual({ ok: true, toolCount: 9 });
    expect(result.current.probes.tianyancha).toEqual({ ok: false, reason: 'unauthorized' });
    // Stored keys, nothing typed — the probe must not carry a draft key it does not have.
    expect(testEnterpriseLookupProvider).toHaveBeenNthCalledWith(1, { provider: 'qcc' });
  });

  it('reports 未配置 locally instead of spending a round trip on a keyless provider', async () => {
    const testEnterpriseLookupProvider = vi.fn();
    const { result } = setup(view(), { testEnterpriseLookupProvider });

    await act(async () => {
      await result.current.test('tianyancha');
    });

    expect(testEnterpriseLookupProvider).not.toHaveBeenCalled();
    expect(result.current.probes.tianyancha).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('never surfaces a raw upstream failure — a rejected probe is simply not a connection', async () => {
    const { result } = setup(view(), {
      testEnterpriseLookupProvider: vi.fn().mockRejectedValue(new Error('ECONNRESET at 10.0.0.1')),
    });

    await act(async () => {
      await result.current.test('qcc');
    });

    expect(result.current.probes.qcc).toEqual({ ok: false, reason: 'unreachable' });
  });
});
