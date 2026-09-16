import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import zhChat from '../../../../locales/zh-CN/chat.json';
import { formatReminderTime, formatRepeatSummary } from './formatters';

const dict = zhChat as Record<string, string>;

/**
 * Translate against the real zh-CN seed so a renamed/missing key fails here
 * instead of shipping a raw key into the UI.
 */
const t = ((key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN chat key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
}) as unknown as TFunction<'chat'>;

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

describe('formatRepeatSummary', () => {
  it('returns an empty string for one-shot reminders', () => {
    expect(formatRepeatSummary(null, t)).toBe('');
  });

  it('summarizes a daily rule', () => {
    expect(formatRepeatSummary({ freq: 'daily', time: '09:00' }, t)).toBe('每天 09:00');
  });

  it('summarizes a weekly rule', () => {
    expect(formatRepeatSummary({ freq: 'weekly', time: '09:00', weekdays: [3] }, t)).toBe(
      '每周三 09:00',
    );
  });

  it('joins several weekdays in ascending order', () => {
    expect(formatRepeatSummary({ freq: 'weekly', time: '18:30', weekdays: [5, 1] }, t)).toBe(
      '每周一、五 18:30',
    );
  });

  it('summarizes a monthly rule', () => {
    expect(formatRepeatSummary({ freq: 'monthly', monthDays: [15, 1], time: '09:00' }, t)).toBe(
      '每月 1、15 日 09:00',
    );
  });

  it('falls back to the daily wording when the rule carries no day list', () => {
    expect(formatRepeatSummary({ freq: 'weekly', time: '07:00' }, t)).toBe('每天 07:00');
  });
});
