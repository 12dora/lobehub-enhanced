// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  formatReminderScheduleParseError,
  MAX_REMINDER_RECIPIENTS,
  reminderRecipientsSchema,
  reminderScheduleSchema,
} from './scheduleSchema';

describe('reminderScheduleSchema', () => {
  it('requires date for once, weekdays for weekly, monthDays for monthly', () => {
    expect(reminderScheduleSchema.safeParse({ kind: 'once', time: '09:00' }).success).toBe(false);
    expect(reminderScheduleSchema.safeParse({ kind: 'weekly', time: '09:00' }).success).toBe(false);
    expect(
      reminderScheduleSchema.safeParse({ kind: 'weekly', time: '09:00', weekdays: [] }).success,
    ).toBe(false);
    expect(reminderScheduleSchema.safeParse({ kind: 'monthly', time: '09:00' }).success).toBe(
      false,
    );
    expect(
      reminderScheduleSchema.safeParse({ kind: 'monthly', monthDays: [], time: '09:00' }).success,
    ).toBe(false);
  });

  it('accepts a complete schedule for each kind', () => {
    expect(
      reminderScheduleSchema.safeParse({ date: '2026-09-17', kind: 'once', time: '09:00' }).success,
    ).toBe(true);
    expect(reminderScheduleSchema.safeParse({ kind: 'daily', time: '09:00' }).success).toBe(true);
    expect(
      reminderScheduleSchema.safeParse({ kind: 'weekly', time: '09:00', weekdays: [1, 3] }).success,
    ).toBe(true);
    expect(
      reminderScheduleSchema.safeParse({ kind: 'monthly', monthDays: [1, 15], time: '09:00' })
        .success,
    ).toBe(true);
  });

  it('drops empty strings and empty arrays then normalises H:mm and HH:mm:ss', () => {
    const liveOnce = reminderScheduleSchema.safeParse({
      date: '2026-09-16',
      kind: 'once',
      monthDays: [],
      time: '',
      until: '',
      weekdays: [],
    });
    expect(liveOnce.success).toBe(false);

    const padded = reminderScheduleSchema.safeParse({
      date: '2026-09-16',
      kind: 'once',
      monthDays: [],
      time: '9:05',
      until: '',
      weekdays: [],
    });
    expect(padded.success).toBe(true);
    expect(padded.data).toEqual({ date: '2026-09-16', kind: 'once', time: '09:05' });

    const withSeconds = reminderScheduleSchema.safeParse({
      kind: 'daily',
      monthDays: [],
      time: '09:00:00',
      until: '',
      weekdays: [],
    });
    expect(withSeconds.success).toBe(true);
    expect(withSeconds.data).toEqual({ kind: 'daily', time: '09:00' });
  });

  it('names the missing time field in the parse error', () => {
    const parsed = reminderScheduleSchema.safeParse({
      date: '2026-09-16',
      kind: 'once',
      monthDays: [],
      time: '',
      until: '',
      weekdays: [],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(formatReminderScheduleParseError(parsed.error)).toContain('schedule.time');
  });
});

describe('reminderRecipientsSchema', () => {
  it(`caps recipients at ${MAX_REMINDER_RECIPIENTS}`, () => {
    expect(reminderRecipientsSchema.safeParse(['胡玉琴A']).success).toBe(true);
    expect(
      reminderRecipientsSchema.safeParse(
        Array.from({ length: MAX_REMINDER_RECIPIENTS + 1 }, (_, i) => `user-${i}`),
      ).success,
    ).toBe(false);
  });
});
