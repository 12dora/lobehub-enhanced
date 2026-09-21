import { describe, expect, it } from 'vitest';

import {
  enableBlockedReason,
  formatRuleDate,
  formatRuleDateTime,
  isRuleExpired,
  todayRunCount,
} from './formatters';

describe('formatRuleDate / formatRuleDateTime', () => {
  it('formats an instant in Asia/Shanghai', () => {
    expect(formatRuleDate('2026-09-17T16:30:00.000Z')).toBe('2026-09-18');
    expect(formatRuleDateTime('2026-09-17T16:30:00.000Z')).toBe('2026-09-18 00:30');
  });

  it('honours an explicit timezone', () => {
    expect(formatRuleDateTime('2026-09-17T16:30:00.000Z', 'UTC')).toBe('2026-09-17 16:30');
  });

  it('falls back to the local rendering for an unknown timezone', () => {
    expect(formatRuleDateTime('2026-09-17T16:30:00.000Z', 'Mars/Olympus')).not.toBe('');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatRuleDate(null)).toBe('');
    expect(formatRuleDate(undefined)).toBe('');
    expect(formatRuleDateTime('not-a-date')).toBe('');
  });
});

describe('isRuleExpired', () => {
  const now = '2026-09-21T02:00:00.000Z';

  it('treats a rule without an expiry as permanent', () => {
    expect(isRuleExpired(null, now)).toBe(false);
    expect(isRuleExpired(undefined, now)).toBe(false);
  });

  it('compares on the instant, not on the rendered day', () => {
    expect(isRuleExpired('2026-09-21T01:59:00.000Z', now)).toBe(true);
    expect(isRuleExpired('2026-09-21T02:01:00.000Z', now)).toBe(false);
  });

  it('counts the exact expiry instant as expired', () => {
    expect(isRuleExpired(now, now)).toBe(true);
  });

  it('ignores an unparseable expiry rather than hiding the rule', () => {
    expect(isRuleExpired('whenever', now)).toBe(false);
  });
});

describe('enableBlockedReason', () => {
  const now = '2026-09-21T02:00:00.000Z';

  it('lets the owner resume a rule they stopped themselves', () => {
    expect(enableBlockedReason({ disabledReason: 'user', expiresAt: null }, now)).toBeUndefined();
    expect(enableBlockedReason({ disabledReason: null, expiresAt: null }, now)).toBeUndefined();
  });

  it('keeps a rule stopped by someone or something else out of the owner’s hands', () => {
    expect(enableBlockedReason({ disabledReason: 'admin', expiresAt: null }, now)).toBe('admin');
    expect(enableBlockedReason({ disabledReason: 'tier_off', expiresAt: null }, now)).toBe(
      'tier_off',
    );
    expect(enableBlockedReason({ disabledReason: 'identity_invalid', expiresAt: null }, now)).toBe(
      'identity_invalid',
    );
  });

  it('answers with the expiry when that is what keeps the rule from running', () => {
    // The owner stopped it, but re-enabling would not bring a lapsed rule back.
    expect(enableBlockedReason({ disabledReason: 'user', expiresAt: '2026-01-01' }, now)).toBe(
      'expired',
    );
    expect(enableBlockedReason({ expiresAt: '2026-01-01' }, now)).toBe('expired');
  });

  it('keeps the recorded reason when a stopped rule’s window also lapsed', () => {
    // Same precedence as the status chip: the administrator's decision is the one
    // the owner has to act on.
    expect(enableBlockedReason({ disabledReason: 'admin', expiresAt: '2026-01-01' }, now)).toBe(
      'admin',
    );
  });
});

describe('todayRunCount', () => {
  // 2026-09-21 10:00 in Asia/Shanghai.
  const now = '2026-09-21T02:00:00.000Z';

  it("returns the stored counter when it belongs to today's Shanghai day", () => {
    expect(todayRunCount({ dailyCount: 3, dailyCountDate: '2026-09-21' }, now)).toBe(3);
  });

  it('resets a counter left over from an earlier day', () => {
    expect(todayRunCount({ dailyCount: 20, dailyCountDate: '2026-09-20' }, now)).toBe(0);
  });

  it('takes a bare date column as a calendar day, whatever timezone is compared against', () => {
    // A `YYYY-MM-DD` value is already a calendar day: parsing it as an instant
    // and converting it would shift it by a day for callers east of Shanghai and
    // reset a counter that is still current.
    expect(todayRunCount({ dailyCount: 5, dailyCountDate: '2026-09-21' }, now, 'UTC')).toBe(5);
  });

  it('rolls the counter over when the Shanghai day has turned', () => {
    // 2026-09-21T16:00Z is already 2026-09-22 in Shanghai.
    expect(
      todayRunCount({ dailyCount: 5, dailyCountDate: '2026-09-21' }, '2026-09-21T16:00:00.000Z'),
    ).toBe(0);
  });

  it('accepts a timestamp for the counter day', () => {
    expect(todayRunCount({ dailyCount: 2, dailyCountDate: '2026-09-20T16:30:00.000Z' }, now)).toBe(
      2,
    );
  });

  it('reads a missing, zero or dateless counter as no runs today', () => {
    expect(todayRunCount({ dailyCount: null, dailyCountDate: '2026-09-21' }, now)).toBe(0);
    expect(todayRunCount({ dailyCount: 0, dailyCountDate: '2026-09-21' }, now)).toBe(0);
    expect(todayRunCount({ dailyCount: 4, dailyCountDate: null }, now)).toBe(0);
    expect(todayRunCount({}, now)).toBe(0);
  });
});
