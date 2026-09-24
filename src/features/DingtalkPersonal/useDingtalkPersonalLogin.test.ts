// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DingtalkPersonalLoginView } from '@/services/dingtalkPersonal';

import {
  LOGIN_EXPIRY_GRACE_MS,
  LOGIN_POLL_INTERVAL_MS,
  useDingtalkPersonalLogin,
} from './useDingtalkPersonalLogin';

const mocks = vi.hoisted(() => ({
  cancelLogin: vi.fn(),
  getLoginJob: vi.fn(),
  startLogin: vi.fn(),
}));

vi.mock('@/services/dingtalkPersonal', () => ({
  dingtalkPersonalService: {
    cancelLogin: mocks.cancelLogin,
    getLoginJob: mocks.getLoginJob,
    startLogin: mocks.startLogin,
  },
}));

const NOW = new Date('2026-09-24T08:00:00.000Z');

const job = (overrides: Partial<DingtalkPersonalLoginView> = {}): DingtalkPersonalLoginView => ({
  expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
  jobId: 'job_1',
  status: 'pending',
  userCode: 'ABCD-EFGH',
  verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=ABCD-EFGH',
  ...overrides,
});

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // Let the poll's own await (request → settle) land before asserting.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  mocks.cancelLogin.mockReset().mockResolvedValue({ ok: true });
  mocks.getLoginJob.mockReset();
  mocks.startLogin.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDingtalkPersonalLogin', () => {
  it('starts a login, polls it every 3 s and reports success once', async () => {
    const onSucceeded = vi.fn();
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(job({ status: 'succeeded' }));

    const { result } = renderHook(() => useDingtalkPersonalLogin({ onSucceeded }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.login).toMatchObject({ jobId: 'job_1', status: 'pending' });
    expect(mocks.getLoginJob).not.toHaveBeenCalled();

    await advance(LOGIN_POLL_INTERVAL_MS);
    expect(mocks.getLoginJob).toHaveBeenCalledTimes(1);
    expect(mocks.getLoginJob).toHaveBeenCalledWith({ jobId: 'job_1' });
    expect(onSucceeded).not.toHaveBeenCalled();

    await advance(LOGIN_POLL_INTERVAL_MS);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(result.current.login?.status).toBe('succeeded');

    await advance(LOGIN_POLL_INTERVAL_MS * 3);
    expect(mocks.getLoginJob).toHaveBeenCalledTimes(2);
    expect(onSucceeded).toHaveBeenCalledTimes(1);

    act(() => result.current.reset());
    expect(result.current.login).toBeUndefined();
  });

  it('keeps a failed job in view with its reason and stops polling', async () => {
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob.mockResolvedValue(
      job({ errorCode: 'IDENTITY_MISMATCH', mismatchUserName: '李四', status: 'failed' }),
    );

    const { result } = renderHook(() => useDingtalkPersonalLogin());
    await act(async () => {
      await result.current.start();
    });
    await advance(LOGIN_POLL_INTERVAL_MS);

    expect(result.current.login).toMatchObject({
      errorCode: 'IDENTITY_MISMATCH',
      mismatchUserName: '李四',
      status: 'failed',
    });
    await advance(LOGIN_POLL_INTERVAL_MS * 2);
    expect(mocks.getLoginJob).toHaveBeenCalledTimes(1);
  });

  it('carries the router code of a start that failed', async () => {
    mocks.startLogin.mockRejectedValue(new Error('DINGTALK_PERSONAL_BROKER_UNAVAILABLE'));

    const { result } = renderHook(() => useDingtalkPersonalLogin());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.startError).toEqual({ code: 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE' });
    expect(result.current.login).toBeUndefined();
  });

  it('resumes a job the server still holds and drops it for good on cancel', async () => {
    mocks.getLoginJob.mockResolvedValue(job());
    const pendingLogin = job();

    const { result } = renderHook(() => useDingtalkPersonalLogin({ pendingLogin }));
    expect(result.current.login).toEqual(pendingLogin);

    await advance(LOGIN_POLL_INTERVAL_MS);
    expect(mocks.getLoginJob).toHaveBeenCalledWith({ jobId: 'job_1' });

    await act(async () => {
      await result.current.cancel();
    });
    expect(mocks.cancelLogin).toHaveBeenCalledWith({ jobId: 'job_1' });
    // A stale status read still reporting the job must not bring it back.
    expect(result.current.login).toBeUndefined();

    const calls = mocks.getLoginJob.mock.calls.length;
    await advance(LOGIN_POLL_INTERVAL_MS * 2);
    expect(mocks.getLoginJob).toHaveBeenCalledTimes(calls);
  });

  it('keeps the job shown and polled when the cancel did not reach the server', async () => {
    mocks.getLoginJob.mockResolvedValue(job());
    mocks.cancelLogin.mockRejectedValueOnce(new Error('DINGTALK_PERSONAL_BROKER_UNAVAILABLE'));

    const { result } = renderHook(() => useDingtalkPersonalLogin({ pendingLogin: job() }));
    await act(async () => {
      await result.current.cancel();
    });

    // The code can still be approved, so it must not disappear behind a fresh 授权 button.
    expect(result.current.login).toMatchObject({ jobId: 'job_1', status: 'pending' });
    expect(result.current.cancelFailed).toBe(true);
    expect(result.current.cancelling).toBe(false);

    const calls = mocks.getLoginJob.mock.calls.length;
    await advance(LOGIN_POLL_INTERVAL_MS);
    expect(mocks.getLoginJob.mock.calls.length).toBeGreaterThan(calls);

    // A second try that lands clears both the job and the error.
    await act(async () => {
      await result.current.cancel();
    });
    expect(mocks.cancelLogin).toHaveBeenCalledTimes(2);
    expect(result.current.login).toBeUndefined();
    expect(result.current.cancelFailed).toBe(false);
  });

  it('treats a job the server no longer knows as cancelled', async () => {
    mocks.getLoginJob.mockResolvedValue(job());
    mocks.cancelLogin.mockRejectedValueOnce(new Error('DINGTALK_PERSONAL_LOGIN_NOT_FOUND'));

    const { result } = renderHook(() => useDingtalkPersonalLogin({ pendingLogin: job() }));
    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.login).toBeUndefined();
    expect(result.current.cancelFailed).toBe(false);
  });

  it('never cancels on unmount — the server keeps finalizing — but stops polling', async () => {
    mocks.getLoginJob.mockResolvedValue(job());

    const { unmount } = renderHook(() => useDingtalkPersonalLogin({ pendingLogin: job() }));
    await advance(LOGIN_POLL_INTERVAL_MS);
    const calls = mocks.getLoginJob.mock.calls.length;

    unmount();
    await advance(LOGIN_POLL_INTERVAL_MS * 3);

    expect(mocks.cancelLogin).not.toHaveBeenCalled();
    expect(mocks.getLoginJob).toHaveBeenCalledTimes(calls);
  });

  it('gives up on a code once its lifetime and the grace period are over', async () => {
    mocks.getLoginJob.mockResolvedValue(job());
    const shortLived = job({ expiresAt: new Date(NOW.getTime() + 5000).toISOString() });

    const { result } = renderHook(() => useDingtalkPersonalLogin({ pendingLogin: shortLived }));
    await advance(5000 + LOGIN_EXPIRY_GRACE_MS + LOGIN_POLL_INTERVAL_MS);

    expect(result.current.login?.status).toBe('expired');
    const calls = mocks.getLoginJob.mock.calls.length;
    await advance(LOGIN_POLL_INTERVAL_MS * 2);
    expect(mocks.getLoginJob).toHaveBeenCalledTimes(calls);
  });

  it('reads a job the server no longer knows as expired', async () => {
    mocks.getLoginJob.mockRejectedValue(new Error('DINGTALK_PERSONAL_LOGIN_NOT_FOUND'));

    const { result } = renderHook(() => useDingtalkPersonalLogin({ pendingLogin: job() }));
    await advance(LOGIN_POLL_INTERVAL_MS);

    expect(result.current.login?.status).toBe('expired');
  });

  it('keeps polling through a transient error', async () => {
    mocks.getLoginJob
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(job({ status: 'succeeded' }));
    const onSucceeded = vi.fn();

    renderHook(() => useDingtalkPersonalLogin({ onSucceeded, pendingLogin: job() }));
    await advance(LOGIN_POLL_INTERVAL_MS * 2);

    expect(onSucceeded).toHaveBeenCalledTimes(1);
  });
});
