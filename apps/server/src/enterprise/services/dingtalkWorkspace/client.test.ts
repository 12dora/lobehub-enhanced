// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNotifyAppToken = vi.hoisted(() => vi.fn());
const getNotifyAppNewApiToken = vi.hoisted(() => vi.fn());
const invalidateNotifyAppToken = vi.hoisted(() => vi.fn());
const invalidateNotifyAppNewApiToken = vi.hoisted(() => vi.fn());

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
    }
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
});
