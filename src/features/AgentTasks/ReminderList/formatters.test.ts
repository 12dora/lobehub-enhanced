import { describe, expect, it } from 'vitest';

import { formatReminderShortTime, formatReminderTime } from './formatters';

describe('formatReminderTime', () => {
  it('formats an ISO instant in Asia/Shanghai', () => {
    expect(formatReminderTime('2026-09-17T01:00:00.000Z')).toBe('2026-09-17 09:00');
  });

  it('keeps the reminder timezone when the row carries one', () => {
    expect(formatReminderTime('2026-09-17T01:00:00.000Z', 'UTC')).toBe('2026-09-17 01:00');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatReminderTime(null)).toBe('');
    expect(formatReminderTime('not-a-date')).toBe('');
  });
});

describe('formatReminderShortTime', () => {
  it('formats an ISO instant as `MM-DD HH:mm` in Asia/Shanghai', () => {
    expect(formatReminderShortTime('2026-09-17T01:00:00.000Z')).toBe('09-17 09:00');
  });

  it('keeps the reminder timezone when one is given', () => {
    expect(formatReminderShortTime('2026-09-17T01:00:00.000Z', 'UTC')).toBe('09-17 01:00');
  });

  it('falls back to the local rendering for an unknown timezone', () => {
    expect(formatReminderShortTime('2026-09-17T01:00:00.000Z', 'Mars/Olympus')).not.toBe('');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatReminderShortTime(null)).toBe('');
    expect(formatReminderShortTime('not-a-date')).toBe('');
  });
});
