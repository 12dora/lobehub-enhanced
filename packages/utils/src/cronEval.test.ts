import { describe, expect, it } from 'vitest';

import { isExecutionTime } from './cronEval';

const SHANGHAI = 'Asia/Shanghai';

const utc = (iso: string) => new Date(`${iso}Z`);
/** Build a UTC `Date` representing the given local wall-clock time in Shanghai (UTC+8). */
const shanghaiLocal = (iso: string) => new Date(`${iso}+08:00`);

describe('isExecutionTime', () => {
  describe('daily pattern — manual-trigger-before-scheduled-tick (regression)', () => {
    // Bug: when a user manually triggers a scheduled task earlier in the day,
    // `lastHeartbeatAt` advances. The dispatcher used to dedup by "same
    // calendar day", which made it skip the scheduled tick later that same
    // day. The fix is to dedup against today's scheduled target time, so a
    // pre-target manual run no longer eats the upcoming tick.

    it('fires daily 21:00 tick even if user manually triggered at 18:00 (UTC)', () => {
      // Daily at 21:00 UTC; manual run earlier today at 18:00.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: utc('2026-04-29T18:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('fires daily 21:00 tick if manual trigger was at 18:00 local Shanghai', () => {
      // Same scenario but in Asia/Shanghai timezone.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: shanghaiLocal('2026-04-29T21:00:00'),
          lastExecutedAt: shanghaiLocal('2026-04-29T18:00:00'),
          timezone: SHANGHAI,
        }),
      ).toBe(true);
    });

    it('fires the 7:30 daily tick when manual trigger happened at 06:00 same morning', () => {
      expect(
        isExecutionTime({
          cronPattern: '30 7 * * *',
          currentTime: utc('2026-04-29T07:30:00'),
          lastExecutedAt: utc('2026-04-29T06:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('daily pattern — dedup must still hold', () => {
    it('does NOT re-fire 30 minutes after the scheduled tick already ran', () => {
      // Scheduled tick fired at 21:00; dispatcher checks again at 21:30.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:30:00'),
          lastExecutedAt: utc('2026-04-29T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('does NOT fire if user manually ran AFTER the scheduled target same day', () => {
      // Manual run at 22:00 covers today's 21:00 scheduled run; do not refire.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T22:30:00'),
          lastExecutedAt: utc('2026-04-29T22:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('fires next day at 21:00 after running yesterday at 21:00', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-30T21:00:00'),
          lastExecutedAt: utc('2026-04-29T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('daily pattern — catch-up after missed scheduled time', () => {
    it('catches up at 23:00 if 21:00 was missed and the task never ran today', () => {
      // Last run was yesterday at 21:00; dispatcher comes online at 23:00 today.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T23:00:00'),
          lastExecutedAt: utc('2026-04-28T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('does NOT catch-up after manual run already covered today (manual at 22:00, dispatcher at 23:00)', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T23:00:00'),
          lastExecutedAt: utc('2026-04-29T22:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('hourly / interval patterns are unaffected by the fix', () => {
    it('every-hour-at-:00 still dedups within the 60-minute window', () => {
      // Last run 30 minutes ago — same hour window, do not refire.
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:00:00'),
          lastExecutedAt: utc('2026-04-29T14:30:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('every-hour-at-:00 fires after 60 minutes since last run', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:00:00'),
          lastExecutedAt: utc('2026-04-29T14:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('*/30 pattern dedups within its 30-minute window', () => {
      expect(
        isExecutionTime({
          cronPattern: '*/30 * * * *',
          currentTime: utc('2026-04-29T15:15:00'),
          lastExecutedAt: utc('2026-04-29T15:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('weekly pattern', () => {
    it('weekly Wed 21:00: fires Wednesday after manual Wed-morning trigger', () => {
      // 2026-04-29 is a Wednesday (weekday=3).
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * 3',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: utc('2026-04-29T08:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('weekly Wed 21:00: does NOT fire on Thursday', () => {
      // 2026-04-30 is Thursday.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * 3',
          currentTime: utc('2026-04-30T21:00:00'),
          lastExecutedAt: utc('2026-04-22T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('null / first-run handling', () => {
    it('fires when there is no lastExecutedAt and clock matches', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: null,
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('day-of-month and month fields', () => {
    it('does NOT fire 0 9 16 9 * at 19:26 on 15 Sep Shanghai (incident regression)', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 16 9 *',
          currentTime: shanghaiLocal('2026-09-15T19:26:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(false);
    });

    it('fires 0 9 16 9 * at 09:03 on 16 Sep Shanghai', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 16 9 *',
          currentTime: shanghaiLocal('2026-09-16T09:03:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);
    });

    it('catches up later on the matching day if it never ran', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 16 9 *',
          currentTime: shanghaiLocal('2026-09-16T19:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);
    });

    it('does NOT catch up on the matching day after running at 09:00', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 16 9 *',
          currentTime: shanghaiLocal('2026-09-16T19:00:00'),
          lastExecutedAt: shanghaiLocal('2026-09-16T09:00:00'),
          timezone: SHANGHAI,
        }),
      ).toBe(false);
    });

    it('fires 0 9 1 * * on the 1st, not the 2nd', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 1 * *',
          currentTime: shanghaiLocal('2026-09-01T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);
      expect(
        isExecutionTime({
          cronPattern: '0 9 1 * *',
          currentTime: shanghaiLocal('2026-09-02T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(false);
    });

    it('honours month lists: 0 9 1 1,7 *', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 1 1,7 *',
          currentTime: shanghaiLocal('2026-01-01T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);
      expect(
        isExecutionTime({
          cronPattern: '0 9 1 1,7 *',
          currentTime: shanghaiLocal('2026-07-01T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);
      expect(
        isExecutionTime({
          cronPattern: '0 9 1 1,7 *',
          currentTime: shanghaiLocal('2026-06-01T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(false);
    });

    it('honours day-of-month ranges and steps', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 10-20 * *',
          currentTime: shanghaiLocal('2026-09-15T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);
      expect(
        isExecutionTime({
          cronPattern: '0 9 10-20 * *',
          currentTime: shanghaiLocal('2026-09-21T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(false);

      // `*/2` expands from DOM origin 1 → 1,3,5,… so the 15th matches, 16th does not
      expect(
        isExecutionTime({
          cronPattern: '0 9 */2 * *',
          currentTime: shanghaiLocal('2026-09-15T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);
      expect(
        isExecutionTime({
          cronPattern: '0 9 */2 * *',
          currentTime: shanghaiLocal('2026-09-16T09:00:00'),
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(false);
    });

    it('uses the job timezone calendar date at the UTC/Shanghai date boundary', () => {
      // 2026-09-15 23:30 UTC === 2026-09-16 07:30 Asia/Shanghai
      const boundary = utc('2026-09-15T23:30:00');

      expect(
        isExecutionTime({
          cronPattern: '* * 16 9 *',
          currentTime: boundary,
          lastExecutedAt: null,
          timezone: 'UTC',
        }),
      ).toBe(false);

      expect(
        isExecutionTime({
          cronPattern: '* * 16 9 *',
          currentTime: boundary,
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(true);

      // Date matches in Shanghai, but 07:30 is still before 09:00
      expect(
        isExecutionTime({
          cronPattern: '0 9 16 9 *',
          currentTime: boundary,
          lastExecutedAt: null,
          timezone: SHANGHAI,
        }),
      ).toBe(false);
    });
  });
});
