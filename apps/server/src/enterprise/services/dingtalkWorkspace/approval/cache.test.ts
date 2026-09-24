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
    if (!row) return undefined;
    if (row.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return row;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, mode?: string, ttl?: number, nx?: string) {
    if (nx === 'NX' && this.live(key)) return null;
    let expiresAt = Number.POSITIVE_INFINITY;
    if (mode === 'EX' && typeof ttl === 'number') expiresAt = Date.now() + ttl * 1000;
    if (mode === 'PX' && typeof ttl === 'number') expiresAt = Date.now() + ttl;
    this.store.set(key, { expiresAt, value });
    return 'OK';
  }

  async incr(key: string) {
    const next = Number(this.live(key)?.value ?? '0') + 1;
    const existing = this.live(key);
    this.store.set(key, {
      expiresAt: existing?.expiresAt ?? Number.POSITIVE_INFINITY,
      value: String(next),
    });
    return next;
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count += 1;
    return count;
  }
}

const {
  acquireApprovalSweepLock,
  approvalMemoryCacheSizeForTest,
  APPROVAL_CACHE_MAX_BYTES,
  APPROVAL_CACHE_MEMORY_LIMIT,
  approvalSweepEpochIsCurrent,
  bumpApprovalSweepEpoch,
  bumpApprovalUserGeneration,
  captureApprovalCacheGeneration,
  captureApprovalInstanceGeneration,
  invalidateApprovalInstanceCache,
  invalidateApprovalUserCache,
  readApprovalInstanceCache,
  readApprovalScopedCache,
  resetApprovalCacheForTest,
  setApprovalSweepLockTimingForTest,
  waitForApprovalScopedCache,
  writeApprovalInstanceCache,
  writeApprovalScopedCache,
} = await import('./cache');

describe('approval redis cache', () => {
  beforeEach(() => {
    resetApprovalCacheForTest();
    redisBag.current = null;
    vi.useRealTimers();
  });

  it('keeps an in-process copy when Redis is down and drops it on invalidate', async () => {
    const generation = await captureApprovalCacheGeneration('user-1');
    await writeApprovalScopedCache({
      generation,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'pending:20',
      ttlMs: 60_000,
      userId: 'user-1',
      value: { rows: [1] },
    });
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'pending:20', Date.now()),
    ).resolves.toEqual({ rows: [1] });
    await expect(
      readApprovalScopedCache('user-2', 'staff-a', 'pending:20', Date.now()),
    ).resolves.toBeUndefined();
    invalidateApprovalUserCache('user-1');
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'pending:20', Date.now()),
    ).resolves.toBeUndefined();
  });

  it('expires the in-process copy and caps how many entries it keeps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    const generation = await captureApprovalCacheGeneration('user-1');
    await writeApprovalScopedCache({
      generation,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'pending:20',
      ttlMs: 1_000,
      userId: 'user-1',
      value: { ok: true },
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'pending:20', Date.now()),
    ).resolves.toBeUndefined();

    vi.useRealTimers();
    resetApprovalCacheForTest();
    const fresh = await captureApprovalCacheGeneration('user-1');
    for (let index = 0; index <= APPROVAL_CACHE_MEMORY_LIMIT; index += 1) {
      await writeApprovalScopedCache({
        generation: fresh,
        now: Date.now(),
        staffId: 'staff-a',
        suffix: `row:${index}`,
        ttlMs: 60_000,
        userId: 'user-1',
        value: index,
      });
    }
    expect(approvalMemoryCacheSizeForTest()).toBe(APPROVAL_CACHE_MEMORY_LIMIT);
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'row:0', Date.now()),
    ).resolves.toBeUndefined();
    const newest = `row:${APPROVAL_CACHE_MEMORY_LIMIT}`;
    await expect(readApprovalScopedCache('user-1', 'staff-a', newest, Date.now())).resolves.toBe(
      APPROVAL_CACHE_MEMORY_LIMIT,
    );
  });

  it('stores JSON in Redis, misses after invalidate, and skips an oversized payload', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const generation = await captureApprovalCacheGeneration('user-1');
    await writeApprovalScopedCache({
      generation,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'templates',
      ttlMs: 5 * 60_000,
      userId: 'user-1',
      value: [{ name: '请假', processCode: 'A' }],
    });
    expect([...redis.store.keys()].some((key) => key.startsWith('dingtalk-approval:cache:'))).toBe(
      true,
    );
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'templates', Date.now()),
    ).resolves.toEqual([{ name: '请假', processCode: 'A' }]);
    invalidateApprovalUserCache('user-1');
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'templates', Date.now()),
    ).resolves.toBeUndefined();

    const next = await captureApprovalCacheGeneration('user-1');
    await writeApprovalScopedCache({
      generation: next,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'huge',
      ttlMs: 60_000,
      userId: 'user-1',
      value: { blob: 'x'.repeat(APPROVAL_CACHE_MAX_BYTES) },
    });
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'huge', Date.now()),
    ).resolves.toBeUndefined();
  });

  it('falls back to the in-process copy when a Redis read throws', async () => {
    const generation = await captureApprovalCacheGeneration('user-1');
    await writeApprovalScopedCache({
      generation,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'pending:20',
      ttlMs: 60_000,
      userId: 'user-1',
      value: { from: 'memory' },
    });
    redisBag.current = {
      del: async () => {
        throw new Error('down');
      },
      get: async () => {
        throw new Error('down');
      },
      incr: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
    } as unknown as FakeRedis;
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'pending:20', Date.now()),
    ).resolves.toEqual({ from: 'memory' });
  });

  it('caches an instance detail for the Redis TTL and drops that id on invalidate', async () => {
    redisBag.current = new FakeRedis();
    await writeApprovalInstanceCache('inst-1', { title: '请假' });
    await expect(readApprovalInstanceCache('inst-1')).resolves.toEqual({ title: '请假' });
    invalidateApprovalInstanceCache('inst-1');
    await expect(readApprovalInstanceCache('inst-1')).resolves.toBeUndefined();
    invalidateApprovalInstanceCache('');
    await expect(readApprovalInstanceCache('')).resolves.toBeUndefined();
  });

  it('does not keep instance details when Redis is down', async () => {
    await writeApprovalInstanceCache('inst-1', { title: '请假' });
    await expect(readApprovalInstanceCache('inst-1')).resolves.toBeUndefined();
  });

  it('drops a detail write when the instance generation changed during the fetch', async () => {
    redisBag.current = new FakeRedis();
    const generation = await captureApprovalInstanceGeneration('inst-1');
    invalidateApprovalInstanceCache('inst-1');
    await writeApprovalInstanceCache('inst-1', { title: '过期' }, generation);
    await expect(readApprovalInstanceCache('inst-1')).resolves.toBeUndefined();

    await writeApprovalInstanceCache('inst-1', { title: '最新' });
    await expect(readApprovalInstanceCache('inst-1')).resolves.toEqual({ title: '最新' });
  });

  it('single-flights the sweep lock and lets a waiter reread the published value', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const first = await acquireApprovalSweepLock('user-1', 'staff-a', 'refresh');
    expect(first.kind).toBe('acquired');
    const second = await acquireApprovalSweepLock('user-1', 'staff-a', 'scan');
    expect(second).toEqual({ kind: 'busy', mode: 'refresh' });
    if (first.kind === 'acquired') await first.release();
    const third = await acquireApprovalSweepLock('user-1', 'staff-a', 'scan');
    expect(third.kind).toBe('acquired');
    if (third.kind === 'acquired') await third.release();

    setApprovalSweepLockTimingForTest({
      pollMs: 1,
      sleep: async () => {
        const generation = await captureApprovalCacheGeneration('user-1');
        await writeApprovalScopedCache({
          generation,
          now: Date.now(),
          staffId: 'staff-a',
          suffix: 'sweep',
          ttlMs: 60_000,
          userId: 'user-1',
          value: { details: [] },
        });
      },
      waitMs: 500,
    });
    await expect(waitForApprovalScopedCache('user-1', 'staff-a', 'sweep')).resolves.toEqual({
      details: [],
    });

    const epoch = await bumpApprovalSweepEpoch('user-1', 'staff-a');
    expect(epoch).toBe('1');
    await expect(approvalSweepEpochIsCurrent('user-1', 'staff-a', '1')).resolves.toBe(true);
    await bumpApprovalSweepEpoch('user-1', 'staff-a');
    await expect(approvalSweepEpochIsCurrent('user-1', 'staff-a', '1')).resolves.toBe(false);

    redisBag.current = null;
    await expect(acquireApprovalSweepLock('user-1', 'staff-a', 'scan')).resolves.toEqual({
      kind: 'down',
    });
  });

  it('waits out a held sweep lock instead of returning the pre-refresh cache', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const generation = await captureApprovalCacheGeneration('user-1');
    await writeApprovalScopedCache({
      generation,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'sweep',
      ttlMs: 60_000,
      userId: 'user-1',
      value: { details: ['stale'] },
    });
    const lock = await acquireApprovalSweepLock('user-1', 'staff-a', 'refresh');
    expect(lock.kind).toBe('acquired');
    let sleeps = 0;
    setApprovalSweepLockTimingForTest({
      pollMs: 1,
      sleep: async () => {
        sleeps += 1;
        if (sleeps < 2) return;
        if (lock.kind === 'acquired') await lock.release();
        const current = await captureApprovalCacheGeneration('user-1');
        await writeApprovalScopedCache({
          generation: current,
          now: Date.now(),
          staffId: 'staff-a',
          suffix: 'sweep',
          ttlMs: 60_000,
          userId: 'user-1',
          value: { details: ['fresh'] },
        });
      },
      waitMs: 1_000,
    });
    await expect(waitForApprovalScopedCache('user-1', 'staff-a', 'sweep')).resolves.toEqual({
      details: ['fresh'],
    });
    expect(sleeps).toBeGreaterThanOrEqual(2);
  });

  it('drops a pending write captured before a refresh generation bump', async () => {
    redisBag.current = new FakeRedis();
    const stale = await captureApprovalCacheGeneration('user-1');
    await bumpApprovalUserGeneration('user-1');
    const fresh = await captureApprovalCacheGeneration('user-1');
    expect(fresh).not.toBe(stale);
    await writeApprovalScopedCache({
      generation: fresh,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'pending:20',
      ttlMs: 60_000,
      userId: 'user-1',
      value: { rows: ['new'] },
    });
    await writeApprovalScopedCache({
      generation: stale,
      now: Date.now(),
      staffId: 'staff-a',
      suffix: 'pending:20',
      ttlMs: 60_000,
      userId: 'user-1',
      value: { rows: ['old'] },
    });
    await expect(
      readApprovalScopedCache('user-1', 'staff-a', 'pending:20', Date.now()),
    ).resolves.toEqual({ rows: ['new'] });
  });
});
