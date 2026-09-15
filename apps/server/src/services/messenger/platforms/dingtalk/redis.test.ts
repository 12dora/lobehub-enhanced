import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = {
  del: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => mockRedis),
}));

const { getAgentRuntimeRedisClient } = await import('@/server/modules/AgentRuntime/redis');
const {
  consumeDingTalkLastList,
  rememberDingTalkCorpId,
  setDingTalkLastList,
  writeDingTalkStreamStatus,
} = await import('./redis');
const {
  DINGTALK_CORP_ID_KEY,
  DINGTALK_LAST_LIST_KEY_PREFIX,
  DINGTALK_LAST_LIST_TTL_SECONDS,
  DINGTALK_STREAM_STATUS_TTL_SECONDS,
} = await import('./const');
const { IM_CONNECTOR_STREAM_STATUS_KEY } =
  await import('@/server/enterprise/services/imConnectors/status');

describe('rememberDingTalkCorpId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(mockRedis as any);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
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

describe('DingTalk last-list', () => {
  const threadId = 'dingtalk:cid';
  const key = `${DINGTALK_LAST_LIST_KEY_PREFIX}${threadId}`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(mockRedis as any);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
  });

  it('sets agents/topics/question with a 600s TTL', async () => {
    await setDingTalkLastList(threadId, 'agents');
    expect(mockRedis.set).toHaveBeenCalledWith(key, 'agents', 'EX', DINGTALK_LAST_LIST_TTL_SECONDS);
    expect(DINGTALK_LAST_LIST_TTL_SECONDS).toBe(600);
  });

  it('consumes the stored kind and deletes the key', async () => {
    mockRedis.get.mockResolvedValueOnce('topics');
    await expect(consumeDingTalkLastList(threadId)).resolves.toBe('topics');
    expect(mockRedis.get).toHaveBeenCalledWith(key);
    expect(mockRedis.del).toHaveBeenCalledWith(key);
  });

  it('returns null when no list was stored', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    await expect(consumeDingTalkLastList(threadId)).resolves.toBeNull();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('falls back to memory when Redis is unavailable', async () => {
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(null as any);
    await setDingTalkLastList(threadId, 'question');
    await expect(consumeDingTalkLastList(threadId)).resolves.toBe('question');
    await expect(consumeDingTalkLastList(threadId)).resolves.toBeNull();
  });
});

describe('writeDingTalkStreamStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAgentRuntimeRedisClient).mockReturnValue(mockRedis as any);
    mockRedis.set.mockResolvedValue('OK');
  });

  it('writes lastFrameAt into the Redis JSON payload', async () => {
    const lastFrameAt = '2024-03-29T07:33:20.000Z';
    await writeDingTalkStreamStatus({
      connectedAt: lastFrameAt,
      lastError: null,
      lastErrorAt: null,
      lastEventAt: '2024-03-29T07:33:21.000Z',
      lastFrameAt,
      state: 'connected',
    });

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const [key, raw, flag, ttl] = mockRedis.set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(IM_CONNECTOR_STREAM_STATUS_KEY('dingtalk'));
    expect(flag).toBe('EX');
    expect(ttl).toBe(DINGTALK_STREAM_STATUS_TTL_SECONDS);
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({
        lastEventAt: '2024-03-29T07:33:21.000Z',
        lastFrameAt,
        pid: process.pid,
        state: 'connected',
      }),
    );
  });
});
