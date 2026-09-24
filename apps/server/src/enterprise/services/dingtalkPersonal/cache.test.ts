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

  async set(key: string, value: string, ex?: string, ttl?: number, nx?: string) {
    if (nx === 'NX' && this.live(key)) return null;
    this.store.set(key, {
      expiresAt:
        ex === 'EX' && typeof ttl === 'number' ? Date.now() + ttl * 1000 : Number.POSITIVE_INFINITY,
      value,
    });
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

  async expire(key: string, ttl: number) {
    const row = this.live(key);
    if (!row) return 0;
    row.expiresAt = Date.now() + ttl * 1000;
    return 1;
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count += 1;
    return count;
  }
}

const {
  captureDingtalkPersonalCacheGeneration,
  DINGTALK_PERSONAL_MEMORY_CACHE_LIMIT,
  DINGTALK_PERSONAL_MEMORY_GEN_LIMIT,
  DINGTALK_PERSONAL_MEMORY_GEN_TTL_MS,
  dingtalkPersonalMemoryCacheSizeForTest,
  dingtalkPersonalMemoryGenHasForTest,
  dingtalkPersonalMemoryGenSizeForTest,
  hashDingtalkPersonalArgs,
  invalidateDingtalkPersonalCache,
  readDingtalkPersonalCache,
  resetDingtalkPersonalCacheForTest,
  writeDingtalkPersonalCache,
} = await import('./cache');

describe('dingtalk personal read cache', () => {
  beforeEach(() => {
    resetDingtalkPersonalCacheForTest();
    redisBag.current = null;
  });

  it('hashes args independently of key order and invalidates a user on write', async () => {
    expect(hashDingtalkPersonalArgs({ a: 1, b: { d: 2, c: 1 } })).toBe(
      hashDingtalkPersonalArgs({ b: { c: 1, d: 2 }, a: 1 }),
    );
    await writeDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }, { n: 1 });
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }),
    ).resolves.toEqual({
      n: 1,
    });
    await expect(
      readDingtalkPersonalCache('user-b', 'todo.list', { status: 'open' }),
    ).resolves.toBeUndefined();
    await invalidateDingtalkPersonalCache('user-a');
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }),
    ).resolves.toBeUndefined();
  });

  it('uses redis when it is up and treats a redis read error as a miss', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    await writeDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }, { n: 2 });
    await expect(readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 })).resolves.toEqual({
      n: 2,
    });
    expect([...redis.store.keys()].some((key) => key.startsWith('dingtalk-personal:cache:'))).toBe(
      true,
    );

    redisBag.current = {
      ...redis,
      get: async () => {
        throw new Error('redis down');
      },
    } as unknown as FakeRedis;
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }),
    ).resolves.toBeUndefined();
  });

  it('stores a read only when the generation captured before the read is unchanged', async () => {
    const redis = new FakeRedis();
    redisBag.current = redis;
    const generation = await captureDingtalkPersonalCacheGeneration('user-a');
    await invalidateDingtalkPersonalCache('user-a');
    await writeDingtalkPersonalCache(
      'user-a',
      'todo.list',
      { page: 1 },
      { stale: true },
      generation,
    );
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }),
    ).resolves.toBeUndefined();

    const again = await captureDingtalkPersonalCacheGeneration('user-a');
    await writeDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }, { n: 2 }, again);
    await expect(readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 })).resolves.toEqual({
      n: 2,
    });

    redisBag.current = null;
    resetDingtalkPersonalCacheForTest();
    const memoryGeneration = await captureDingtalkPersonalCacheGeneration('user-a');
    await invalidateDingtalkPersonalCache('user-a');
    await writeDingtalkPersonalCache(
      'user-a',
      'todo.list',
      { page: 1 },
      { stale: true },
      memoryGeneration,
    );
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }),
    ).resolves.toBeUndefined();
  });

  it('sweeps expired memory entries and evicts the oldest past the cap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      await writeDingtalkPersonalCache('user-a', 'todo.list', { page: 0 }, { n: 0 });
      vi.setSystemTime(new Date('2026-09-24T00:02:00.000Z'));
      await writeDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }, { n: 1 });
      expect(dingtalkPersonalMemoryCacheSizeForTest()).toBe(1);
      await expect(
        readDingtalkPersonalCache('user-a', 'todo.list', { page: 0 }),
      ).resolves.toBeUndefined();
      await expect(readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 })).resolves.toEqual({
        n: 1,
      });

      resetDingtalkPersonalCacheForTest();
      for (let page = 0; page < DINGTALK_PERSONAL_MEMORY_CACHE_LIMIT + 1; page += 1) {
        await writeDingtalkPersonalCache('user-a', 'todo.list', { page }, { n: page });
      }
      expect(dingtalkPersonalMemoryCacheSizeForTest()).toBe(DINGTALK_PERSONAL_MEMORY_CACHE_LIMIT);
      await expect(
        readDingtalkPersonalCache('user-a', 'todo.list', { page: 0 }),
      ).resolves.toBeUndefined();
      await expect(
        readDingtalkPersonalCache('user-a', 'todo.list', {
          page: DINGTALK_PERSONAL_MEMORY_CACHE_LIMIT,
        }),
      ).resolves.toEqual({ n: DINGTALK_PERSONAL_MEMORY_CACHE_LIMIT });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops untouched memory generations after 10 minutes and caps the map at 1000 users', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      await writeDingtalkPersonalCache('user-0', 'todo.list', { page: 1 }, { n: 0 });
      for (let index = 1; index < DINGTALK_PERSONAL_MEMORY_GEN_LIMIT; index += 1) {
        await invalidateDingtalkPersonalCache(`user-${index}`);
      }
      expect(dingtalkPersonalMemoryGenSizeForTest()).toBe(DINGTALK_PERSONAL_MEMORY_GEN_LIMIT);
      await invalidateDingtalkPersonalCache('user-extra');
      expect(dingtalkPersonalMemoryGenSizeForTest()).toBe(DINGTALK_PERSONAL_MEMORY_GEN_LIMIT);
      expect(dingtalkPersonalMemoryGenHasForTest('user-0')).toBe(false);
      expect(dingtalkPersonalMemoryGenHasForTest('user-1')).toBe(true);
      expect(dingtalkPersonalMemoryGenHasForTest('user-extra')).toBe(true);
      await expect(
        readDingtalkPersonalCache('user-0', 'todo.list', { page: 1 }),
      ).resolves.toBeUndefined();

      resetDingtalkPersonalCacheForTest();
      vi.setSystemTime(new Date('2026-09-24T01:00:00.000Z'));
      await invalidateDingtalkPersonalCache('user-old');
      vi.setSystemTime(new Date(Date.now() + DINGTALK_PERSONAL_MEMORY_GEN_TTL_MS));
      await invalidateDingtalkPersonalCache('user-kept');
      expect(dingtalkPersonalMemoryGenHasForTest('user-old')).toBe(true);
      expect(dingtalkPersonalMemoryGenHasForTest('user-kept')).toBe(true);

      vi.setSystemTime(new Date(Date.now() + 1));
      await invalidateDingtalkPersonalCache('user-fresh');
      expect(dingtalkPersonalMemoryGenHasForTest('user-old')).toBe(false);
      expect(dingtalkPersonalMemoryGenHasForTest('user-kept')).toBe(true);
      expect(dingtalkPersonalMemoryGenHasForTest('user-fresh')).toBe(true);
      expect(dingtalkPersonalMemoryGenSizeForTest()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
