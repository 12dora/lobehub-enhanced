// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisBag = vi.hoisted(() => ({ current: null as FakeRedis | null }));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisBag.current,
}));

class FakeRedis {
  readonly store = new Map<string, { expiresAt: number; value: string }>();

  private live(key: string) {
    const row = this.store.get(key);
    if (!row || row.expiresAt <= Date.now()) {
      if (row) this.store.delete(key);
      return undefined;
    }
    return row;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ex?: string, ttl?: number, nx?: string) {
    if (nx === 'NX' && this.live(key)) return null;
    this.store.set(key, {
      expiresAt:
        ex === 'EX' && typeof ttl === 'number' ? Date.now() + ttl * 1000 : Number.POSITIVE_INFINITY,
      value,
    });
    return 'OK';
  }

  async incr() {
    return 1;
  }

  async expire() {
    return 1;
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count += 1;
    return count;
  }
}

const {
  claimDingtalkPersonalFinalize,
  clearDingtalkPersonalLoginCancelled,
  getDingtalkPersonalLoginForUser,
  getStoredDingtalkPersonalLogin,
  isDingtalkPersonalLoginCancelled,
  markDingtalkPersonalLoginCancelled,
  putStoredDingtalkPersonalLogin,
  resetDingtalkPersonalLoginStoreForTest,
} = await import('./loginStore');

const record = {
  createdAt: '2026-09-24T00:00:00.000Z',
  expectedProfile: 'dingcorp:staff1',
  expiresAt: '2026-09-24T00:15:00.000Z',
  jobId: 'job-owner-a',
  origin: 'web' as const,
  status: 'pending' as const,
  userCode: 'JCHB-KBXF',
  userId: 'user-a',
  verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF',
};

describe('dingtalk personal login store', () => {
  beforeEach(() => {
    resetDingtalkPersonalLoginStoreForTest();
    redisBag.current = new FakeRedis();
  });

  it('lets only the starting user read the job, including the in-memory fallback', async () => {
    await putStoredDingtalkPersonalLogin(record);
    await expect(getDingtalkPersonalLoginForUser('user-b')).resolves.toBeNull();
    await expect(getStoredDingtalkPersonalLogin('job-owner-a')).resolves.toMatchObject({
      userId: 'user-a',
    });
    await expect(getDingtalkPersonalLoginForUser('user-a')).resolves.toMatchObject({
      jobId: 'job-owner-a',
    });

    redisBag.current = null;
    resetDingtalkPersonalLoginStoreForTest();
    await putStoredDingtalkPersonalLogin(record);
    await expect(getDingtalkPersonalLoginForUser('user-b')).resolves.toBeNull();
    await expect(getDingtalkPersonalLoginForUser('user-a')).resolves.toMatchObject({
      verificationUrl: record.verificationUrl,
    });
  });

  it('claims finalize once', async () => {
    await expect(claimDingtalkPersonalFinalize('job-owner-a')).resolves.toBe(true);
    await expect(claimDingtalkPersonalFinalize('job-owner-a')).resolves.toBe(false);
  });

  it('rejects a job id that could escape the redis key', async () => {
    await putStoredDingtalkPersonalLogin({ ...record, jobId: 'job/../other' });
    await expect(getStoredDingtalkPersonalLogin('job/../other')).resolves.toBeNull();
  });

  it('writes an in-memory login back to redis after a miss', async () => {
    redisBag.current = null;
    await putStoredDingtalkPersonalLogin(record);
    const redis = new FakeRedis();
    redisBag.current = redis;

    await expect(getStoredDingtalkPersonalLogin(record.jobId)).resolves.toMatchObject({
      userId: 'user-a',
      verificationUrl: record.verificationUrl,
    });
    expect(redis.store.get('dingtalk-personal:login:job-owner-a')?.value).toContain('user-a');

    redis.store.clear();
    await expect(getDingtalkPersonalLoginForUser('user-a')).resolves.toMatchObject({
      jobId: 'job-owner-a',
    });
    expect(redis.store.get('dingtalk-personal:login-user:user-a')?.value).toBe('job-owner-a');
    expect(redis.store.has('dingtalk-personal:login:job-owner-a')).toBe(true);
  });

  it('keeps a cancelled marker after the job record is deleted', async () => {
    await markDingtalkPersonalLoginCancelled(record.jobId);
    await expect(isDingtalkPersonalLoginCancelled(record.jobId)).resolves.toBe(true);
    expect(redisBag.current?.store.has(`dingtalk-personal:login-cancelled:${record.jobId}`)).toBe(
      true,
    );
    await clearDingtalkPersonalLoginCancelled(record.jobId);
    await expect(isDingtalkPersonalLoginCancelled(record.jobId)).resolves.toBe(false);

    redisBag.current = null;
    resetDingtalkPersonalLoginStoreForTest();
    await markDingtalkPersonalLoginCancelled(record.jobId);
    await expect(isDingtalkPersonalLoginCancelled(record.jobId)).resolves.toBe(true);
    await clearDingtalkPersonalLoginCancelled(record.jobId);
    await expect(isDingtalkPersonalLoginCancelled(record.jobId)).resolves.toBe(false);
    await expect(isDingtalkPersonalLoginCancelled('job/../other')).resolves.toBe(false);
  });

  it('does not revive an expired in-memory login on a redis miss', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      redisBag.current = null;
      await putStoredDingtalkPersonalLogin(record);
      vi.setSystemTime(new Date('2026-09-24T00:21:00.000Z'));
      const redis = new FakeRedis();
      redisBag.current = redis;
      await expect(getStoredDingtalkPersonalLogin(record.jobId)).resolves.toBeNull();
      await expect(getDingtalkPersonalLoginForUser('user-a')).resolves.toBeNull();
      expect(redis.store.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
