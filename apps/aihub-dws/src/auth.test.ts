import { describe, expect, it } from 'vitest';

import { assertBrokerToken, bearerAuthorized } from './auth.ts';

const TOKEN = 'a'.repeat(32);

describe('auth', () => {
  it('rejects a short broker token', () => {
    expect(() => assertBrokerToken('short')).toThrow(/32/);
    expect(() => assertBrokerToken(undefined)).toThrow(/32/);
    expect(assertBrokerToken(TOKEN)).toBe(TOKEN);
  });

  it('compares bearer tokens without throwing on length mismatch', () => {
    expect(bearerAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerAuthorized('Bearer short', TOKEN)).toBe(false);
    expect(bearerAuthorized(`Bearer ${'b'.repeat(32)}`, TOKEN)).toBe(false);
    expect(bearerAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(false);
    expect(bearerAuthorized(undefined, TOKEN)).toBe(false);
    expect(bearerAuthorized('Basic abc', TOKEN)).toBe(false);
  });
});
