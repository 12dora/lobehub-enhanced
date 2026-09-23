import { afterEach, describe, expect, it } from 'vitest';

import {
  readRuntimeErrorSummary,
  recordRuntimeError,
  recordRuntimeSuccess,
  resetRuntimeErrorsForTest,
  RUNTIME_ERROR_EVENT_LIMIT,
  RUNTIME_ERROR_EVENT_TTL_SECONDS,
  RUNTIME_ERROR_HASH_TTL_SECONDS,
  type RuntimeErrorStore,
  scrubRuntimeErrorMessage,
  setRuntimeErrorStoreForTest,
} from './runtimeErrors';

class MemoryRedis implements RuntimeErrorStore {
  expires: { key: string; seconds: number }[] = [];
  hashes = new Map<string, Map<string, string>>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();

  private hash(key: string): Map<string, string> {
    let map = this.hashes.get(key);
    if (!map) {
      map = new Map();
      this.hashes.set(key, map);
    }
    return map;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expires.push({ key, seconds });
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    const map = this.hashes.get(key);
    for (const field of fields) map?.delete(field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const map = this.hash(key);
    const next = Number(map.get(field) ?? 0) + increment;
    map.set(field, String(next));
    return next;
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    this.hash(key).set(field, value);
  }

  async lpush(key: string, value: string): Promise<void> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return (this.lists.get(key) ?? []).slice(start, stop + 1);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    this.lists.set(key, (this.lists.get(key) ?? []).slice(start, stop + 1));
  }

  async sadd(key: string, member: string): Promise<void> {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
}

describe('scrubRuntimeErrorMessage', () => {
  it('drops URL query strings, tokens, and clips to 300 characters', () => {
    const raw = `failed https://api.example.com/v1/files?access_token=super-secret&x=1 password=hunter2 Bearer abc.def.ghi sk-abcdefghijklmnopqrstuvwxyz ${'x'.repeat(400)}`;
    const scrubbed = scrubRuntimeErrorMessage(raw);
    expect(scrubbed).not.toContain('super-secret');
    expect(scrubbed).not.toContain('hunter2');
    expect(scrubbed).not.toContain('abc.def.ghi');
    expect(scrubbed).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(scrubbed).toContain('https://api.example.com/v1/files');
    expect(scrubbed).not.toContain('?');
    expect(scrubbed.length).toBeLessThanOrEqual(300);
  });

  it('redacts quoted and unquoted headers, auth schemes, JSON fields, and query params', () => {
    const secret = 'dXNlcjpwYXNz';
    const forms = [
      `{"Authorization":"Basic ${secret}"}`,
      `{"Authorization": "Bearer ${secret}"}`,
      `{'Authorization':'Basic ${secret}'}`,
      `Authorization: Basic ${secret}`,
      `Authorization: Bearer ${secret}`,
      `Proxy-Authorization: Token ${secret}`,
      `Cookie: session=${secret}`,
      `Set-Cookie: id=${secret}; HttpOnly`,
      `x-acs-dingtalk-access-token: ${secret}`,
      `x-api-key: ${secret}`,
      `api-key=${secret}`,
      `{"token":"${secret}","secret":"${secret}","password":"${secret}","apiKey":"${secret}","accessToken":"${secret}","refreshToken":"${secret}","clientSecret":"${secret}"}`,
      `Digest ${secret}`,
      `Negotiate ${secret}`,
    ];
    for (const form of forms) {
      const scrubbed = scrubRuntimeErrorMessage(form);
      expect(scrubbed, form).not.toContain(secret);
    }
    const query = scrubRuntimeErrorMessage(
      'path?access_token=AAA&token=BBB&signature=CCC&sign=DDD&key=EEE',
    );
    expect(query).not.toContain('AAA');
    expect(query).not.toContain('BBB');
    expect(query).not.toContain('CCC');
    expect(query).not.toContain('DDD');
    expect(query).not.toContain('EEE');
    expect(query).toContain('signature=[redacted]');
    expect(query).toContain('sign=[redacted]');
    expect(query).toContain('key=[redacted]');
  });

  it('redacts api-key spellings and does not treat a longer word as a secret name', () => {
    expect(scrubRuntimeErrorMessage('api_key=sekret')).toBe('api_key=[redacted]');
    expect(scrubRuntimeErrorMessage('apikey=sekret')).toBe('apikey=[redacted]');
    expect(scrubRuntimeErrorMessage('api-key=sekret')).toBe('api-key=[redacted]');
    expect(scrubRuntimeErrorMessage('{"apiKey":"sekret"}')).not.toContain('sekret');
    expect(scrubRuntimeErrorMessage('cookie=sekret')).toBe('cookie=[redacted]');
    expect(scrubRuntimeErrorMessage('cookies=sekret')).toBe('cookies=sekret');
    expect(scrubRuntimeErrorMessage('token=sekret')).toBe('token=[redacted]');
    expect(scrubRuntimeErrorMessage('tokenExtra=sekret')).toBe('tokenExtra=sekret');
  });
});

describe('recordRuntimeError', () => {
  let redis: MemoryRedis;

  afterEach(() => {
    resetRuntimeErrorsForTest();
  });

  it('rolls a 24h count, keeps the last error, and caps history at 50', async () => {
    redis = new MemoryRedis();
    setRuntimeErrorStoreForTest(redis);
    const start = Date.parse('2026-08-01T00:10:00.000Z');

    await recordRuntimeError('sandbox', new Error('first'), { at: start });
    await recordRuntimeError('sandbox', 'second boom', { at: start + 60_000 });
    await recordRuntimeError('memory', 'embed down', { at: start + 120_000 });

    const summary = await readRuntimeErrorSummary(start + 180_000);
    expect(summary.subsystems.find((item) => item.subsystem === 'sandbox')).toMatchObject({
      count24h: 2,
      errors10m: 2,
      lastError: 'second boom',
    });
    expect(summary.events).toHaveLength(3);
    expect(summary.events[0]?.subsystem).toBe('memory');

    for (let index = 0; index < 60; index += 1) {
      await recordRuntimeError('market', `event ${index}`, { at: start + index });
    }
    const capped = await readRuntimeErrorSummary(start + 120_000);
    expect(capped.events).toHaveLength(RUNTIME_ERROR_EVENT_LIMIT);
    expect(redis.expires.some((item) => item.seconds === RUNTIME_ERROR_HASH_TTL_SECONDS)).toBe(
      true,
    );
    expect(redis.expires.some((item) => item.seconds === RUNTIME_ERROR_EVENT_TTL_SECONDS)).toBe(
      true,
    );
  });

  it('drops hour buckets outside the rolling 24h window', async () => {
    redis = new MemoryRedis();
    setRuntimeErrorStoreForTest(redis);
    const start = Date.parse('2026-08-01T00:10:00.000Z');
    await recordRuntimeError('sandbox', 'old', { at: start });
    const later = start + 25 * 60 * 60 * 1000;
    const summary = await readRuntimeErrorSummary(later);
    expect(summary.subsystems.find((item) => item.subsystem === 'sandbox')?.count24h).toBe(0);
  });

  it('counts a 10 minute spike separately from the 24h total', async () => {
    redis = new MemoryRedis();
    setRuntimeErrorStoreForTest(redis);
    const start = Date.parse('2026-08-01T03:00:00.000Z');
    await recordRuntimeError('dingtalk_api', 'old', { at: start });
    await recordRuntimeError('dingtalk_api', 'a', { at: start + 11 * 60_000 });
    await recordRuntimeError('dingtalk_api', 'b', { at: start + 12 * 60_000 });
    await recordRuntimeError('dingtalk_api', 'c', { at: start + 13 * 60_000 });
    const summary = await readRuntimeErrorSummary(start + 13 * 60_000);
    expect(summary.subsystems[0]).toMatchObject({ count24h: 4, errors10m: 3 });
  });

  it('stores provider, model, and DingTalk fields with the error', async () => {
    redis = new MemoryRedis();
    setRuntimeErrorStoreForTest(redis);
    const at = Date.parse('2026-08-02T00:00:00.000Z');

    await recordRuntimeError('system_agent', new Error('400 stream'), {
      at,
      model: 'gpt-5.4-mini',
      operation: 'generateTopicTitle',
      provider: 'chatgpt',
    });
    await recordRuntimeError('dingtalk_api', new Error('DINGTALK_FORBIDDEN'), {
      at: at + 1,
      missingScopes: ['Calendar.Event.Write'],
      upstreamCode: 'Forbidden.AccessDenied',
    });
    await recordRuntimeError('system_agent', new Error('leak'), {
      at: at + 2,
      model: 'sk-abcdefghijklmnopqrst',
    });

    const summary = await readRuntimeErrorSummary(at + 10);
    expect(summary.subsystems.find((item) => item.subsystem === 'system_agent')?.lastError).toBe(
      '[model=sk-[redacted]] Error: leak',
    );
    expect(summary.events.map((event) => event.message)).toEqual([
      '[model=sk-[redacted]] Error: leak',
      '[upstreamCode=Forbidden.AccessDenied missingScopes=Calendar.Event.Write] Error: DINGTALK_FORBIDDEN',
      '[provider=chatgpt model=gpt-5.4-mini operation=generateTopicTitle] Error: 400 stream',
    ]);
  });

  it('persists structured secrets only after they are scrubbed', async () => {
    redis = new MemoryRedis();
    setRuntimeErrorStoreForTest(redis);
    const secret = 'dXNlcjpwYXNz';
    const at = Date.parse('2026-08-03T00:00:00.000Z');
    await recordRuntimeError('sandbox', `boom {"Authorization":"Basic ${secret}"}`, { at });
    const summary = await readRuntimeErrorSummary(at);
    const stored = summary.subsystems[0]?.lastError ?? '';
    expect(stored).not.toContain(secret);
    expect(summary.events[0]?.message).not.toContain(secret);
    expect(JSON.stringify([...redis.hashes.values()])).not.toContain(secret);
  });

  it('is a no-op when Redis is disabled and swallows store failures', async () => {
    setRuntimeErrorStoreForTest(null);
    await expect(recordRuntimeError('sandbox', 'nope')).resolves.toBeUndefined();
    await expect(readRuntimeErrorSummary()).resolves.toEqual({ events: [], subsystems: [] });

    const broken: RuntimeErrorStore = {
      expire: async () => {
        throw new Error('redis down');
      },
      hdel: async () => undefined,
      hgetall: async () => {
        throw new Error('redis down');
      },
      hincrby: async () => {
        throw new Error('redis down');
      },
      hset: async () => {
        throw new Error('redis down');
      },
      lpush: async () => {
        throw new Error('redis down');
      },
      lrange: async () => {
        throw new Error('redis down');
      },
      ltrim: async () => undefined,
      sadd: async () => undefined,
      smembers: async () => {
        throw new Error('redis down');
      },
    };
    setRuntimeErrorStoreForTest(broken);
    await expect(recordRuntimeError('sandbox', 'still fine')).resolves.toBeUndefined();
    await expect(recordRuntimeSuccess('sandbox')).resolves.toBeUndefined();
    await expect(readRuntimeErrorSummary()).resolves.toEqual({ events: [], subsystems: [] });
  });
});
