// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdentityProviderValidationError } from './discoveryValidator';
import type { IdentityProviderStartupSnapshot } from './startupArtifact';
import {
  IDENTITY_PROVIDER_BACKGROUND_REVALIDATION_INTERVAL_MS,
  IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS,
  isIdentityProviderBackgroundRevalidationScheduled,
  retryOnTransientDiscoveryError,
  scheduleIdentityProviderBackgroundRevalidation,
  stopIdentityProviderBackgroundRevalidation,
} from './startupSnapshotDiscoveryRetry';

const healthySnapshot = {
  databaseProviders: [],
  generation: 'g1',
  health: 'healthy',
  identityRevision: 'r1',
  lastError: null,
  loadedAt: new Date('2026-09-15T00:00:00.000Z'),
  providerIds: ['work'],
  source: 'database',
} as IdentityProviderStartupSnapshot;

afterEach(() => {
  stopIdentityProviderBackgroundRevalidation();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('retryOnTransientDiscoveryError', () => {
  it('retries a transient discovery failure then returns success', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        error: new IdentityProviderValidationError('OIDC_DISCOVERY_INVALID'),
        ok: false,
      })
      .mockResolvedValueOnce({ ok: true, snapshot: healthySnapshot });

    const pending = retryOnTransientDiscoveryError(load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS[0]);
    await expect(pending).resolves.toMatchObject({ ok: true, snapshot: healthySnapshot });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('walks 5s/15s/45s backoff and keeps the last failure after retries are exhausted', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new IdentityProviderValidationError('OIDC_DISCOVERY_UNAVAILABLE');
    const load = vi.fn(async () => ({ error, ok: false as const }));

    const pending = retryOnTransientDiscoveryError(load);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS[0]);
    await vi.advanceTimersByTimeAsync(IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS[1]);
    await vi.advanceTimersByTimeAsync(IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS[2]);
    await expect(pending).resolves.toEqual({ error, ok: false });
    expect(load).toHaveBeenCalledTimes(1 + IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS.length);
  });

  it('does not retry non-transient schema or secret errors', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({
      error: new Error('PLATFORM_IDENTITY_PROVIDER_SECRET_UNAVAILABLE'),
      ok: false as const,
    }));

    await expect(retryOnTransientDiscoveryError(load)).resolves.toMatchObject({ ok: false });
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS[2]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleIdentityProviderBackgroundRevalidation', () => {
  it('promotes a recovered snapshot on the 5-minute tick and is single-flight', async () => {
    vi.useFakeTimers();
    let resolveLoad!: (snapshot: IdentityProviderStartupSnapshot | null) => void;
    const load = vi.fn(
      () =>
        new Promise<IdentityProviderStartupSnapshot | null>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const onRecovered = vi.fn();

    scheduleIdentityProviderBackgroundRevalidation({ load, onRecovered });
    expect(isIdentityProviderBackgroundRevalidationScheduled()).toBe(true);

    await vi.advanceTimersByTimeAsync(IDENTITY_PROVIDER_BACKGROUND_REVALIDATION_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(IDENTITY_PROVIDER_BACKGROUND_REVALIDATION_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(1);

    resolveLoad(healthySnapshot);
    await Promise.resolve();
    await Promise.resolve();

    expect(onRecovered).toHaveBeenCalledWith(healthySnapshot);
    expect(isIdentityProviderBackgroundRevalidationScheduled()).toBe(false);
  });

  it('unrefs the background interval so it does not keep the process alive', () => {
    const unref = vi.fn();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({
      unref,
    } as unknown as ReturnType<typeof setInterval>);

    scheduleIdentityProviderBackgroundRevalidation({
      load: async () => null,
      onRecovered: () => undefined,
    });

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      IDENTITY_PROVIDER_BACKGROUND_REVALIDATION_INTERVAL_MS,
    );
    expect(unref).toHaveBeenCalledOnce();
  });
});
