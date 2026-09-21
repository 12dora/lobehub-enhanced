// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => ({
  expire: vi.fn(),
  getRedis: vi.fn(),
  hgetall: vi.fn(),
  hincrby: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisMocks.getRedis(),
}));

const {
  DINGTALK_API_CALL_STATS_DEFAULT_DAYS,
  DINGTALK_API_CALL_STATS_KEY_PREFIX,
  DINGTALK_API_CALL_STATS_MAX_APIS_PER_DAY,
  DINGTALK_API_CALL_STATS_MAX_DAYS,
  DINGTALK_API_CALL_STATS_TTL_SECONDS,
  dingtalkApiCallStatsRedisKey,
  formatDingtalkApiCallStatsDate,
  getDingtalkApiCallStats,
  recordDingtalkApiCall,
  resetDingtalkApiCallStatsForTest,
  toDingtalkApiCallKey,
} = await import('./apiCallStats');

describe('toDingtalkApiCallKey', () => {
  it('drops query strings and templates ids / uuids / unionIds / processCodes', () => {
    expect(toDingtalkApiCallKey('GET', 'https://oapi.dingtalk.com/gettoken?appkey=k')).toBe(
      'GET /gettoken',
    );
    expect(
      toDingtalkApiCallKey('POST', 'https://oapi.dingtalk.com/topapi/v2/department/listsub'),
    ).toBe('POST /topapi/v2/department/listsub');
    expect(
      toDingtalkApiCallKey(
        'get',
        'https://api.dingtalk.com/v1.0/workflow/processInstances?processInstanceId=abc',
      ),
    ).toBe('GET /v1.0/workflow/processInstances');
    expect(toDingtalkApiCallKey('POST', '/v1.0/todo/users/iiHvS0V4s6abc/tasks/task-99')).toBe(
      'POST /v1.0/todo/users/:id/tasks/:id',
    );
    expect(
      toDingtalkApiCallKey(
        'GET',
        '/v1.0/calendar/users/union-1/calendars/primary/events/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      ),
    ).toBe('GET /v1.0/calendar/users/:id/calendars/primary/events/:id');
    expect(toDingtalkApiCallKey('GET', '/v1.0/rooms/meetingRooms/room-7')).toBe(
      'GET /v1.0/rooms/meetingRooms/:id',
    );
    expect(toDingtalkApiCallKey('POST', '/v1.0/workflow/forms/PROC-FF6Y2ABCD')).toBe(
      'POST /v1.0/workflow/forms/:id',
    );
    expect(toDingtalkApiCallKey('POST', '/topapi/v2/department/get')).toBe(
      'POST /topapi/v2/department/get',
    );
  });
});

describe('recordDingtalkApiCall / getDingtalkApiCallStats', () => {
  beforeEach(() => {
    resetDingtalkApiCallStatsForTest();
    redisMocks.getRedis.mockReset();
    redisMocks.hincrby.mockReset().mockResolvedValue(1);
    redisMocks.expire.mockReset().mockResolvedValue(1);
    redisMocks.hgetall.mockReset().mockResolvedValue({});
    redisMocks.getRedis.mockReturnValue({
      expire: redisMocks.expire,
      hgetall: redisMocks.hgetall,
      hincrby: redisMocks.hincrby,
    });
  });

  afterEach(() => {
    resetDingtalkApiCallStatsForTest();
    vi.clearAllMocks();
  });

  it('increments a Shanghai-day Redis hash with a 40-day TTL', async () => {
    const now = new Date('2026-09-21T16:30:00.000Z');
    vi.useFakeTimers({ now });
    try {
      const date = formatDingtalkApiCallStatsDate(now);
      expect(date).toBe('2026-09-22');
      await recordDingtalkApiCall('POST /topapi/v2/user/list');
      expect(redisMocks.hincrby).toHaveBeenCalledWith(
        dingtalkApiCallStatsRedisKey(date),
        'POST /topapi/v2/user/list',
        1,
      );
      expect(redisMocks.expire).toHaveBeenCalledWith(
        `${DINGTALK_API_CALL_STATS_KEY_PREFIX}${date}`,
        DINGTALK_API_CALL_STATS_TTL_SECONDS,
      );
      expect(DINGTALK_API_CALL_STATS_TTL_SECONDS).toBe(40 * 24 * 60 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never throws and falls back to an in-process counter when Redis is missing', async () => {
    redisMocks.getRedis.mockReturnValue(null);
    await expect(recordDingtalkApiCall('GET /gettoken')).resolves.toBeUndefined();
    const stats = await getDingtalkApiCallStats({ days: 1, now: new Date() });
    expect(stats.total).toBe(1);
    expect(stats.days).toHaveLength(1);
    expect(stats.days[0]?.byApi).toEqual([{ api: 'GET /gettoken', count: 1 }]);
  });

  it('falls back to memory when Redis writes throw', async () => {
    redisMocks.hincrby.mockRejectedValueOnce(new Error('redis down'));
    await expect(recordDingtalkApiCall('POST /v1.0/oauth2/accessToken')).resolves.toBeUndefined();
    const stats = await getDingtalkApiCallStats({ days: 1 });
    expect(stats.total).toBe(1);
    expect(stats.days[0]?.byApi).toEqual([{ api: 'POST /v1.0/oauth2/accessToken', count: 1 }]);
  });

  it('returns last N Shanghai days merged from Redis + memory, default 30', async () => {
    const now = new Date('2026-09-21T04:00:00.000Z');
    vi.useFakeTimers({ now });
    const today = formatDingtalkApiCallStatsDate(now);
    redisMocks.hgetall.mockImplementation(async (key: string) => {
      if (key === dingtalkApiCallStatsRedisKey(today)) {
        return { 'GET /gettoken': '2', 'POST /topapi/v2/department/listsub': '4' };
      }
      return {};
    });
    redisMocks.getRedis.mockReturnValueOnce(null);
    await recordDingtalkApiCall('GET /gettoken');
    redisMocks.getRedis.mockReturnValue({
      expire: redisMocks.expire,
      hgetall: redisMocks.hgetall,
      hincrby: redisMocks.hincrby,
    });

    try {
      const stats = await getDingtalkApiCallStats({ days: 2, now });
      expect(stats.days).toHaveLength(2);
      expect(stats.days[0]?.date < stats.days[1]!.date).toBe(true);
      const todayRow = stats.days.find((row) => row.date === today);
      expect(todayRow?.byApi).toEqual([
        { api: 'POST /topapi/v2/department/listsub', count: 4 },
        { api: 'GET /gettoken', count: 3 },
      ]);
      expect(todayRow?.total).toBe(7);
      expect(stats.total).toBe(7);
      expect(DINGTALK_API_CALL_STATS_DEFAULT_DAYS).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps days to 1..40', async () => {
    const wide = await getDingtalkApiCallStats({ days: 99, now: new Date('2026-09-21T00:00:00Z') });
    expect(wide.days).toHaveLength(40);
    const narrow = await getDingtalkApiCallStats({
      days: 0,
      now: new Date('2026-09-21T00:00:00Z'),
    });
    expect(narrow.days).toHaveLength(1);
  });

  it('evicts in-process day keys older than MAX_DAYS after an increment', async () => {
    redisMocks.getRedis.mockReturnValue(null);
    const t0 = new Date('2026-01-01T04:00:00.000Z');
    vi.useFakeTimers({ now: t0 });
    try {
      await recordDingtalkApiCall('GET /old');
      const later = new Date(t0.getTime() + (DINGTALK_API_CALL_STATS_MAX_DAYS + 1) * 86_400_000);
      vi.setSystemTime(later);
      await recordDingtalkApiCall('GET /new');
      vi.setSystemTime(t0);
      const stale = await getDingtalkApiCallStats({ days: 1, now: t0 });
      expect(stale.total).toBe(0);
      const fresh = await getDingtalkApiCallStats({ days: 1, now: later });
      expect(fresh.total).toBe(1);
      expect(fresh.days[0]?.byApi).toEqual([{ api: 'GET /new', count: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps unique in-process API fields per day', async () => {
    redisMocks.getRedis.mockReturnValue(null);
    for (let i = 0; i <= DINGTALK_API_CALL_STATS_MAX_APIS_PER_DAY; i += 1) {
      await recordDingtalkApiCall(`GET /api-${i}`);
    }
    const stats = await getDingtalkApiCallStats({ days: 1, now: new Date() });
    expect(stats.days[0]?.byApi).toHaveLength(DINGTALK_API_CALL_STATS_MAX_APIS_PER_DAY);
    expect(stats.days[0]?.byApi.some((row) => row.api === 'GET /api-0')).toBe(false);
    expect(
      stats.days[0]?.byApi.some(
        (row) => row.api === `GET /api-${DINGTALK_API_CALL_STATS_MAX_APIS_PER_DAY}`,
      ),
    ).toBe(true);
  });
});
