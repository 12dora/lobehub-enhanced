import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = {
  del: vi.fn(),
  expire: vi.fn(),
  llen: vi.fn(),
  lpop: vi.fn(),
  rpush: vi.fn(),
  scan: vi.fn(),
  ttl: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => mockRedis),
}));

const { popDingTalkQueuedMessage, pushDingTalkQueuedMessage, dropStaleDingTalkQueues } =
  await import('./queue');

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.llen.mockResolvedValue(0);
  mockRedis.rpush.mockResolvedValue(1);
  mockRedis.expire.mockResolvedValue(1);
  mockRedis.lpop.mockResolvedValue(null);
  mockRedis.scan.mockResolvedValue(['0', []]);
  mockRedis.ttl.mockResolvedValue(60);
  mockRedis.del.mockResolvedValue(1);
});

describe('DingTalk inbound queue', () => {
  it('pushes a message and refreshes TTL', async () => {
    const result = await pushDingTalkQueuedMessage('dingtalk:cid', {
      senderStaffId: 'staff_1',
      text: 'hello',
    });
    expect(result).toBe('queued');
    expect(mockRedis.rpush).toHaveBeenCalledOnce();
    expect(mockRedis.expire).toHaveBeenCalledWith('messenger:dingtalk:queue:dingtalk:cid', 3600);
  });

  it('rejects a sixth message as full', async () => {
    mockRedis.llen.mockResolvedValueOnce(5);
    const result = await pushDingTalkQueuedMessage('dingtalk:cid', {
      senderStaffId: 'staff_1',
      text: 'overflow',
    });
    expect(result).toBe('full');
    expect(mockRedis.rpush).not.toHaveBeenCalled();
  });

  it('pops the oldest message in order', async () => {
    mockRedis.lpop.mockResolvedValueOnce(
      JSON.stringify({ queuedAt: 1, senderStaffId: 'staff_1', text: 'first' }),
    );
    mockRedis.llen.mockResolvedValueOnce(0);
    const item = await popDingTalkQueuedMessage('dingtalk:cid');
    expect(item?.text).toBe('first');
    expect(mockRedis.lpop).toHaveBeenCalledWith('messenger:dingtalk:queue:dingtalk:cid');
  });

  it('drops queue keys that have no TTL on restart', async () => {
    mockRedis.scan.mockResolvedValueOnce(['0', ['messenger:dingtalk:queue:stale']]);
    mockRedis.ttl.mockResolvedValueOnce(-1);
    const dropped = await dropStaleDingTalkQueues();
    expect(dropped).toBe(1);
    expect(mockRedis.del).toHaveBeenCalledWith('messenger:dingtalk:queue:stale');
  });
});
