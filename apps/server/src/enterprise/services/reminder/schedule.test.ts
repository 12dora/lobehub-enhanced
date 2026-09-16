// @vitest-environment node
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';

import {
  buildReminderNotice,
  formatRepeatSummary,
  initialFireAt,
  isDue,
  nextClockTime,
  nextFireAt,
  resolveOneShotFireAt,
} from './schedule';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Shanghai';
const at = (local: string) => dayjs.tz(local, TZ).toDate();
const fmt = (value: Date | null) => (value ? dayjs(value).tz(TZ).format('YYYY-MM-DD HH:mm') : null);

describe('reminder schedule math', () => {
  describe('one-shot', () => {
    it('tomorrow 09:00 created at 15:00 is not due today', () => {
      const createdAt = at('2026-09-16 15:00:00');
      const fireAt = resolveOneShotFireAt({ localDate: '2026-09-17', time: '09:00', tz: TZ });

      expect(fmt(fireAt)).toBe('2026-09-17 09:00');
      expect(isDue(fireAt, createdAt)).toBe(false);
      expect(isDue(fireAt, at('2026-09-17 08:59:59'))).toBe(false);
      expect(isDue(fireAt, at('2026-09-17 09:00:00'))).toBe(true);
    });

    it('nextClockTime at 15:00 for 09:00 is tomorrow, not today (no daily catch-up)', () => {
      const createdAt = at('2026-09-16 15:00:00');
      expect(fmt(nextClockTime('09:00', createdAt, TZ))).toBe('2026-09-17 09:00');
      expect(isDue(at('2026-09-16 09:00:00'), createdAt)).toBe(true);
    });
  });

  describe('daily', () => {
    it('initialFireAt after 08:00 is today 09:00', () => {
      expect(
        fmt(initialFireAt({ freq: 'daily', time: '09:00' }, at('2026-09-16 08:00:00'), TZ)),
      ).toBe('2026-09-16 09:00');
    });

    it('nextFireAt after today 09:00 is tomorrow', () => {
      expect(fmt(nextFireAt({ freq: 'daily', time: '09:00' }, at('2026-09-16 09:00:00'), TZ))).toBe(
        '2026-09-17 09:00',
      );
    });

    it('returns null when the next fire is past until', () => {
      expect(
        nextFireAt(
          { freq: 'daily', time: '09:00', until: '2026-09-16' },
          at('2026-09-16 09:00:00'),
          TZ,
        ),
      ).toBeNull();
    });

    it('still fires on the until date', () => {
      expect(
        fmt(
          nextFireAt(
            { freq: 'daily', time: '09:00', until: '2026-09-16' },
            at('2026-09-16 08:00:00'),
            TZ,
          ),
        ),
      ).toBe('2026-09-16 09:00');
    });
  });

  describe('weekly', () => {
    it('advances Wednesday 09:00 across a month end', () => {
      // 2026-09-30 is Wednesday.
      const next = nextFireAt(
        { freq: 'weekly', time: '09:00', weekdays: [3] },
        at('2026-09-30 15:00:00'),
        TZ,
      );
      expect(fmt(next)).toBe('2026-10-07 09:00');
    });

    it('fires later today when the weekday still matches', () => {
      expect(
        fmt(
          nextFireAt(
            { freq: 'weekly', time: '15:00', weekdays: [3] },
            at('2026-09-16 08:00:00'),
            TZ,
          ),
        ),
      ).toBe('2026-09-16 15:00');
    });

    it('honours until across the month boundary', () => {
      expect(
        nextFireAt(
          { freq: 'weekly', time: '09:00', until: '2026-09-30', weekdays: [3] },
          at('2026-09-30 15:00:00'),
          TZ,
        ),
      ).toBeNull();
    });
  });

  describe('monthly', () => {
    it('clamps 31st across February', () => {
      const next = nextFireAt(
        { freq: 'monthly', monthDays: [31], time: '09:00' },
        at('2026-01-31 09:00:00'),
        TZ,
      );
      expect(fmt(next)).toBe('2026-02-28 09:00');
    });

    it('after a clamped February fire goes to March 31', () => {
      const next = nextFireAt(
        { freq: 'monthly', monthDays: [31], time: '09:00' },
        at('2026-02-28 09:00:00'),
        TZ,
      );
      expect(fmt(next)).toBe('2026-03-31 09:00');
    });

    it('returns null when the next clamped fire is past until', () => {
      expect(
        nextFireAt(
          { freq: 'monthly', monthDays: [31], time: '09:00', until: '2026-02-27' },
          at('2026-01-31 09:00:00'),
          TZ,
        ),
      ).toBeNull();
    });
  });

  describe('copy', () => {
    it('formats weekly summary and work-notice body', () => {
      expect(formatRepeatSummary({ freq: 'weekly', time: '09:00', weekdays: [3] })).toBe('每周三');
      const notice = buildReminderNotice({
        content: '交安全报告',
        creatorName: '张三',
        firedAt: at('2026-09-16 09:00:00'),
        repeatRule: { freq: 'weekly', time: '09:00', weekdays: [3] },
        timezone: TZ,
      });
      expect(notice.title).toBe('提醒');
      expect(notice.text).toBe('### 提醒\n交安全报告\n\n09:00（每周三） · 来自 张三');
    });
  });
});
