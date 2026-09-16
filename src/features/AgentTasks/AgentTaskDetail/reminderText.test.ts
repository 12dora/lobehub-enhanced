import { describe, expect, it } from 'vitest';

import {
  formatReminderScheduleInput,
  formatReminderTimestamp,
  parseReminderRecipients,
  replaceReminderMentionToken,
} from './reminderText';

// The component tree renders keys, so a passthrough `t` keeps the assertions on
// the data the helpers compute rather than on translated copy.
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key) as any;

describe('parseReminderRecipients', () => {
  it('reads people and departments from the mention line', () => {
    const recipients = parseReminderRecipients(
      '@胡玉琴A·外贸组 @邵军军·业务部 @安环部\n\n每日例会',
    );

    expect(recipients).toEqual([
      { dept: '外贸组', name: '胡玉琴A' },
      { dept: '业务部', name: '邵军军' },
      { dept: undefined, name: '安环部' },
    ]);
  });

  it('ignores at-signs in the body so an e-mail is never a recipient', () => {
    expect(parseReminderRecipients('@胡玉琴A·外贸组\n\n发到 ops@example.com')).toEqual([
      { dept: '外贸组', name: '胡玉琴A' },
    ]);
  });

  it('returns nothing for an empty body', () => {
    expect(parseReminderRecipients(undefined)).toEqual([]);
    expect(parseReminderRecipients('')).toEqual([]);
  });
});

describe('formatReminderScheduleInput', () => {
  it('renders each schedule kind with its own key', () => {
    expect(formatReminderScheduleInput({ kind: 'daily', time: '09:00' }, t)).toBe(
      'taskReminder.schedule.daily:{"time":"09:00"}',
    );
    expect(
      formatReminderScheduleInput({ kind: 'weekly', time: '09:00', weekdays: [1, 3] }, t),
    ).toContain('taskReminder.weekday.1');
    expect(
      formatReminderScheduleInput({ kind: 'monthly', monthDays: [1, 15], time: '09:00' }, t),
    ).toContain('taskReminder.schedule.monthly');
    // An out-of-range weekday prints the number, never a raw i18n key.
    expect(
      formatReminderScheduleInput({ kind: 'weekly', time: '09:00', weekdays: [0, 1] }, t),
    ).toContain('"days":"0');
    expect(
      formatReminderScheduleInput({ date: '2026-09-17', kind: 'once', time: '09:00' }, t),
    ).toContain('2026-09-17');
  });

  it('returns an empty string when the server kept the current schedule', () => {
    expect(formatReminderScheduleInput(undefined, t)).toBe('');
  });
});

describe('formatReminderTimestamp', () => {
  it('renders an ISO instant in the reminder timezone', () => {
    // 2026-09-16T01:00:00Z === 09:00 in Asia/Shanghai (UTC+8)
    expect(formatReminderTimestamp('2026-09-16T01:00:00.000Z')).toBe('2026-09-16 09:00');
  });

  it('is empty for a missing or unparsable value', () => {
    expect(formatReminderTimestamp(null)).toBe('');
    expect(formatReminderTimestamp('not-a-date')).toBe('');
  });
});

describe('replaceReminderMentionToken', () => {
  it('disambiguates a bare mention in place', () => {
    expect(
      replaceReminderMentionToken(
        '@胡玉琴 @邵军军·业务部\n\n每日例会',
        '胡玉琴',
        '@胡玉琴A·外贸组',
      ),
    ).toBe('@胡玉琴A·外贸组 @邵军军·业务部\n\n每日例会');
  });

  it('never eats a longer token that already carries a department', () => {
    const body = '@胡玉琴A·外贸组\n\n每日例会';

    expect(replaceReminderMentionToken(body, '胡玉琴A', '@胡玉琴A·安环部')).toBe(body);
  });
});
