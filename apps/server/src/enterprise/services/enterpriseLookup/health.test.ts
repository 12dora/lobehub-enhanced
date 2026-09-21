// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearEnterpriseLookupUnhealthy,
  ENTERPRISE_LOOKUP_UNHEALTHY_TTL_MS,
  isProviderUnhealthy,
  markProviderUnhealthy,
  noteEnterpriseLookupConfigured,
  peekEnterpriseLookupConfigured,
  resetEnterpriseLookupHealthForTest,
} from './health';

afterEach(() => {
  resetEnterpriseLookupHealthForTest();
});

describe('enterprise lookup provider health', () => {
  it('marks a provider unhealthy for 10 minutes', () => {
    const now = 1_000_000;
    markProviderUnhealthy('qcc', now);
    expect(isProviderUnhealthy('qcc', now + 1)).toBe(true);
    expect(isProviderUnhealthy('tianyancha', now + 1)).toBe(false);
    expect(isProviderUnhealthy('qcc', now + ENTERPRISE_LOOKUP_UNHEALTHY_TTL_MS + 1)).toBe(false);
  });

  it('records the configured peek used by the tools gate', () => {
    expect(peekEnterpriseLookupConfigured()).toBeUndefined();
    noteEnterpriseLookupConfigured(false);
    expect(peekEnterpriseLookupConfigured()).toBe(false);
    noteEnterpriseLookupConfigured(true);
    expect(peekEnterpriseLookupConfigured()).toBe(true);
  });

  it('clears unhealthy cooldown without resetting the configured peek', () => {
    noteEnterpriseLookupConfigured(true);
    markProviderUnhealthy('qcc');
    markProviderUnhealthy('tianyancha');
    clearEnterpriseLookupUnhealthy();
    expect(isProviderUnhealthy('qcc')).toBe(false);
    expect(isProviderUnhealthy('tianyancha')).toBe(false);
    expect(peekEnterpriseLookupConfigured()).toBe(true);
  });
});
