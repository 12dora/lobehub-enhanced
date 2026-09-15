// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { isHeartbeatTickDue } from '../heartbeatTick';
import { selectDueScheduledTasks } from '../scheduleDispatch';

vi.mock('@/libs/qstash', () => ({
  qstashClient: { publishJSON: vi.fn() },
}));

vi.mock('@/envs/app', () => ({
  appEnv: { enableQueueAgentRuntime: false },
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/taskRunner/scheduleTick', () => ({
  runScheduleTick: vi.fn(),
}));

vi.mock('@/server/services/taskRunner/heartbeatTick', () => ({
  runHeartbeatTick: vi.fn(),
}));

const shanghaiLocal = (iso: string) => new Date(`${iso}+08:00`);
const utc = (iso: string) => new Date(`${iso}Z`);

const dailyNine = (overrides: {
  id: string;
  identifier?: string;
  lastHeartbeatAt?: Date | null;
  scheduleTimezone: string;
}) => ({
  createdByUserId: 'u',
  identifier: overrides.identifier ?? overrides.id,
  lastHeartbeatAt: overrides.lastHeartbeatAt ?? null,
  schedulePattern: '0 9 * * *',
  ...overrides,
});

describe('selectDueScheduledTasks', () => {
  it('honours Asia/Shanghai vs UTC for a daily 09:00 pattern', () => {
    const now = shanghaiLocal('2026-04-29T09:00:00');
    const due = selectDueScheduledTasks(
      [
        dailyNine({ id: 'sh', identifier: 'T-SH', scheduleTimezone: 'Asia/Shanghai' }),
        dailyNine({ id: 'utc', identifier: 'T-UTC', scheduleTimezone: 'UTC' }),
      ],
      now,
    );
    expect(due.map((d) => d.taskId)).toEqual(['sh']);
  });

  it('does not select a daily 09:00 Shanghai task at 08:00 Shanghai', () => {
    const due = selectDueScheduledTasks(
      [dailyNine({ id: 'sh', scheduleTimezone: 'Asia/Shanghai' })],
      shanghaiLocal('2026-04-29T08:00:00'),
    );
    expect(due).toEqual([]);
  });

  it('dedups a daily UTC 09:00 task that already ran at 09:00 today', () => {
    const due = selectDueScheduledTasks(
      [
        dailyNine({
          id: 'utc',
          lastHeartbeatAt: utc('2026-04-29T09:00:00'),
          scheduleTimezone: 'UTC',
        }),
      ],
      utc('2026-04-29T09:03:00'),
    );
    expect(due).toEqual([]);
  });
});

describe('isHeartbeatTickDue', () => {
  const now = new Date('2026-04-29T08:15:00Z');

  it('is not due when lastHeartbeatAt is missing or invalid (never ran)', () => {
    expect(isHeartbeatTickDue({ heartbeatInterval: 600, lastHeartbeatAt: null, now })).toBe(false);
    expect(isHeartbeatTickDue({ heartbeatInterval: 600, lastHeartbeatAt: 'not-a-date', now })).toBe(
      false,
    );
  });

  it('is due when lastHeartbeatAt + interval has passed', () => {
    expect(
      isHeartbeatTickDue({
        heartbeatInterval: 600,
        lastHeartbeatAt: new Date('2026-04-29T08:00:00Z'),
        now,
      }),
    ).toBe(true);
  });

  it('is not due before the interval elapses', () => {
    expect(
      isHeartbeatTickDue({
        heartbeatInterval: 600,
        lastHeartbeatAt: new Date('2026-04-29T08:10:00Z'),
        now,
      }),
    ).toBe(false);
  });

  it('is not due without a positive interval', () => {
    expect(isHeartbeatTickDue({ heartbeatInterval: 0, lastHeartbeatAt: null, now })).toBe(false);
    expect(isHeartbeatTickDue({ heartbeatInterval: null, lastHeartbeatAt: null, now })).toBe(false);
  });
});
