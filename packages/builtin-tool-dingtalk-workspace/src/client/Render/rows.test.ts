import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatTimeRange,
  readPersonName,
  toDirectoryRows,
  toEventRows,
  toFreeBusyRows,
  toRoomRows,
  toTodoRows,
} from './rows';

describe('formatDateTime', () => {
  it('shortens ISO strings without shifting the wall clock', () => {
    expect(formatDateTime('2026-09-21T09:30:00+08:00')).toBe('2026-09-21 09:30');
  });

  it('formats epoch milliseconds in Asia/Shanghai', () => {
    expect(formatDateTime(Date.UTC(2026, 8, 21, 1, 30))).toBe('2026-09-21 09:30');
  });

  it('returns undefined for empty input', () => {
    expect(formatDateTime(null)).toBeUndefined();
    expect(formatDateTime(undefined)).toBeUndefined();
    expect(formatDateTime(Number.NaN)).toBeUndefined();
  });
});

describe('formatTimeRange', () => {
  it('collapses the shared date', () => {
    expect(formatTimeRange('2026-09-21T09:30:00+08:00', '2026-09-21T10:30:00+08:00')).toBe(
      '2026-09-21 09:30 – 10:30',
    );
  });

  it('keeps both dates across days', () => {
    expect(formatTimeRange('2026-09-21T09:30:00+08:00', '2026-09-22T10:30:00+08:00')).toBe(
      '2026-09-21 09:30 – 2026-09-22 10:30',
    );
  });

  it('tolerates a missing end', () => {
    expect(formatTimeRange('2026-09-21T09:30:00+08:00')).toBe('2026-09-21 09:30');
  });
});

describe('readPersonName', () => {
  it('reads a resolved name and refuses a staff token', () => {
    expect(readPersonName('张三')).toBe('张三');
    // The id inside `staff:<id>` is not a shorter name for the person.
    expect(readPersonName('staff:012345')).toBeUndefined();
    expect(readPersonName()).toBeUndefined();
  });
});

describe('toTodoRows', () => {
  it('maps todos and reports an untitled one as unnamed rather than dropping it', () => {
    expect(
      toTodoRows([
        { dueTime: Date.UTC(2026, 8, 21, 1, 30), isDone: false, priority: 30, subject: '写周报' },
        { taskId: '2049183091773' },
      ]),
    ).toEqual([
      {
        due: '2026-09-21 09:30',
        isDone: false,
        key: '0',
        priority: 30,
        subject: '写周报',
      },
      {
        due: undefined,
        isDone: false,
        key: '2049183091773',
        priority: undefined,
        // The card names it 「未命名待办」; the taskId never becomes its title.
        subject: undefined,
      },
    ]);
  });
});

describe('toEventRows', () => {
  it('maps a timed event', () => {
    expect(
      toEventRows([
        {
          end: '2026-09-21T10:30:00+08:00',
          eventId: 'e1',
          location: '三楼会议室',
          start: '2026-09-21T09:30:00+08:00',
          summary: '周会',
        },
      ]),
    ).toEqual([
      {
        isAllDay: false,
        key: 'e1',
        location: '三楼会议室',
        summary: '周会',
        timeRange: '2026-09-21 09:30 – 10:30',
      },
    ]);
  });

  it('shows all-day events as a date', () => {
    const [row] = toEventRows([
      { isAllDay: true, start: '2026-09-21T00:00:00+08:00', summary: '团建' },
    ]);

    expect(row.isAllDay).toBe(true);
    expect(row.timeRange).toBe('2026-09-21');
  });
});

describe('toRoomRows', () => {
  it('maps rooms with capacity', () => {
    expect(toRoomRows([{ roomCapacity: 12, roomId: 'r1', roomName: '会议室 A' }])).toEqual([
      { capacity: 12, key: 'r1', name: '会议室 A' },
    ]);
  });
});

describe('toFreeBusyRows', () => {
  it('summarizes busy blocks per person under the resolved name', () => {
    expect(
      toFreeBusyRows([
        {
          blocks: [
            { end: '2026-09-21T10:30:00+08:00', start: '2026-09-21T09:30:00+08:00' },
            { end: '2026-09-21T15:00:00+08:00', start: '2026-09-21T14:00:00+08:00' },
            { end: '2026-09-21T17:00:00+08:00', start: '2026-09-21T16:00:00+08:00' },
          ],
          name: '李四 · 财务',
          staffToken: 'staff:012345',
        },
      ]),
    ).toEqual([
      {
        blockCount: 3,
        key: 'staff:012345',
        // The service resolves the label; a raw staff id would be unreadable.
        name: '李四 · 财务',
        ranges: '2026-09-21 09:30 – 10:30、2026-09-21 14:00 – 15:00',
      },
    ]);
  });

  it('reports no name when the service resolved none, instead of the raw token', () => {
    expect(toFreeBusyRows([{ blocks: [], staffToken: 'staff:012345' }])).toEqual([
      { blockCount: 0, key: 'staff:012345', name: undefined, ranges: '' },
    ]);
  });
});

describe('toDirectoryRows', () => {
  it('lists people before departments', () => {
    expect(
      toDirectoryRows({
        departments: [{ deptId: 'd1', name: '研发部', pathNames: '公司/研发部' }],
        users: [{ deptPath: '公司/研发部', name: '张三', staffId: 's1' }],
      }),
    ).toEqual([
      { key: 'user-s1', kind: 'user', meta: '公司/研发部', name: '张三' },
      { key: 'dept-d1', kind: 'department', meta: '公司/研发部', name: '研发部' },
    ]);
  });
});
