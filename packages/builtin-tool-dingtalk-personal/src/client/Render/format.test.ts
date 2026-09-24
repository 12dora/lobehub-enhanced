import { describe, expect, it } from 'vitest';

import {
  asNames,
  asRows,
  formatDateTime,
  formatFileSize,
  formatTimeRange,
  isOverdue,
  toPriorityLevel,
} from './format';

describe('formatDateTime', () => {
  it('formats epoch milliseconds in Asia/Shanghai', () => {
    // 2026-09-25T17:00:00+08:00
    expect(formatDateTime(1_790_326_800_000)).toBe('2026-09-25 17:00');
  });

  it('keeps midnight as 00:00', () => {
    expect(formatDateTime(Date.parse('2026-09-25T00:00:00+08:00'))).toBe('2026-09-25 00:00');
  });

  it('reads the dws message time string', () => {
    expect(formatDateTime('2026-09-24 08:05:33')).toBe('2026-09-24 08:05');
  });

  it('drops zero, null and unreadable values', () => {
    expect(formatDateTime(0)).toBeUndefined();
    expect(formatDateTime(null)).toBeUndefined();
    expect(formatDateTime(Number.NaN)).toBeUndefined();
    expect(formatDateTime('  ')).toBeUndefined();
  });
});

describe('formatTimeRange', () => {
  it('collapses a same-day range', () => {
    expect(formatTimeRange('2026-09-24T09:00:00+08:00', '2026-09-24T18:00:00+08:00')).toBe(
      '2026-09-24 09:00 – 18:00',
    );
  });

  it('keeps both dates across days', () => {
    expect(formatTimeRange('2026-09-18 00:00:00', '2026-09-24 23:59:59')).toBe(
      '2026-09-18 00:00 – 2026-09-24 23:59',
    );
  });
});

describe('formatFileSize', () => {
  it('picks a readable unit', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(93_388)).toBe('91.2 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatFileSize(undefined)).toBeUndefined();
  });
});

describe('todo helpers', () => {
  it('flags a passed due time only', () => {
    const now = Date.parse('2026-09-24T12:00:00+08:00');

    expect(isOverdue(now - 1, now)).toBe(true);
    expect(isOverdue(now + 1, now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
    expect(isOverdue(0, now)).toBe(false);
  });

  it('maps DingTalk priorities', () => {
    expect(toPriorityLevel(40)).toBe('urgent');
    expect(toPriorityLevel(20)).toBe('normal');
    expect(toPriorityLevel(25)).toBeUndefined();
    expect(toPriorityLevel(null)).toBeUndefined();
  });
});

describe('payload guards', () => {
  it('keeps object rows only', () => {
    expect(asRows([{ a: 1 }, null, 'x', [1]])).toEqual([{ a: 1 }]);
    expect(asRows(undefined)).toEqual([]);
  });

  it('keeps readable names only', () => {
    expect(asNames(['张三', ' ', 3, '李四 '])).toEqual(['张三', '李四']);
  });
});
