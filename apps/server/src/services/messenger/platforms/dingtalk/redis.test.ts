import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => mockRedis),
}));

const { getAgentRuntimeRedisClient } = await import('@/server/modules/AgentRuntime/redis');
const { rememberDingTalkCorpId } = await import('./redis');
const { DINGTALK_CORP_ID_KEY } = await import('./const');

describe('rememberDingTalkCorpId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(mockRedis as any);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
  });

  it('writes chatbotCorpId when the stored value differs', async () => {
    mockRedis.get.mockResolvedValueOnce('old_corp');
    await rememberDingTalkCorpId('corp_new');
    expect(mockRedis.get).toHaveBeenCalledWith(DINGTALK_CORP_ID_KEY);
    expect(mockRedis.set).toHaveBeenCalledWith(DINGTALK_CORP_ID_KEY, 'corp_new');
    expect(mockRedis.set.mock.calls[0]).toHaveLength(2);
  });

  it('skips the write when the stored value already matches', async () => {
    mockRedis.get.mockResolvedValueOnce('corp_same');
    await rememberDingTalkCorpId('corp_same');
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('skips empty values', async () => {
    await rememberDingTalkCorpId('   ');
    await rememberDingTalkCorpId(undefined);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('no-ops when Redis is unavailable', async () => {
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(null as any);
    await rememberDingTalkCorpId('corp_1');
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
