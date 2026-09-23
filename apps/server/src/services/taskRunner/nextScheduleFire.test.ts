import { describe, expect, it } from 'vitest';

import {
  agentFutureScheduleRefusal,
  formatScheduleFire,
  nextScheduleFire,
} from './nextScheduleFire';

const EVENING = new Date('2026-09-15T11:26:35.000Z'); // 19:26 Asia/Shanghai

describe('nextScheduleFire', () => {
  it('returns the next morning fire when asked the evening before', () => {
    const next = nextScheduleFire('0 9 * * *', 'Asia/Shanghai', EVENING);
    expect(next).not.toBeNull();
    expect(formatScheduleFire(next!, 'Asia/Shanghai')).toBe('2026-09-16 09:00');
    expect(next!.getTime()).toBeGreaterThan(EVENING.getTime());
  });

  it('treats the current fire minute as already due', () => {
    const now = new Date('2026-09-16T01:00:30.000Z'); // 09:00:30 Asia/Shanghai
    const next = nextScheduleFire('0 9 * * *', 'Asia/Shanghai', now);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('returns null for a pattern it cannot evaluate', () => {
    expect(nextScheduleFire('not a cron', 'Asia/Shanghai', EVENING)).toBeNull();
  });
});

describe('agentFutureScheduleRefusal', () => {
  const task = {
    automationMode: 'schedule' as const,
    schedulePattern: '0 9 * * *',
    scheduleTimezone: 'Asia/Shanghai',
  };

  it('refuses an agent runTask while the next fire is still in the future', () => {
    expect(agentFutureScheduleRefusal(task, { requestedByAgent: true }, EVENING)).toBe(
      '已按计划在 2026-09-16 09:00 执行，无需立即运行',
    );
  });

  it('allows the run when the user asked to run now', () => {
    expect(
      agentFutureScheduleRefusal(task, { requestedByAgent: true, runNow: true }, EVENING),
    ).toBeNull();
  });

  it('allows scheduler ticks and non-agent callers', () => {
    expect(
      agentFutureScheduleRefusal(task, { requestedByAgent: true, trigger: 'schedule' }, EVENING),
    ).toBeNull();
    expect(agentFutureScheduleRefusal(task, { trigger: 'manual' }, EVENING)).toBeNull();
  });

  it('allows an agent run during the fire minute', () => {
    const now = new Date('2026-09-16T01:00:30.000Z');
    expect(agentFutureScheduleRefusal(task, { requestedByAgent: true }, now)).toBeNull();
  });
});
