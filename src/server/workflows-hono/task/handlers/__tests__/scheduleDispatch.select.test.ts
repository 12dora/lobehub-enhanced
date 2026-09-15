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

describe('selectDueScheduledTasks', () => {
  it('honours Asia/Shanghai vs UTC for a daily 09:00 pattern', () => {
    const now = shanghaiLocal('2026-04-29T09:00:00');
    const due = selectDueScheduledTasks(
      [
        {
          createdByUserId: 'u',
          id: 'sh',
          identifier: 'T-SH',
          lastHeartbeatAt: null,
          schedulePattern: '0 9 * * *',
          scheduleTimezone: 'Asia/Shanghai',
        },
        {
          createdByUserId: 'u',
          id: 'utc',
          identifier: 'T-UTC',
          lastHeartbeatAt: null,
          schedulePattern: '0 9 * * *',
          scheduleTimezone: 'UTC',
        },
      ],
      now,
    );
    expect(due.map((d) => d.taskId)).toEqual(['sh']);
  });
});

describe('isHeartbeatTickDue', () => {
  const now = new Date('2026-04-29T08:15:00Z');

  it('is due when lastHeartbeatAt is missing (restart catch-up)', () => {
    expect(isHeartbeatTickDue({ heartbeatInterval: 600, lastHeartbeatAt: null, now })).toBe(true);
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
