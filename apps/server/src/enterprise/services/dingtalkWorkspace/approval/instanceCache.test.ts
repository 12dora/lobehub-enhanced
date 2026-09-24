// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const redisBag = vi.hoisted(() => ({ current: null as FakeRedis | null }));

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

vi.mock('../client', () => ({
  dingtalkWorkspaceRequest: (...args: unknown[]) => mockRequest(...args),
}));
vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
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
    this.store.set(key, { expiresAt: Number.POSITIVE_INFINITY, value: String(next) });
    return next;
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count += 1;
    return count;
  }
}

const { executeTaskAs, getInstanceDetail, resetApprovalApiPaceForTest } = await import('./api');
const { resetApprovalCacheForTest } = await import('./cache');

const detailBody = (title: string) => ({
  formComponentValues: [],
  originatorUserId: 'staff-1',
  tasks: [],
  title,
});

describe('instance detail redis cache', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    redisBag.current = new FakeRedis();
    resetApprovalCacheForTest();
    resetApprovalApiPaceForTest({ maxRps: Number.POSITIVE_INFINITY });
  });

  it('reuses a cached process instance and refetches after a write', async () => {
    mockRequest.mockResolvedValueOnce(detailBody('请假'));
    const first = await getInstanceDetail('inst-1');
    const second = await getInstanceDetail('inst-1');
    expect(second).toEqual(first);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    mockRequest.mockResolvedValueOnce({ result: true, success: true });
    await executeTaskAs('staff-1', {
      processInstanceId: 'inst-1',
      result: 'agree',
      taskId: '9',
    });
    mockRequest.mockResolvedValueOnce(detailBody('已同意'));
    const third = await getInstanceDetail('inst-1');
    expect(third.title).toBe('已同意');
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  it('refetches when fresh is set and keeps the new detail', async () => {
    mockRequest.mockResolvedValueOnce(detailBody('旧'));
    await getInstanceDetail('inst-1');
    mockRequest.mockResolvedValueOnce(detailBody('新'));
    const fresh = await getInstanceDetail('inst-1', { fresh: true });
    expect(fresh.title).toBe('新');
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const cached = await getInstanceDetail('inst-1');
    expect(cached.title).toBe('新');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('drops the cached detail when execute throws', async () => {
    mockRequest.mockResolvedValueOnce(detailBody('请假'));
    await getInstanceDetail('inst-1');
    mockRequest.mockRejectedValueOnce(new Error('execute failed'));
    await expect(
      executeTaskAs('staff-1', { processInstanceId: 'inst-1', result: 'agree', taskId: '9' }),
    ).rejects.toThrow('execute failed');
    mockRequest.mockResolvedValueOnce(detailBody('重读'));
    const again = await getInstanceDetail('inst-1');
    expect(again.title).toBe('重读');
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  it('calls DingTalk every time when Redis is down', async () => {
    redisBag.current = null;
    mockRequest.mockResolvedValue(detailBody('请假'));
    await getInstanceDetail('inst-1');
    await getInstanceDetail('inst-1');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});
