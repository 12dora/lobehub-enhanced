import {
  IdentityProviderValidationError,
  isTransientOidcDiscoveryError,
} from './discoveryValidator';
import type { IdentityProviderStartupSnapshot } from './startupArtifact';

export const IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS = [5_000, 15_000, 45_000] as const;
export const IDENTITY_PROVIDER_BACKGROUND_REVALIDATION_INTERVAL_MS = 5 * 60 * 1000;

type SnapshotLoadAttempt<T> = T & { ok: boolean; error?: unknown };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Retry a database snapshot load only for discovery/network-class failures.
 * Schema, secret, and issuer errors fail closed on the first attempt.
 */
export const retryOnTransientDiscoveryError = async <T extends { ok: boolean; error?: unknown }>(
  load: () => Promise<SnapshotLoadAttempt<T>>,
): Promise<SnapshotLoadAttempt<T>> => {
  let result = await load();
  if (result.ok || !isTransientOidcDiscoveryError(result.error)) return result;

  for (const [index, delayMs] of IDENTITY_PROVIDER_DISCOVERY_RETRY_BACKOFF_MS.entries()) {
    const code =
      result.error instanceof IdentityProviderValidationError ? result.error.code : undefined;
    console.warn('[identityProviderStartup] retrying database snapshot after discovery failure', {
      attempt: index + 1,
      code,
      delayMs,
    });
    await sleep(delayMs);
    result = await load();
    if (result.ok || !isTransientOidcDiscoveryError(result.error)) return result;
  }
  return result;
};

let revalidationGeneration = 0;
let revalidationTimer: ReturnType<typeof setInterval> | null = null;
let revalidationInFlight: Promise<void> | null = null;

export const stopIdentityProviderBackgroundRevalidation = (): void => {
  revalidationGeneration += 1;
  if (revalidationTimer) {
    clearInterval(revalidationTimer);
    revalidationTimer = null;
  }
  revalidationInFlight = null;
};

export const isIdentityProviderBackgroundRevalidationScheduled = (): boolean =>
  revalidationTimer !== null;

/**
 * While the IdP is failed-closed after a transient discovery error, re-check
 * every 5 minutes (unref'd, single-flight). A recovered database snapshot is
 * passed to `onRecovered` and the timer stops.
 */
export const scheduleIdentityProviderBackgroundRevalidation = (input: {
  intervalMs?: number;
  load: () => Promise<IdentityProviderStartupSnapshot | null>;
  onRecovered: (snapshot: IdentityProviderStartupSnapshot) => void;
}): void => {
  if (revalidationTimer) return;
  const generation = revalidationGeneration;
  const intervalMs = input.intervalMs ?? IDENTITY_PROVIDER_BACKGROUND_REVALIDATION_INTERVAL_MS;
  const tick = (): void => {
    if (revalidationInFlight) return;
    revalidationInFlight = Promise.resolve()
      .then(async () => {
        if (generation !== revalidationGeneration) return;
        const snapshot = await input.load();
        if (generation !== revalidationGeneration || !snapshot) return;
        input.onRecovered(snapshot);
        stopIdentityProviderBackgroundRevalidation();
      })
      .catch((error) => {
        console.error('[identityProviderStartup] background revalidation failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      })
      .finally(() => {
        if (generation === revalidationGeneration) revalidationInFlight = null;
      });
  };
  revalidationTimer = setInterval(tick, intervalMs);
  revalidationTimer.unref?.();
};
