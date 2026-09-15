import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = {
  del: vi.fn(),
  eval: vi.fn(),
  exists: vi.fn(),
  expire: vi.fn(),
  llen: vi.fn(),
  lpop: vi.fn(),
  lpush: vi.fn(),
  rpush: vi.fn(),
  scan: vi.fn(),
  set: vi.fn(),
  ttl: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => mockRedis),
}));

const { getAgentRuntimeRedisClient } = await import('@/server/modules/AgentRuntime/redis');
const {
  acquireDingTalkDrainLock,
  dropStaleDingTalkQueues,
  isDingTalkBusyOwnedByThisProcess,
  isDingTalkThreadBusy,
  peekDingTalkQueueLength,
  popDingTalkQueuedMessage,
  pushDingTalkQueuedMessage,
  releaseDingTalkThreadBusy,
  resetDingTalkQueueMemoryForTests,
  tryAcquireDingTalkThreadBusy,
  unshiftDingTalkQueuedMessage,
} = await import('./queue');

beforeEach(() => {
  vi.clearAllMocks();
  resetDingTalkQueueMemoryForTests();
  vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(mockRedis as any);
  mockRedis.llen.mockResolvedValue(0);
  mockRedis.lpush.mockResolvedValue(1);
  mockRedis.rpush.mockResolvedValue(1);
  mockRedis.expire.mockResolvedValue(1);
  mockRedis.lpop.mockResolvedValue(null);
  mockRedis.lpush.mockResolvedValue(1);
  mockRedis.scan.mockResolvedValue(['0', []]);
  mockRedis.ttl.mockResolvedValue(60);
  mockRedis.del.mockResolvedValue(1);
  mockRedis.eval.mockResolvedValue(1);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.exists.mockResolvedValue(0);
});

describe('DingTalk inbound queue', () => {
  it('pushes a message via atomic RPUSH + LTRIM + EXPIRE', async () => {
    const result = await pushDingTalkQueuedMessage('dingtalk:cid', {
      senderStaffId: 'staff_1',
      text: 'hello',
    });
    expect(result).toBe('queued');
    expect(mockRedis.eval).toHaveBeenCalledOnce();
    const script = String(mockRedis.eval.mock.calls[0][0]);
    expect(script).toContain('RPUSH');
    expect(script).toContain('LTRIM');
    expect(script).toContain('EXPIRE');
  });

  it('rejects a sixth message as full', async () => {
    mockRedis.eval.mockResolvedValueOnce(0);
    const result = await pushDingTalkQueuedMessage('dingtalk:cid', {
      senderStaffId: 'staff_1',
      text: 'overflow',
    });
    expect(result).toBe('full');
  });

  it('pops the oldest message in order', async () => {
    mockRedis.lpop.mockResolvedValueOnce(
      JSON.stringify({ queuedAt: 1, senderStaffId: 'staff_1', text: 'first' }),
    );
    mockRedis.llen.mockResolvedValueOnce(0);
    const item = await popDingTalkQueuedMessage('dingtalk:cid');
    expect(item).toEqual({
      item: { queuedAt: 1, senderStaffId: 'staff_1', text: 'first' },
      status: 'item',
    });
    expect(mockRedis.lpop).toHaveBeenCalledWith('messenger:dingtalk:queue:dingtalk:cid');
  });

  it('reports empty when LPOP returns nothing', async () => {
    mockRedis.lpop.mockResolvedValueOnce(null);
    await expect(popDingTalkQueuedMessage('dingtalk:cid')).resolves.toEqual({ status: 'empty' });
  });

  it('reports error when LPOP throws so drain can keep the lock', async () => {
    mockRedis.lpop.mockRejectedValueOnce(new Error('redis blip'));
    await expect(popDingTalkQueuedMessage('dingtalk:cid')).resolves.toEqual({ status: 'error' });
  });

  it('skips a malformed payload instead of treating it as empty', async () => {
    mockRedis.lpop.mockResolvedValueOnce('not-json');
    mockRedis.llen.mockResolvedValueOnce(0);
    await expect(popDingTalkQueuedMessage('dingtalk:cid')).resolves.toEqual({ status: 'invalid' });
  });

  it('returns the item when LPOP succeeds even if LLEN/EXPIRE throws', async () => {
    mockRedis.lpop.mockResolvedValueOnce(
      JSON.stringify({ queuedAt: 1, senderStaffId: 'staff_1', text: 'kept' }),
    );
    mockRedis.llen.mockRejectedValueOnce(new Error('llen blip'));
    await expect(popDingTalkQueuedMessage('dingtalk:cid')).resolves.toEqual({
      item: { queuedAt: 1, senderStaffId: 'staff_1', text: 'kept' },
      status: 'item',
    });
  });

  it('returns null from peek when LLEN throws', async () => {
    mockRedis.llen.mockRejectedValueOnce(new Error('llen blip'));
    await expect(peekDingTalkQueueLength('dingtalk:cid')).resolves.toBeNull();
  });

  it('drops queue keys that have no TTL on restart', async () => {
    mockRedis.scan.mockResolvedValueOnce(['0', ['messenger:dingtalk:queue:stale']]);
    mockRedis.ttl.mockResolvedValueOnce(-1);
    const dropped = await dropStaleDingTalkQueues();
    expect(dropped).toBe(1);
    expect(mockRedis.del).toHaveBeenCalledWith('messenger:dingtalk:queue:stale');
  });
});

describe('DingTalk per-thread busy flag', () => {
  it('acquires with SET NX and TTL', async () => {
    const result = await tryAcquireDingTalkThreadBusy('dingtalk:cid');
    expect(result).toBe('acquired');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'messenger:dingtalk:busy:dingtalk:cid',
      '1',
      'EX',
      3600,
      'NX',
    );
  });

  it('returns busy when SET NX does not win', async () => {
    mockRedis.set.mockResolvedValueOnce(null);
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:cid')).resolves.toBe('busy');
  });

  it('releases the flag in DEL', async () => {
    await releaseDingTalkThreadBusy('dingtalk:cid');
    expect(mockRedis.del).toHaveBeenCalledWith('messenger:dingtalk:busy:dingtalk:cid');
    await expect(isDingTalkThreadBusy('dingtalk:cid')).resolves.toBe(false);
  });

  it('returns unavailable when Redis SET throws', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:cid')).resolves.toBe('unavailable');
    expect(isDingTalkBusyOwnedByThisProcess('dingtalk:cid')).toBe(false);
  });

  it('returns busy without SET when this process already owns the flag', async () => {
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:cid')).resolves.toBe('acquired');
    mockRedis.set.mockClear();
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:cid')).resolves.toBe('busy');
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('lets drain re-enter the lock this process already holds', async () => {
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:cid')).resolves.toBe('acquired');
    await expect(acquireDingTalkDrainLock('dingtalk:cid')).resolves.toBe('acquired');
  });

  it('LPUSH-es a popped item back onto the overflow list with LTRIM', async () => {
    mockRedis.eval.mockResolvedValueOnce(1);
    await expect(
      unshiftDingTalkQueuedMessage('dingtalk:cid', {
        queuedAt: 1,
        senderStaffId: 'staff_1',
        text: 'again',
      }),
    ).resolves.toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledOnce();
    const script = String(mockRedis.eval.mock.calls[0][0]);
    expect(script).toContain('LPUSH');
    expect(script).toContain('LTRIM');
    expect(script).toContain('EXPIRE');
    expect(mockRedis.eval.mock.calls[0][4]).toBe('5');
  });

  it('returns false when Redis unshift throws', async () => {
    mockRedis.eval.mockRejectedValueOnce(new Error('eval down'));
    await expect(
      unshiftDingTalkQueuedMessage('dingtalk:cid', {
        queuedAt: 1,
        senderStaffId: 'staff_1',
        text: 'again',
      }),
    ).resolves.toBe(false);
  });
});

describe('DingTalk in-memory queue fallback', () => {
  beforeEach(() => {
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(null);
    resetDingTalkQueueMemoryForTests();
  });

  it('serializes acquire / overflow / pop without Redis', async () => {
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:mem')).resolves.toBe('acquired');
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:mem')).resolves.toBe('busy');
    await expect(
      pushDingTalkQueuedMessage('dingtalk:mem', { senderStaffId: 's', text: 'follow' }),
    ).resolves.toBe('queued');
    await expect(popDingTalkQueuedMessage('dingtalk:mem')).resolves.toMatchObject({
      item: { text: 'follow' },
      status: 'item',
    });
    await releaseDingTalkThreadBusy('dingtalk:mem');
    await expect(tryAcquireDingTalkThreadBusy('dingtalk:mem')).resolves.toBe('acquired');
  });

  it('expires the memory busy flag on the same TTL as Redis', async () => {
    vi.useFakeTimers();
    try {
      await expect(tryAcquireDingTalkThreadBusy('dingtalk:ttl')).resolves.toBe('acquired');
      await expect(isDingTalkThreadBusy('dingtalk:ttl')).resolves.toBe(true);
      vi.advanceTimersByTime(3600_000 + 1);
      await expect(isDingTalkThreadBusy('dingtalk:ttl')).resolves.toBe(false);
      await expect(tryAcquireDingTalkThreadBusy('dingtalk:ttl')).resolves.toBe('acquired');
    } finally {
      vi.useRealTimers();
    }
  });
});
