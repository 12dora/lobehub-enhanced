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
  DINGTALK_PERSONAL_CACHE_GEN_TTL_SEC,
  DINGTALK_PERSONAL_GROUP_CACHE_TTL_SEC,
  DINGTALK_PERSONAL_TEMPLATE_CACHE_TTL_SEC,
  dingtalkPersonalReadCacheTtlSec,
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

  it('keeps group reads for 10 minutes and report templates for 60', async () => {
    expect(dingtalkPersonalReadCacheTtlSec('chat.searchGroups')).toBe(
      DINGTALK_PERSONAL_GROUP_CACHE_TTL_SEC,
    );
    expect(dingtalkPersonalReadCacheTtlSec('chat.myGroups')).toBe(10 * 60);
    expect(dingtalkPersonalReadCacheTtlSec('report.templates')).toBe(
      DINGTALK_PERSONAL_TEMPLATE_CACHE_TTL_SEC,
    );
    expect(dingtalkPersonalReadCacheTtlSec('report.template')).toBe(60 * 60);
    expect(dingtalkPersonalReadCacheTtlSec('todo.list')).toBe(60);
    expect(dingtalkPersonalReadCacheTtlSec('chat.searchMessages')).toBe(60);

    const redis = new FakeRedis();
    redisBag.current = redis;
    const started = Date.now();
    await writeDingtalkPersonalCache(
      'user-a',
      'chat.searchGroups',
      { query: '福' },
      { groups: [] },
    );
    await writeDingtalkPersonalCache('user-a', 'report.templates', {}, { templates: [] });
    await writeDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }, { n: 1 });
    const ttlOf = (op: string) => {
      const key = [...redis.store.keys()].find((item) => item.includes(`:${op}:`));
      const row = key ? redis.store.get(key) : undefined;
      return row ? row.expiresAt - started : 0;
    };
    expect(ttlOf('chat.searchGroups')).toBeGreaterThan(590_000);
    expect(ttlOf('chat.searchGroups')).toBeLessThan(610_000);
    expect(ttlOf('report.templates')).toBeGreaterThan(3_590_000);
    expect(ttlOf('report.templates')).toBeLessThan(3_610_000);
    expect(ttlOf('todo.list')).toBeGreaterThan(50_000);
    expect(ttlOf('todo.list')).toBeLessThan(70_000);

    redisBag.current = null;
    resetDingtalkPersonalCacheForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      await writeDingtalkPersonalCache(
        'user-a',
        'chat.searchGroups',
        { query: '福' },
        { groups: [] },
      );
      await writeDingtalkPersonalCache('user-a', 'chat.myGroups', {}, { groups: [1] });
      await writeDingtalkPersonalCache('user-a', 'report.template', { name: '日报' }, { id: 't' });
      await writeDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }, { n: 1 });

      vi.setSystemTime(new Date('2026-09-24T00:01:30.000Z'));
      await expect(
        readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }),
      ).resolves.toBeUndefined();
      await expect(
        readDingtalkPersonalCache('user-a', 'chat.searchGroups', { query: '福' }),
      ).resolves.toEqual({ groups: [] });
      await expect(readDingtalkPersonalCache('user-a', 'chat.myGroups', {})).resolves.toEqual({
        groups: [1],
      });

      vi.setSystemTime(new Date('2026-09-24T00:09:00.000Z'));
      await expect(
        readDingtalkPersonalCache('user-a', 'chat.searchGroups', { query: '福' }),
      ).resolves.toEqual({ groups: [] });
      await expect(
        readDingtalkPersonalCache('user-a', 'report.template', { name: '日报' }),
      ).resolves.toEqual({ id: 't' });

      vi.setSystemTime(new Date('2026-09-24T00:10:01.000Z'));
      await expect(
        readDingtalkPersonalCache('user-a', 'chat.searchGroups', { query: '福' }),
      ).resolves.toBeUndefined();
      await expect(
        readDingtalkPersonalCache('user-a', 'chat.myGroups', {}),
      ).resolves.toBeUndefined();
      await expect(
        readDingtalkPersonalCache('user-a', 'report.template', { name: '日报' }),
      ).resolves.toEqual({ id: 't' });

      for (const minute of [19, 28, 37, 46, 55]) {
        vi.setSystemTime(new Date(`2026-09-24T00:${minute}:00.000Z`));
        await expect(
          readDingtalkPersonalCache('user-a', 'report.template', { name: '日报' }),
        ).resolves.toEqual({ id: 't' });
      }
      vi.setSystemTime(new Date('2026-09-24T01:00:01.000Z'));
      await expect(
        readDingtalkPersonalCache('user-a', 'report.template', { name: '日报' }),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the shared op table for docs and sheets reads', async () => {
    expect(dingtalkPersonalReadCacheTtlSec('doc.search')).toBe(60);
    expect(dingtalkPersonalReadCacheTtlSec('drive.search')).toBe(60);
    expect(dingtalkPersonalReadCacheTtlSec('aitable.bases')).toBe(60);
    expect(dingtalkPersonalReadCacheTtlSec('wiki.nodes')).toBe(60);
    expect(dingtalkPersonalReadCacheTtlSec('doc.read')).toBe(5 * 60);
    expect(dingtalkPersonalReadCacheTtlSec('wiki.spaces')).toBe(10 * 60);
    expect(dingtalkPersonalReadCacheTtlSec('aitable.schema')).toBe(10 * 60);
    expect(dingtalkPersonalReadCacheTtlSec('sheet.list')).toBe(10 * 60);
    expect(dingtalkPersonalReadCacheTtlSec('sheet.info')).toBe(10 * 60);
    expect(dingtalkPersonalReadCacheTtlSec('chat.searchGroups')).toBe(
      DINGTALK_PERSONAL_GROUP_CACHE_TTL_SEC,
    );

    const redis = new FakeRedis();
    redisBag.current = redis;
    const started = Date.now();
    await writeDingtalkPersonalCache('user-a', 'doc.read', { nodeId: 'n' }, { markdown: 'a' });
    await writeDingtalkPersonalCache('user-a', 'sheet.list', { nodeId: 'n' }, { sheets: [] });
    const ttlOf = (op: string) => {
      const key = [...redis.store.keys()].find((item) => item.includes(`:${op}:`));
      const row = key ? redis.store.get(key) : undefined;
      return row ? row.expiresAt - started : 0;
    };
    expect(ttlOf('doc.read')).toBeGreaterThan(290_000);
    expect(ttlOf('doc.read')).toBeLessThan(310_000);
    expect(ttlOf('sheet.list')).toBeGreaterThan(590_000);
    expect(ttlOf('sheet.list')).toBeLessThan(610_000);

    redisBag.current = null;
    resetDingtalkPersonalCacheForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      await writeDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }, { n: 1 });
      await writeDingtalkPersonalCache('user-a', 'doc.read', { nodeId: 'n' }, { markdown: 'a' });
      await writeDingtalkPersonalCache('user-a', 'sheet.info', { nodeId: 'n' }, { title: '库存' });

      vi.setSystemTime(new Date('2026-09-24T00:01:30.000Z'));
      await expect(
        readDingtalkPersonalCache('user-a', 'todo.list', { page: 1 }),
      ).resolves.toBeUndefined();
      await expect(
        readDingtalkPersonalCache('user-a', 'doc.read', { nodeId: 'n' }),
      ).resolves.toEqual({
        markdown: 'a',
      });

      vi.setSystemTime(new Date('2026-09-24T00:05:01.000Z'));
      await expect(
        readDingtalkPersonalCache('user-a', 'doc.read', { nodeId: 'n' }),
      ).resolves.toBeUndefined();
      await expect(
        readDingtalkPersonalCache('user-a', 'sheet.info', { nodeId: 'n' }),
      ).resolves.toEqual({ title: '库存' });

      vi.setSystemTime(new Date('2026-09-24T00:10:01.000Z'));
      await expect(
        readDingtalkPersonalCache('user-a', 'sheet.info', { nodeId: 'n' }),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the generation key at least twice as long as the longest entry', async () => {
    const longest = Math.max(
      ...[
        'todo.list',
        'doc.read',
        'doc.search',
        'drive.search',
        'sheet.list',
        'sheet.info',
        'wiki.spaces',
        'aitable.bases',
        'aitable.schema',
        'chat.myGroups',
        'chat.searchGroups',
        'report.template',
        'report.templates',
      ].map((op) => dingtalkPersonalReadCacheTtlSec(op)),
    );
    expect(longest).toBe(DINGTALK_PERSONAL_TEMPLATE_CACHE_TTL_SEC);
    expect(DINGTALK_PERSONAL_CACHE_GEN_TTL_SEC).toBe(longest * 2);

    const redis = new FakeRedis();
    redisBag.current = redis;
    const started = Date.now();
    await invalidateDingtalkPersonalCache('user-a');
    const row = redis.store.get('dingtalk-personal:cache-gen:user-a');
    expect(row).toBeTruthy();
    const ttlMs = (row?.expiresAt ?? 0) - started;
    expect(Math.abs(ttlMs - DINGTALK_PERSONAL_CACHE_GEN_TTL_SEC * 1000)).toBeLessThan(1000);
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
