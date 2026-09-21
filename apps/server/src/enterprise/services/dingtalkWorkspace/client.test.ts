// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNotifyAppToken = vi.hoisted(() => vi.fn());
const getNotifyAppNewApiToken = vi.hoisted(() => vi.fn());
const invalidateNotifyAppToken = vi.hoisted(() => vi.fn());
const invalidateNotifyAppNewApiToken = vi.hoisted(() => vi.fn());
const debugLog = vi.hoisted(() => vi.fn());

vi.mock('debug', () => ({
  default: () => debugLog,
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/notifyApp', () => ({
  DINGTALK_API_BASE: 'https://api.dingtalk.com',
  DINGTALK_OAPI_BASE: 'https://oapi.dingtalk.com',
  DingTalkNotifyAppError: class DingTalkNotifyAppError extends Error {
    errcode: string | number | null;
    constructor(message: string, errcode?: string | number | null) {
      super(message);
      this.name = 'DingTalkNotifyAppError';
      this.errcode = errcode ?? null;
    }
  },
  getNotifyAppNewApiToken,
  getNotifyAppToken,
  invalidateNotifyAppNewApiToken,
  invalidateNotifyAppToken,
}));

const {
  DINGTALK_WORKSPACE_MAX_RPS,
  DINGTALK_WORKSPACE_RATE_MAX_WAIT_MS,
  DINGTALK_WORKSPACE_RATE_MAX_WAITERS,
  dingtalkWorkspaceRequest,
  parseDingtalkMissingScopes,
  resetDingtalkWorkspaceRequestRateForTest,
  setDingtalkWorkspaceFetchForTest,
} = await import('./client');
const { DingtalkWorkspaceError } = await import('./errors');

const flushMicrotasks = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};

const okFetch = async () => ({
  json: async () => ({ ok: true }),
  ok: true,
  status: 200,
  text: async () => '',
});

const requestOnce = () =>
  dingtalkWorkspaceRequest({
    api: 'v1',
    method: 'GET',
    path: '/v1.0/workflow/processInstances',
  });

describe('dingtalkWorkspaceRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNotifyAppToken.mockResolvedValue('oapi-token');
    getNotifyAppNewApiToken.mockResolvedValue('new-token');
    setDingtalkWorkspaceFetchForTest(null);
    resetDingtalkWorkspaceRequestRateForTest();
  });

  it('sends v1 requests with the new-API token header', async () => {
    setDingtalkWorkspaceFetchForTest(async (url, init) => {
      expect(url).toContain('https://api.dingtalk.com/v1.0/workflow/processInstances');
      expect(url).toContain('processInstanceId=abc');
      expect(init?.headers).toMatchObject({
        'x-acs-dingtalk-access-token': 'new-token',
      });
      expect(init?.method).toBe('GET');
      return {
        json: async () => ({ title: 'ok' }),
        ok: true,
        status: 200,
        text: async () => '',
      };
    });

    const result = await dingtalkWorkspaceRequest<{ title: string }>({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/processInstances',
      query: { processInstanceId: 'abc' },
    });
    expect(result).toEqual({ title: 'ok' });
    expect(getNotifyAppNewApiToken).toHaveBeenCalled();
  });

  it('maps missing notify-app config to DINGTALK_NOT_CONFIGURED', async () => {
    const { DingTalkNotifyAppError } =
      await import('@/server/services/messenger/platforms/dingtalk/notifyApp');
    getNotifyAppNewApiToken.mockRejectedValueOnce(
      new DingTalkNotifyAppError('not configured', 'notify_app_not_configured'),
    );

    await expect(
      dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'GET',
        path: '/v1.0/workflow/processInstances',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_CONFIGURED' });
  });

  it('maps 403 to DINGTALK_FORBIDDEN and keeps upstreamCode off the message', async () => {
    setDingtalkWorkspaceFetchForTest(async () => ({
      json: async () => ({ code: 'Forbidden.AccessDenied', message: 'no permission' }),
      ok: false,
      status: 403,
      text: async () => '',
    }));

    try {
      await dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'GET',
        path: '/v1.0/workflow/processes/userVisibilities/templates',
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DingtalkWorkspaceError);
      if (!(error instanceof DingtalkWorkspaceError)) throw error;
      expect(error.code).toBe('DINGTALK_FORBIDDEN');
      expect(error.upstreamCode).toBe('Forbidden.AccessDenied');
      expect(error.message).toBe('DINGTALK_FORBIDDEN');
      expect(error.missingScopes).toBeUndefined();
    }
  });

  it('parses missing scope codes from AccessTokenPermissionDenied 403 bodies', async () => {
    setDingtalkWorkspaceFetchForTest(async () => ({
      json: async () => ({
        code: 'Forbidden.AccessDenied.AccessTokenPermissionDenied',
        message:
          '应用尚未开通所需的权限：[Calendar.Event.Write]，点击链接申请并开通即可：https://open-dev.dingtalk.com/appscope/apply?content=abc',
      }),
      ok: false,
      status: 403,
      text: async () => '',
    }));

    try {
      await dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'POST',
        path: '/v1.0/calendar/users/union-1/calendars/primary/events',
        body: {},
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DingtalkWorkspaceError);
      if (!(error instanceof DingtalkWorkspaceError)) throw error;
      expect(error.code).toBe('DINGTALK_FORBIDDEN');
      expect(error.upstreamCode).toBe('Forbidden.AccessDenied.AccessTokenPermissionDenied');
      expect(error.missingScopes).toEqual(['Calendar.Event.Write']);
      expect(error.message).toBe('DINGTALK_FORBIDDEN');
      expect(JSON.stringify(error.missingScopes)).not.toContain('https://');
      expect(JSON.stringify(error.missingScopes)).not.toContain('权限');
    }
  });

  it('maps a missing Premium scope to PREMIUM_REQUIRED', async () => {
    setDingtalkWorkspaceFetchForTest(async () => ({
      json: async () => ({
        code: 'Forbidden.AccessDenied.AccessTokenPermissionDenied',
        message: '应用尚未开通所需的权限：[Premium.Workflow.ReadWrite.All]',
      }),
      ok: false,
      status: 403,
      text: async () => '',
    }));

    await expect(
      dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'POST',
        path: '/v1.0/workflow/premium/tasks/revert',
        body: {},
      }),
    ).rejects.toMatchObject({
      code: 'DINGTALK_PREMIUM_REQUIRED',
      upstreamCode: 'Forbidden.AccessDenied.AccessTokenPermissionDenied',
    });
  });

  it.each(['QpsLimitForAppkeyAndApi', 'QpsLimitForApi', 'QpsLimit'] as const)(
    'maps 403 %s to DINGTALK_RATE_LIMITED',
    async (upstreamCode) => {
      setDingtalkWorkspaceFetchForTest(async () => ({
        json: async () => ({ code: upstreamCode, message: 'qps limit' }),
        ok: false,
        status: 403,
        text: async () => '',
      }));

      await expect(requestOnce()).rejects.toMatchObject({
        code: 'DINGTALK_RATE_LIMITED',
        upstreamCode,
      });
    },
  );

  it('parses one or more bracketed scope codes after 权限, including fullwidth brackets', () => {
    expect(
      parseDingtalkMissingScopes(
        '应用尚未开通所需的权限：[Calendar.Event.Write]，点击链接申请并开通即可：https://open-dev.dingtalk.com/appscope/apply?content=abc',
      ),
    ).toEqual(['Calendar.Event.Write']);
    expect(
      parseDingtalkMissingScopes('权限：[Calendar.Event.Write, Calendar.EventSchedule.Read]'),
    ).toEqual(['Calendar.Event.Write', 'Calendar.EventSchedule.Read']);
    expect(parseDingtalkMissingScopes('权限：［Todo.Todo.Write］')).toEqual(['Todo.Todo.Write']);
    expect(parseDingtalkMissingScopes('no permission')).toBeUndefined();
    expect(
      parseDingtalkMissingScopes(
        'https://open-dev.dingtalk.com/appscope/apply?content=Calendar.Event.Write',
      ),
    ).toBeUndefined();
  });

  it('retries once after an invalid access token', async () => {
    let calls = 0;
    setDingtalkWorkspaceFetchForTest(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          json: async () => ({ errcode: 40014, errmsg: 'invalid access_token' }),
          ok: true,
          status: 200,
          text: async () => '',
        };
      }
      return {
        json: async () => ({ errcode: 0, result: { name: 'Ada' } }),
        ok: true,
        status: 200,
        text: async () => '',
      };
    });

    const result = await dingtalkWorkspaceRequest<{ name: string }>({
      api: 'legacy',
      body: { userid: 'staff-1' },
      method: 'POST',
      path: '/topapi/v2/user/get',
    });
    expect(result).toEqual({ name: 'Ada' });
    expect(calls).toBe(2);
    expect(invalidateNotifyAppToken).toHaveBeenCalled();
  });

  it('spaces extra requests beyond the process-wide token bucket', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      resetDingtalkWorkspaceRequestRateForTest();
      let started = 0;
      setDingtalkWorkspaceFetchForTest(async () => {
        started += 1;
        return okFetch();
      });

      await Promise.all(Array.from({ length: DINGTALK_WORKSPACE_MAX_RPS }, () => requestOnce()));
      expect(started).toBe(DINGTALK_WORKSPACE_MAX_RPS);

      const extra = requestOnce();
      await flushMicrotasks();
      expect(started).toBe(DINGTALK_WORKSPACE_MAX_RPS);

      await vi.advanceTimersByTimeAsync(Math.ceil(1000 / DINGTALK_WORKSPACE_MAX_RPS) + 5);
      await extra;
      expect(started).toBe(DINGTALK_WORKSPACE_MAX_RPS + 1);
    } finally {
      vi.useRealTimers();
      resetDingtalkWorkspaceRequestRateForTest();
    }
  });

  it('rejects when more than 200 callers wait for a rate token', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      resetDingtalkWorkspaceRequestRateForTest({
        refilledAtMs: 1_000_000 + 60_000,
        tokens: 0,
      });
      setDingtalkWorkspaceFetchForTest(okFetch);

      const waiters = Array.from({ length: DINGTALK_WORKSPACE_RATE_MAX_WAITERS }, () =>
        requestOnce(),
      );
      const overflow = requestOnce();
      await expect(overflow).rejects.toMatchObject({ code: 'DINGTALK_RATE_LIMITED' });

      await vi.advanceTimersByTimeAsync(DINGTALK_WORKSPACE_RATE_MAX_WAIT_MS);
      await Promise.allSettled(waiters);
    } finally {
      vi.useRealTimers();
      resetDingtalkWorkspaceRequestRateForTest();
    }
  });

  it('rejects after waiting 15s without a rate token', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      resetDingtalkWorkspaceRequestRateForTest({ refillRps: 0, tokens: 0 });
      setDingtalkWorkspaceFetchForTest(okFetch);

      const pending = requestOnce();
      const settled = expect(pending).rejects.toMatchObject({ code: 'DINGTALK_RATE_LIMITED' });
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(DINGTALK_WORKSPACE_RATE_MAX_WAIT_MS);
      await settled;
    } finally {
      vi.useRealTimers();
      resetDingtalkWorkspaceRequestRateForTest();
    }
  });

  it('pins requests to the DingTalk origin and rejects open paths', async () => {
    const fetchImpl = vi.fn(okFetch);
    setDingtalkWorkspaceFetchForTest(fetchImpl);

    await expect(
      dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'GET',
        path: '//evil.example/v1.0/workflow',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
    await expect(
      dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'GET',
        path: 'https://evil.example/v1.0/workflow',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
    await expect(
      dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'GET',
        path: 'v1.0/workflow/processInstances',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
    await expect(
      dingtalkWorkspaceRequest({
        api: 'legacy',
        method: 'GET',
        path: 'user@evil.example/topapi/v2/user/get',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
    await expect(
      dingtalkWorkspaceRequest({
        api: 'v1',
        method: 'GET',
        path: 'foo\\bar/v1.0/workflow',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps nextToken in the query string and sets redirect error', async () => {
    setDingtalkWorkspaceFetchForTest(async (url, init) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://api.dingtalk.com');
      expect(parsed.pathname).toBe('/v1.0/workflow/processes/userVisibilities/templates');
      expect(parsed.searchParams.get('userId')).toBe('staff-1');
      expect(parsed.searchParams.get('maxResults')).toBe('1');
      expect(parsed.searchParams.get('nextToken')).toBe('0');
      expect(init?.redirect).toBe('error');
      expect(init?.method).toBe('GET');
      return {
        json: async () => ({ result: { processList: [] } }),
        ok: true,
        status: 200,
        text: async () => '',
      };
    });

    await dingtalkWorkspaceRequest({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/processes/userVisibilities/templates',
      query: { userId: 'staff-1', maxResults: 1, nextToken: 0 },
    });
  });

  it('puts access_token on legacy URLs but logs only method and pathname', async () => {
    setDingtalkWorkspaceFetchForTest(async (url, init) => {
      expect(url).toContain('access_token=oapi-token');
      expect(new URL(url).pathname).toBe('/topapi/v2/user/get');
      expect(init?.redirect).toBe('error');
      return {
        json: async () => ({ errcode: 0, result: { name: 'Ada' } }),
        ok: true,
        status: 200,
        text: async () => '',
      };
    });

    await dingtalkWorkspaceRequest({
      api: 'legacy',
      method: 'GET',
      path: '/topapi/v2/user/get',
    });

    const logged = debugLog.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('GET');
    expect(logged).toContain('/topapi/v2/user/get');
    expect(logged).not.toContain('access_token');
    expect(logged).not.toContain('oapi-token');
    expect(logged).not.toContain('https://oapi.dingtalk.com');
  });

  it('maps AbortError and timeouts to DINGTALK_UNAVAILABLE', async () => {
    setDingtalkWorkspaceFetchForTest(async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(requestOnce()).rejects.toMatchObject({ code: 'DINGTALK_UNAVAILABLE' });
  });
});
