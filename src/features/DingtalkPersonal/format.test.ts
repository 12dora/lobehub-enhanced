import { describe, expect, it } from 'vitest';

import { formatAuthorizationTime, formatCountdown, listEnabledFeatures } from './format';

describe('formatCountdown', () => {
  it('prints minutes and seconds, rounding a partial second up', () => {
    expect(formatCountdown(900_000)).toBe('15:00');
    expect(formatCountdown(61_001)).toBe('01:02');
    expect(formatCountdown(999)).toBe('00:01');
  });

  it('never goes below zero', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5000)).toBe('00:00');
  });
});

describe('formatAuthorizationTime', () => {
  it('formats a parsable timestamp and drops a missing or broken one', () => {
    expect(formatAuthorizationTime('2026-09-24T08:30:00')).toBe('2026-09-24 08:30');
    expect(formatAuthorizationTime(undefined)).toBeNull();
    expect(formatAuthorizationTime('not a date')).toBeNull();
  });
});

describe('listEnabledFeatures', () => {
  it('keeps the card order and only what is explicitly on', () => {
    expect(listEnabledFeatures({ chat: true, report: false, todo: true, write: true })).toEqual([
      'todo',
      'chat',
      'write',
    ]);
    expect(listEnabledFeatures(undefined)).toEqual([]);
  });
});
