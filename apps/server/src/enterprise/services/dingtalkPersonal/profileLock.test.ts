// @vitest-environment node
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisBag = vi.hoisted(() => ({
  current: null as FakeRedis | null,
  throwOnGet: false,
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => {
    if (redisBag.throwOnGet) throw new Error('redis init failed');
    return redisBag.current;
  },
}));

class FakeRedis {
  brokenAfter: number | null = null;
  delCalls: string[] = [];
  evalCalls: unknown[][] = [];
  failEval = false;
  failSets = 0;
  setCalls: unknown[][] = [];
  readonly store = new Map<string, { expiresAt: number; value: string }>();
  throwAlways = false;

  private attempts = 0;

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

  async set(key: string, value: string, mode?: string, ttl?: number, nx?: string) {
    this.setCalls.push([key, value, mode, ttl, nx]);
    if (this.throwAlways) throw new Error('ECONNREFUSED');
    this.attempts += 1;
    if (this.brokenAfter !== null) {
      if (this.attempts > this.brokenAfter) throw new Error('blip');
      return null;
    }
    if (this.failSets > 0) {
      this.failSets -= 1;
      return null;
    }
    if ((nx === 'NX' || mode === 'NX') && this.live(key)) return null;
    const expiresAt =
      mode === 'PX' && typeof ttl === 'number'
        ? Date.now() + ttl
        : mode === 'EX' && typeof ttl === 'number'
          ? Date.now() + ttl * 1000
          : Number.POSITIVE_INFINITY;
    this.store.set(key, { expiresAt, value });
    return 'OK' as const;
  }

  async eval(script: string, numKeys: number, key: string, token: string) {
    this.evalCalls.push([script, numKeys, key, token]);
    if (this.failEval) throw new Error('eval unsupported');
    if (numKeys !== 1 || (await this.get(key)) !== token) return 0;
    await this.del(key);
    return 1;
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) {
      this.delCalls.push(key);
      if (this.store.delete(key)) count += 1;
    }
    return count;
  }
}

const {
  DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS,
  DINGTALK_PERSONAL_PROFILE_LOCK_TTL_MS,
  DINGTALK_PERSONAL_PROFILE_LOCK_WAIT_MS,
  dingtalkPersonalProfileLockDepthForTest,
  dingtalkPersonalProfileLockKey,
  resetDingtalkPersonalProfileLockForTest,
  setDingtalkPersonalProfileLockTimingForTest,
  withDingtalkPersonalProfileLock,
} = await import('./profileLock');
const { DingtalkPersonalError } = await import('./errors');

const PROFILE_A = 'dingcorp:alpha';
const PROFILE_B = 'dingcorp:beta';

const hashedKey = (profile: string) => {
  const digest = createHash('sha256').update(profile).digest('hex').slice(0, 24);
  return `dingtalk-personal:profile-lock:${digest}`;
};

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe('dingtalk personal profile lock', () => {
  beforeEach(() => {
    resetDingtalkPersonalProfileLockForTest();
    redisBag.current = null;
    redisBag.throwOnGet = false;
  });

  it('hashes the profile and keeps the raw value out of the redis key', () => {
    const key = dingtalkPersonalProfileLockKey(PROFILE_A);
    expect(key).toBe(hashedKey(PROFILE_A));
    expect(key).toHaveLength('dingtalk-personal:profile-lock:'.length + 24);
    expect(key.includes(PROFILE_A)).toBe(false);
    expect(key.includes('alpha')).toBe(false);
    expect(dingtalkPersonalProfileLockKey(PROFILE_B)).not.toBe(key);
  });

  it('serializes two operations on the same profile', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const order: string[] = [];
    const held = gate();
    const first = withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      order.push('first');
      await held.promise;
      order.push('first-end');
    });
    await vi.waitFor(() => {
      expect(order).toEqual(['first']);
    });
    const second = withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      order.push('second');
    });
    await vi.waitFor(() => {
      expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(2);
    });
    expect(order).toEqual(['first']);
    const key = hashedKey(PROFILE_A);
    expect(redis.setCalls[0]).toEqual([
      key,
      expect.any(String),
      'PX',
      DINGTALK_PERSONAL_PROFILE_LOCK_TTL_MS,
      'NX',
    ]);
    expect(String(redis.setCalls[0]?.[1])).not.toContain('alpha');
    held.release();
    await first;
    await second;
    expect(order).toEqual(['first', 'first-end', 'second']);
    expect(redis.setCalls.map((call) => call[0])).toEqual([key, key]);
    expect(redis.evalCalls[0]?.[2]).toBe(key);
    expect(redis.evalCalls[0]?.[3]).toBe(redis.setCalls[0]?.[1]);
    expect(String(redis.evalCalls[0]?.[0])).toContain("redis.call('del'");
    expect(redis.store.has(key)).toBe(false);
    expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(0);
  });

  it('does not block different profiles', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const held = gate();
    let started = 0;
    const enter = async () => {
      started += 1;
      await held.promise;
    };
    const first = withDingtalkPersonalProfileLock(PROFILE_A, enter);
    const second = withDingtalkPersonalProfileLock(PROFILE_B, enter);
    await vi.waitFor(() => {
      expect(started).toBe(2);
    });
    expect(redis.setCalls.map((call) => call[0])).toEqual([
      hashedKey(PROFILE_A),
      hashedKey(PROFILE_B),
    ]);
    held.release();
    await Promise.all([first, second]);
  });

  it('releases the redis lock when the critical section throws', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    setDingtalkPersonalProfileLockTimingForTest({ retryMs: 10, waitMs: 80 });
    const order: string[] = [];
    const first = withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      order.push('first');
      throw new Error('boom');
    });
    const second = withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      order.push('second');
    });
    await expect(first).rejects.toThrow('boom');
    await second;
    expect(order).toEqual(['first', 'second']);
    expect(redis.store.has(hashedKey(PROFILE_A))).toBe(false);
    expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(0);
  });

  it('does not delete a lock whose token changed', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const key = hashedKey(PROFILE_A);
    await withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      const row = redis.store.get(key);
      expect(row?.value).toBe(redis.setCalls[0]?.[1]);
      if (row) row.value = 'other-owner';
    });
    expect(redis.store.get(key)?.value).toBe('other-owner');
    expect(redis.delCalls).toEqual([]);
  });

  it('falls back to GET+DEL when EVAL fails and still checks the token', async () => {
    const redis = new FakeRedis();
    redis.failEval = true;
    redisBag.current = redis;
    const key = hashedKey(PROFILE_A);
    await withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      expect(redis.store.get(key)?.value).toBeTruthy();
    });
    expect(redis.store.has(key)).toBe(false);
    expect(redis.delCalls).toEqual([key]);

    redis.delCalls = [];
    redis.store.clear();
    redis.setCalls = [];
    await withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      const row = redis.store.get(key);
      if (row) row.value = 'other-owner';
    });
    expect(redis.store.get(key)?.value).toBe('other-owner');
    expect(redis.delCalls).toEqual([]);
  });

  it('serializes with the in-process mutex when redis is down', async () => {
    const order: string[] = [];
    const held = gate();
    const run = async (name: string) => {
      order.push(name);
      await held.promise;
      order.push(`${name}-end`);
    };
    const first = withDingtalkPersonalProfileLock(PROFILE_A, () => run('first'));
    await vi.waitFor(() => {
      expect(order).toEqual(['first']);
    });
    const second = withDingtalkPersonalProfileLock(PROFILE_A, () => run('second'));
    await vi.waitFor(() => {
      expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(2);
    });
    expect(order).toEqual(['first']);
    held.release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'first-end', 'second', 'second-end']);

    await expect(
      withDingtalkPersonalProfileLock(PROFILE_A, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    let ran = false;
    await withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(0);
  });

  it('uses the in-process mutex when the redis client throws', async () => {
    redisBag.throwOnGet = true;
    const held = gate();
    let started = 0;
    const enter = async () => {
      started += 1;
      await held.promise;
    };
    const first = withDingtalkPersonalProfileLock(PROFILE_A, enter);
    const second = withDingtalkPersonalProfileLock(PROFILE_A, enter);
    await vi.waitFor(() => {
      expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(2);
      expect(started).toBe(1);
    });
    held.release();
    await Promise.all([first, second]);
    expect(started).toBe(2);
  });

  it('falls back to the in-process mutex when the first redis command fails', async () => {
    const redis = new FakeRedis();
    redis.throwAlways = true;
    redisBag.current = redis;
    setDingtalkPersonalProfileLockTimingForTest({ retryMs: 20, waitMs: 100 });
    const held = gate();
    let started = 0;
    const enter = async () => {
      started += 1;
      await held.promise;
    };
    const first = withDingtalkPersonalProfileLock(PROFILE_A, enter);
    const second = withDingtalkPersonalProfileLock(PROFILE_A, enter);
    await vi.waitFor(() => {
      expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(2);
      expect(started).toBe(1);
    });
    expect(redis.setCalls).toHaveLength(1);
    held.release();
    await Promise.all([first, second]);
    expect(started).toBe(2);
    expect(redis.setCalls).toHaveLength(2);
    expect(redis.store.size).toBe(0);
  });

  it('retries a busy redis lock and then times out', async () => {
    let now = 0;
    const sleeps: number[] = [];
    setDingtalkPersonalProfileLockTimingForTest({
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    const redis = new FakeRedis();
    redis.failSets = 2;
    redisBag.current = redis;
    await expect(withDingtalkPersonalProfileLock(PROFILE_A, async () => 'in')).resolves.toBe('in');
    expect(now).toBe(DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS * 2);
    expect(sleeps).toEqual([
      DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS,
      DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS,
    ]);

    now = 0;
    sleeps.length = 0;
    redis.store.set(hashedKey(PROFILE_A), {
      expiresAt: Number.POSITIVE_INFINITY,
      value: 'foreign',
    });
    let ran = false;
    const error = await withDingtalkPersonalProfileLock(PROFILE_A, async () => {
      ran = true;
      return 'nope';
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DingtalkPersonalError);
    expect(error).toMatchObject({ code: 'DINGTALK_PERSONAL_TIMEOUT' });
    expect(ran).toBe(false);
    expect(now).toBe(DINGTALK_PERSONAL_PROFILE_LOCK_WAIT_MS);
    expect(sleeps[0]).toBe(DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS);
    expect(sleeps).toHaveLength(
      DINGTALK_PERSONAL_PROFILE_LOCK_WAIT_MS / DINGTALK_PERSONAL_PROFILE_LOCK_RETRY_MS,
    );
    expect(redis.store.get(hashedKey(PROFILE_A))?.value).toBe('foreign');
    expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(0);

    redis.store.clear();
    setDingtalkPersonalProfileLockTimingForTest(null);
    await expect(withDingtalkPersonalProfileLock(PROFILE_A, async () => 'after')).resolves.toBe(
      'after',
    );
  });

  it('times out instead of entering when redis errors after seeing the lock held', async () => {
    let now = 0;
    setDingtalkPersonalProfileLockTimingForTest({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    const redis = new FakeRedis();
    redis.brokenAfter = 1;
    redisBag.current = redis;
    let ran = false;
    await expect(
      withDingtalkPersonalProfileLock(PROFILE_A, async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_TIMEOUT' });
    expect(ran).toBe(false);
    expect(redis.setCalls.length).toBeGreaterThan(1);
    expect(dingtalkPersonalProfileLockDepthForTest(PROFILE_A)).toBe(0);
  });
});
