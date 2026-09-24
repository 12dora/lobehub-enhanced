// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisBag = vi.hoisted(() => ({
  current: null as { expire: ReturnType<typeof vi.fn>; incr: ReturnType<typeof vi.fn> } | null,
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisBag.current,
}));

const { assertDingtalkPersonalRateLimit, DINGTALK_PERSONAL_RATE_LIMIT } =
  await import('./rateLimit');
const { DingtalkPersonalError } = await import('./errors');

describe('dingtalk personal rate limit', () => {
  beforeEach(() => {
    redisBag.current = null;
  });

  it('fails open when redis is missing or throws', async () => {
    await expect(assertDingtalkPersonalRateLimit('user-a')).resolves.toBeUndefined();
    redisBag.current = {
      expire: vi.fn(),
      incr: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    await expect(assertDingtalkPersonalRateLimit('user-a')).resolves.toBeUndefined();
  });

  it('allows 60 calls in the window and rejects the 61st', async () => {
    let used = 0;
    redisBag.current = {
      expire: vi.fn(async () => 1),
      incr: vi.fn(async () => {
        used += 1;
        return used;
      }),
    };
    for (let i = 0; i < DINGTALK_PERSONAL_RATE_LIMIT; i += 1) {
      await assertDingtalkPersonalRateLimit('user-a', 1_700_000_000_000);
    }
    await expect(
      assertDingtalkPersonalRateLimit('user-a', 1_700_000_000_000),
    ).rejects.toBeInstanceOf(DingtalkPersonalError);
    await expect(
      assertDingtalkPersonalRateLimit('user-a', 1_700_000_000_000),
    ).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_RATE_LIMITED',
    });
    expect(redisBag.current.expire).toHaveBeenCalledTimes(1);
  });
});
