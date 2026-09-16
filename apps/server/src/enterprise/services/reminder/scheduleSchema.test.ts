// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
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
