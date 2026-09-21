type EnterpriseLookupProvider = 'qcc' | 'tianyancha';

/** In-process cooldown after unauthorized / quota / unreachable / timeout. */
export const ENTERPRISE_LOOKUP_UNHEALTHY_TTL_MS = 10 * 60 * 1000;

const unhealthyUntil = new Map<EnterpriseLookupProvider, number>();

let configuredPeek: boolean | undefined;

export const markProviderUnhealthy = (
  provider: EnterpriseLookupProvider,
  now = Date.now(),
  ttlMs = ENTERPRISE_LOOKUP_UNHEALTHY_TTL_MS,
): void => {
  unhealthyUntil.set(provider, now + ttlMs);
};

export const isProviderUnhealthy = (
  provider: EnterpriseLookupProvider,
  now = Date.now(),
): boolean => {
  const until = unhealthyUntil.get(provider);
  if (until === undefined) return false;
  if (until <= now) {
    unhealthyUntil.delete(provider);
    return false;
  }
  return true;
};

export const noteEnterpriseLookupConfigured = (value: boolean): void => {
  configuredPeek = value;
};

export const clearEnterpriseLookupUnhealthy = (): void => {
  unhealthyUntil.clear();
};

/** Last known `isConfigured()` result; `undefined` until the first lookup. */
export const peekEnterpriseLookupConfigured = (): boolean | undefined => configuredPeek;

export const resetEnterpriseLookupHealthForTest = (): void => {
  unhealthyUntil.clear();
  configuredPeek = undefined;
};
