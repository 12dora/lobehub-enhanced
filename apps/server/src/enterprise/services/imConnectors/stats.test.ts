// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import {
  getImConnectorStats,
  IM_CONNECTOR_MESSAGES_COUNTER_KEY,
  IM_CONNECTOR_PUSHES_COUNTER_KEY,
  lastNDaysYmd,
} from './stats';

const mockDb = (linkedUsers: number): LobeChatDatabase =>
  ({
    select: () => ({
      from: () => ({
        where: async () => [{ value: linkedUsers }],
      }),
    }),
  }) as never;

describe('lastNDaysYmd', () => {
  it('returns seven Asia/Shanghai calendar days newest first', () => {
    const days = lastNDaysYmd(7, 'Asia/Shanghai', new Date('2026-09-15T02:00:00.000Z'));
    expect(days).toEqual([
      '2026-09-15',
      '2026-09-14',
      '2026-09-13',
      '2026-09-12',
      '2026-09-11',
      '2026-09-10',
      '2026-09-09',
    ]);
  });
});

describe('getImConnectorStats', () => {
  it('counts linked users and sums Redis counters, treating missing keys as 0', async () => {
    const days = lastNDaysYmd(7, 'Asia/Shanghai', new Date('2026-09-15T02:00:00.000Z'));
    const redis = {
      mget: vi.fn(async (...keys: string[]) => {
        if (keys[0] === IM_CONNECTOR_MESSAGES_COUNTER_KEY('dingtalk', days[0]!)) {
          return ['4', null, '1', null, null, null, null];
        }
        if (keys[0] === IM_CONNECTOR_PUSHES_COUNTER_KEY('dingtalk', days[0]!)) {
          return [null, '2', null, null, null, null, null];
        }
        return keys.map(() => null);
      }),
    };

    const stats = await getImConnectorStats({
      db: mockDb(3),
      now: new Date('2026-09-15T02:00:00.000Z'),
      platform: 'dingtalk',
      redis,
    });

    expect(stats).toEqual({ linkedUsers: 3, messages7d: 5, pushes7d: 2 });
    expect(redis.mget).toHaveBeenCalledTimes(2);
  });

  it('returns zeros when Redis is missing', async () => {
    const stats = await getImConnectorStats({
      db: mockDb(0),
      platform: 'dingtalk',
      redis: null,
    });

    expect(stats).toEqual({ linkedUsers: 0, messages7d: 0, pushes7d: 0 });
  });
});
