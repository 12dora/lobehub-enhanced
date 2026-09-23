// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => {
  const store = new Map<string, string>();
  const sets: Array<{ extra: unknown[]; key: string; value: string }> = [];
  return {
    client: null as null | {
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string, ...extra: unknown[]) => Promise<'OK' | null>;
    },
    fail: false,
    sets,
    store,
  };
});

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisState.client,
}));

const {
  ORG_TODO_READ_DISCOVER_CLAIM_KEY,
  ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS,
  discoverOrgTodoReadGate,
  resetOrgTodoReadGateForTest,
} = await import('./orgReadGate');

describe('discoverOrgTodoReadGate', () => {
  beforeEach(() => {
    resetOrgTodoReadGateForTest();
    redisState.fail = false;
    redisState.store.clear();
    redisState.sets.length = 0;
    redisState.client = {
      get: async (key: string) => redisState.store.get(key) ?? null,
      set: async (key: string, value: string, ...extra: unknown[]) => {
        redisState.sets.push({ extra, key, value });
        if (redisState.fail) throw new Error('redis down');
        if (extra.includes('NX') && redisState.store.has(key)) return null;
        redisState.store.set(key, value);
        return 'OK';
      },
    };
  });

  it('claims discovery with SET NX for 60s and is the only probe', async () => {
    const probe = vi.fn(async () => 'unavailable' as const);
    const result = await discoverOrgTodoReadGate(probe);
    expect(result).toEqual({ fromThisProbe: true, gate: 'unavailable' });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(redisState.sets[0]).toEqual({
      extra: ['EX', ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS, 'NX'],
      key: ORG_TODO_READ_DISCOVER_CLAIM_KEY,
      value: '1',
    });
    expect(ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS).toBe(60);
  });

  it('does not probe when another replica holds the claim', async () => {
    redisState.store.set(ORG_TODO_READ_DISCOVER_CLAIM_KEY, '1');
    const probe = vi.fn(async () => 'available' as const);
    const result = await discoverOrgTodoReadGate(probe);
    expect(result).toEqual({ fromThisProbe: false, gate: undefined });
    expect(probe).not.toHaveBeenCalled();
  });

  it('does not probe when the Redis claim errors', async () => {
    redisState.fail = true;
    const probe = vi.fn(async () => 'available' as const);
    const result = await discoverOrgTodoReadGate(probe);
    expect(result).toEqual({ fromThisProbe: false, gate: undefined });
    expect(probe).not.toHaveBeenCalled();
  });

  it('probes in-process when Redis is not configured', async () => {
    redisState.client = null;
    const probe = vi.fn(async () => 'available' as const);
    const result = await discoverOrgTodoReadGate(probe);
    expect(result).toEqual({ fromThisProbe: true, gate: 'available' });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
