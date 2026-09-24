// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelled: vi.fn(),
  finalize: vi.fn(),
  getJob: vi.fn(),
  getStored: vi.fn(),
  interpret: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => ({ kind: 'db' }),
}));

vi.mock('./brokerClient', () => ({
  getDingtalkPersonalLoginJob: (...args: unknown[]) => mocks.getJob(...args),
}));

vi.mock('./loginStore', () => ({
  getStoredDingtalkPersonalLogin: (...args: unknown[]) => mocks.getStored(...args),
  isDingtalkPersonalLoginCancelled: (...args: unknown[]) => mocks.cancelled(...args),
  updateStoredDingtalkPersonalLogin: (...args: unknown[]) => mocks.update(...args),
}));

vi.mock('./service', () => ({
  finalizeDingtalkPersonalLogin: (...args: unknown[]) => mocks.finalize(...args),
  interpretDingtalkPersonalLoginJob: (...args: unknown[]) => mocks.interpret(...args),
}));

const {
  DINGTALK_PERSONAL_LOGIN_POLL_MS,
  DINGTALK_PERSONAL_LOGIN_WATCH_MS,
  resetDingtalkPersonalLoginWatchersForTest,
  setDingtalkPersonalLoginNotifyLoaderForTest,
  stopDingtalkPersonalLoginWatch,
  watchDingtalkPersonalLogin,
} = await import('./loginWatcher');

const job = {
  expiresAt: '2026-09-24T00:15:00.000Z',
  jobId: 'job-1',
  status: 'succeeded' as const,
  userCode: 'JCHB-KBXF',
  verificationUrl: 'https://login.dingtalk.com/verify?user_code=JCHB-KBXF',
  identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '甲' },
};

const meta = {
  createdAt: '2026-09-24T00:00:00.000Z',
  expectedProfile: 'dingcorp:staff1',
  expiresAt: job.expiresAt,
  jobId: 'job-1',
  origin: 'dingtalk' as const,
  status: 'pending' as const,
  userCode: job.userCode,
  userId: 'user-a',
  verificationUrl: job.verificationUrl,
};

describe('dingtalk personal login watcher', () => {
  const notify = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    resetDingtalkPersonalLoginWatchersForTest();
    mocks.cancelled.mockReset();
    mocks.finalize.mockReset();
    mocks.getJob.mockReset();
    mocks.getStored.mockReset();
    mocks.interpret.mockReset();
    mocks.update.mockReset();
    notify.mockReset();
    mocks.cancelled.mockResolvedValue(false);
    mocks.finalize.mockResolvedValue(true);
    mocks.getStored.mockResolvedValue(meta);
    mocks.getJob.mockResolvedValue(job);
    mocks.interpret.mockImplementation((_stored: unknown, current: typeof job) => ({
      reject: false,
      userName: current.identity.userName,
      view: {
        expiresAt: current.expiresAt,
        jobId: current.jobId,
        status: current.status,
        userCode: current.userCode,
        verificationUrl: current.verificationUrl,
      },
    }));
    setDingtalkPersonalLoginNotifyLoaderForTest(async () => ({
      notifyDingtalkPersonalLoginResult: notify,
    }));
  });

  afterEach(() => {
    resetDingtalkPersonalLoginWatchersForTest();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('unrefs the poll timer and does not start a second one', () => {
    const unref = vi.fn();
    const original = global.setInterval;
    vi.spyOn(global, 'setInterval').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
    ) => {
      const timer = original(handler, timeout) as unknown as NodeJS.Timeout;
      vi.spyOn(timer, 'unref').mockImplementation(() => {
        unref();
        return timer;
      });
      return timer;
    }) as unknown as typeof setInterval);
    watchDingtalkPersonalLogin('job-1');
    watchDingtalkPersonalLogin('job-1');
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('finalizes a succeeded job once and notifies a dingtalk origin', async () => {
    watchDingtalkPersonalLogin('job-1');
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.finalize).toHaveBeenCalledWith({ kind: 'db' }, meta, job);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, staffId: 'staff1', userId: 'user-a', userName: '甲' }),
    );
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
  });

  it('does not notify a web origin and does not finalize a mismatched success', async () => {
    mocks.getStored.mockResolvedValue({ ...meta, origin: 'web' });
    mocks.interpret.mockReturnValue({
      reject: true,
      userName: '别人',
      view: {
        errorCode: 'IDENTITY_MISMATCH',
        expiresAt: job.expiresAt,
        jobId: job.jobId,
        mismatchUserName: '别人',
        status: 'failed',
        userCode: job.userCode,
        verificationUrl: job.verificationUrl,
      },
    });
    watchDingtalkPersonalLogin('job-1');
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('stops at 16 minutes', async () => {
    mocks.getJob.mockResolvedValue({ ...job, identity: undefined, status: 'pending' });
    mocks.interpret.mockImplementation((_stored: unknown, current: { status: string }) => ({
      reject: false,
      view: {
        expiresAt: job.expiresAt,
        jobId: job.jobId,
        status: current.status,
        userCode: job.userCode,
        verificationUrl: job.verificationUrl,
      },
    }));
    watchDingtalkPersonalLogin('job-1');
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.now() + DINGTALK_PERSONAL_LOGIN_WATCH_MS));
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
  });

  it('does not finalize a job the user cancelled while it was pending', async () => {
    mocks.cancelled.mockResolvedValue(true);
    watchDingtalkPersonalLogin('job-1');
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    stopDingtalkPersonalLoginWatch('job-1');

    mocks.cancelled.mockReset();
    mocks.getJob.mockClear();
    mocks.cancelled.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    watchDingtalkPersonalLogin('job-2');
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    stopDingtalkPersonalLoginWatch('job-2');

    mocks.cancelled.mockReset();
    mocks.getJob.mockClear();
    mocks.update.mockClear();
    mocks.finalize.mockClear();
    mocks.cancelled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    watchDingtalkPersonalLogin('job-3');
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('swallows a notify failure', async () => {
    notify.mockRejectedValue(new Error('card down'));
    watchDingtalkPersonalLogin('job-1');
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_LOGIN_POLL_MS);
    expect(notify).toHaveBeenCalled();
    expect(mocks.finalize).toHaveBeenCalled();
  });
});
