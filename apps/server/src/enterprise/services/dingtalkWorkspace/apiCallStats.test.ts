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
  DINGTALK_API_DAILY_ALERT_THRESHOLD_DEFAULT,
  dingtalkApiCallStatsRedisKey,
  formatDingtalkApiCallStatsDate,
  getDingtalkApiCallStats,
  getDingtalkApiCallTotal,
  readDingtalkApiDailyAlertThreshold,
  recordDingtalkApiCall,
  resetDingtalkApiCallStatsForTest,
  toDingtalkApiCallKey,
  topDingtalkApiCallEndpoints,
} = await import('./apiCallStats');

describe('toDingtalkApiCallKey', () => {
  it('drops query strings and templates only identifier-looking segments', () => {
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
    expect(
      toDingtalkApiCallKey('POST', '/v1.0/todo/users/iiHvS0V4s6abcdef/tasks/task0123456789ab'),
    ).toBe('POST /v1.0/todo/users/:id/tasks/:id');
    expect(
      toDingtalkApiCallKey(
        'GET',
        '/v1.0/calendar/users/iiHvS0V4s6abcdef/calendars/primary/events/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      ),
    ).toBe('GET /v1.0/calendar/users/:id/calendars/primary/events/:id');
    expect(toDingtalkApiCallKey('GET', '/v1.0/rooms/meetingRooms/ding0123456789ab')).toBe(
      'GET /v1.0/rooms/meetingRooms/:id',
    );
    expect(toDingtalkApiCallKey('POST', '/v1.0/workflow/forms/PROC-FF6Y2ABCD')).toBe(
      'POST /v1.0/workflow/forms/:id',
    );
    expect(toDingtalkApiCallKey('POST', '/topapi/v2/department/get')).toBe(
      'POST /topapi/v2/department/get',
    );
    expect(toDingtalkApiCallKey('GET', '/v1.0/workflow/processInstances/12345')).toBe(
      'GET /v1.0/workflow/processInstances/:id',
    );
    expect(toDingtalkApiCallKey('GET', '/v1.0/calendar/users/abc=def/querySchedule')).toBe(
      'GET /v1.0/calendar/users/:id/querySchedule',
    );
  });

  it('keeps DingTalk dictionary path segments used in this codebase', () => {
    const keys = [
      ['GET', '/v1.0/workflow/processInstances'],
      ['POST', '/v1.0/workflow/processes/instanceIds/query'],
      ['GET', '/v1.0/workflow/processes/userVisibilities/templates'],
      ['GET', '/v1.0/workflow/forms/schemas/processCodes'],
      ['POST', '/v1.0/workflow/processes/forecast'],
      ['POST', '/v1.0/workflow/processInstances'],
      ['POST', '/v1.0/workflow/processInstances/execute'],
      ['POST', '/v1.0/workflow/tasks/redirect'],
      ['POST', '/v1.0/workflow/processInstances/comments'],
      ['POST', '/v1.0/workflow/processInstances/terminate'],
      ['POST', '/v1.0/workflow/premium/tasks/revert'],
      ['POST', '/v1.0/workflow/premium/tasks/append'],
      ['GET', '/v1.0/workflow/premium/processCentres/todoTasks'],
      ['GET', '/v1.0/workflow/processes/todoTasks/numbers'],
      ['POST', '/v1.0/workflow/forms'],
      ['DELETE', '/v1.0/workflow/processCentres/schemas'],
      ['GET', '/v1.0/workflow/processes/managements/templates'],
      ['POST', '/topapi/v2/user/get'],
      ['GET', '/v1.0/rooms/meetingRoomLists'],
      ['POST', '/v1.0/todo/users/me/org/tasks/query'],
      ['POST', '/v1.0/todo/users/me/organizations/tasks/query'],
      ['POST', '/v1.0/todo/users/me/tasks'],
      ['GET', '/v1.0/calendar/users/me/calendars/primary/events'],
      ['GET', '/v1.0/calendar/users/me/calendars/primary/eventsview'],
      ['POST', '/v1.0/calendar/users/me/querySchedule'],
    ] as const;
    for (const [method, path] of keys) {
      expect(toDingtalkApiCallKey(method, path)).toBe(`${method} ${path}`);
    }
  });

  it('templates interpolated unionId / taskId / eventId / roomId on real call-site shapes', () => {
    const unionId = 'iiHvS0V4s6abcdef';
    const taskId = 'task0123456789ab';
    const eventId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    expect(toDingtalkApiCallKey('POST', `/v1.0/todo/users/${unionId}/org/tasks/query`)).toBe(
      'POST /v1.0/todo/users/:id/org/tasks/query',
    );
    expect(
      toDingtalkApiCallKey('POST', `/v1.0/todo/users/${unionId}/organizations/tasks/query`),
    ).toBe('POST /v1.0/todo/users/:id/organizations/tasks/query');
    expect(toDingtalkApiCallKey('POST', `/v1.0/todo/users/${unionId}/tasks`)).toBe(
      'POST /v1.0/todo/users/:id/tasks',
    );
    expect(toDingtalkApiCallKey('PUT', `/v1.0/todo/users/${unionId}/tasks/${taskId}`)).toBe(
      'PUT /v1.0/todo/users/:id/tasks/:id',
    );
    expect(toDingtalkApiCallKey('DELETE', `/v1.0/todo/users/${unionId}/tasks/${taskId}`)).toBe(
      'DELETE /v1.0/todo/users/:id/tasks/:id',
    );
    expect(
      toDingtalkApiCallKey('GET', `/v1.0/calendar/users/${unionId}/calendars/primary/events`),
    ).toBe('GET /v1.0/calendar/users/:id/calendars/primary/events');
    expect(
      toDingtalkApiCallKey(
        'GET',
        `/v1.0/calendar/users/${unionId}/calendars/primary/events/${eventId}`,
      ),
    ).toBe('GET /v1.0/calendar/users/:id/calendars/primary/events/:id');
    expect(
      toDingtalkApiCallKey(
        'POST',
        `/v1.0/calendar/users/${unionId}/calendars/primary/events/${eventId}/meetingRooms`,
      ),
    ).toBe('POST /v1.0/calendar/users/:id/calendars/primary/events/:id/meetingRooms');
    expect(
      toDingtalkApiCallKey(
        'POST',
        `/v1.0/calendar/users/${unionId}/calendars/primary/events/${eventId}/meetingRooms/batchRemove`,
      ),
    ).toBe('POST /v1.0/calendar/users/:id/calendars/primary/events/:id/meetingRooms/batchRemove');
    expect(
      toDingtalkApiCallKey(
        'POST',
        `/v1.0/calendar/users/${unionId}/calendars/primary/events/${eventId}/respond`,
      ),
    ).toBe('POST /v1.0/calendar/users/:id/calendars/primary/events/:id/respond');
    expect(
      toDingtalkApiCallKey('GET', `/v1.0/calendar/users/${unionId}/calendars/primary/eventsview`),
    ).toBe('GET /v1.0/calendar/users/:id/calendars/primary/eventsview');
    expect(toDingtalkApiCallKey('POST', `/v1.0/calendar/users/${unionId}/querySchedule`)).toBe(
      'POST /v1.0/calendar/users/:id/querySchedule',
    );
  });

  it('does not collapse processes / processInstances into :id (live over-templating)', () => {
    expect(toDingtalkApiCallKey('POST', '/v1.0/workflow/processes/instanceIds/query')).toBe(
      'POST /v1.0/workflow/processes/instanceIds/query',
    );
    expect(toDingtalkApiCallKey('GET', '/v1.0/workflow/processInstances')).toBe(
      'GET /v1.0/workflow/processInstances',
    );
    expect(toDingtalkApiCallKey('GET', '/v1.0/workflow/premium/processCentres/todoTasks')).toBe(
      'GET /v1.0/workflow/premium/processCentres/todoTasks',
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

describe('getDingtalkApiCallTotal', () => {
  beforeEach(() => {
    resetDingtalkApiCallStatsForTest();
    redisMocks.getRedis.mockReset();
    redisMocks.hgetall.mockReset().mockResolvedValue({});
    redisMocks.getRedis.mockReturnValue({ hgetall: redisMocks.hgetall });
  });

  afterEach(() => {
    resetDingtalkApiCallStatsForTest();
  });

  it('sums every field of the Shanghai-day hash and ranks endpoints', async () => {
    const now = new Date('2026-09-21T16:30:00.000Z');
    vi.useFakeTimers({ now });
    try {
      const date = formatDingtalkApiCallStatsDate(now);
      expect(date).toBe('2026-09-22');
      redisMocks.hgetall.mockResolvedValue({
        'GET /c': '40',
        'GET /f': '5',
        'POST /a': '3000',
        'POST /b': '800',
        'POST /d': '20',
        'POST /e': '10',
      });
      redisMocks.getRedis.mockReturnValueOnce(null);
      await recordDingtalkApiCall('GET /memory-only');
      redisMocks.getRedis.mockReturnValue({ hgetall: redisMocks.hgetall });
      const total = await getDingtalkApiCallTotal(date);
      expect(total).toEqual({
        byApi: [
          { api: 'POST /a', count: 3000 },
          { api: 'POST /b', count: 800 },
          { api: 'GET /c', count: 40 },
          { api: 'POST /d', count: 20 },
          { api: 'POST /e', count: 10 },
          { api: 'GET /f', count: 5 },
        ],
        date,
        total: 3875,
      });
      expect(topDingtalkApiCallEndpoints(total?.byApi ?? []).map((row) => row.api)).toEqual([
        'POST /a',
        'POST /b',
        'GET /c',
        'POST /d',
        'POST /e',
      ]);
      expect(redisMocks.hgetall).toHaveBeenCalledWith(dingtalkApiCallStatsRedisKey(date));
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null when Redis cannot be read', async () => {
    redisMocks.getRedis.mockReturnValue(null);
    await recordDingtalkApiCall('POST /a');
    await expect(getDingtalkApiCallTotal('2026-09-22')).resolves.toBeNull();
  });

  it('reads the daily alert threshold, with 0 as off and garbage as the default', () => {
    expect(DINGTALK_API_DAILY_ALERT_THRESHOLD_DEFAULT).toBe(5000);
    expect(readDingtalkApiDailyAlertThreshold({})).toBe(5000);
    expect(readDingtalkApiDailyAlertThreshold({ DINGTALK_API_DAILY_ALERT_THRESHOLD: '0' })).toBe(0);
    expect(readDingtalkApiDailyAlertThreshold({ DINGTALK_API_DAILY_ALERT_THRESHOLD: '8000' })).toBe(
      8000,
    );
    expect(readDingtalkApiDailyAlertThreshold({ DINGTALK_API_DAILY_ALERT_THRESHOLD: 'nope' })).toBe(
      5000,
    );
    expect(readDingtalkApiDailyAlertThreshold({ DINGTALK_API_DAILY_ALERT_THRESHOLD: '-3' })).toBe(
      5000,
    );
  });
});
