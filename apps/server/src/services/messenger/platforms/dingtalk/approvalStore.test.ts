import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

const mockRedis = {
  del: vi.fn(async (key: string) => {
    store.delete(key);
    return 1;
  }),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, ...rest: string[]) => {
    const nx = rest.includes('NX');
    if (nx && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  }),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => mockRedis,
}));

const {
  claimDingTalkApprovalNotice,
  claimDingTalkPendingApproval,
  finalizeDingTalkPendingApproval,
  saveDingTalkPendingApproval,
  sealDingTalkPendingApproval,
} = await import('./approvalStore');

const dataKey = 'messenger:dingtalk:pending-approval:confirm-1';
const threadKey = 'messenger:dingtalk:pending-approval-thread:dingtalk:cid:staff_1';

const record = {
  agentId: 'agt_1',
  askerStaffId: 'staff_1',
  botContext: {
    applicationId: 'messenger-dingtalk',
    isOwner: true,
    platform: 'dingtalk' as const,
    platformThreadId: 'dingtalk:cid:staff_1',
    senderExternalUserId: 'staff_1',
  },
  cardContent: '模板名称：结案',
  cardTitle: '创建模板「结案」',
  conversationId: 'cid',
  conversationType: '2',
  expiresAt: Date.now() + 60_000,
  operationId: 'op_1',
  outTrackId: 'confirm-1',
  parentMessageId: 'msg_tool',
  robotCode: 'robot',
  siblings: [],
  status: 'pending' as const,
  threadId: 'dingtalk:cid:staff_1',
  toolCallId: 'call_1',
  topicId: 'topic_1',
  userId: 'user_1',
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('claimDingTalkPendingApproval', () => {
  it('claims once into resuming and treats a second click as stale', async () => {
    await saveDingTalkPendingApproval(record);
    const first = await claimDingTalkPendingApproval('confirm-1', 'approved', record.expiresAt - 1);
    const second = await claimDingTalkPendingApproval(
      'confirm-1',
      'approved',
      record.expiresAt - 1,
    );
    expect(first.outcome).toBe('claimed');
    if (first.outcome === 'claimed') {
      expect(first.record.status).toBe('resuming');
      expect(first.record.decision).toBe('approved');
      expect(first.record.resumingAt).toBeTypeOf('number');
    }
    expect(second.outcome).toBe('stale');
    expect(store.has(threadKey)).toBe(true);
    expect(JSON.parse(store.get(dataKey) ?? '{}').status).toBe('resuming');
  });

  it('turns a click after expiry into a resuming record whose decision is expired', async () => {
    await saveDingTalkPendingApproval(record);
    const claimed = await claimDingTalkPendingApproval(
      'confirm-1',
      'approved',
      record.expiresAt + 1,
    );
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome === 'claimed') {
      expect(claimed.record.status).toBe('resuming');
      expect(claimed.record.decision).toBe('expired');
    }
    expect(store.has(threadKey)).toBe(true);
  });

  it('seals a failed send as expired and drops the thread index', async () => {
    await saveDingTalkPendingApproval(record);
    const sealed = await sealDingTalkPendingApproval('confirm-1', 'expired', record.expiresAt + 1);
    expect(sealed.outcome).toBe('claimed');
    if (sealed.outcome === 'claimed') expect(sealed.record.status).toBe('expired');
    expect(store.has(threadKey)).toBe(false);
    expect(JSON.parse(store.get(dataKey) ?? '{}').status).toBe('expired');
  });

  it('finalizes a resuming record and drops the thread index', async () => {
    await saveDingTalkPendingApproval(record);
    const claimed = await claimDingTalkPendingApproval(
      'confirm-1',
      'approved',
      record.expiresAt - 1,
    );
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;
    await finalizeDingTalkPendingApproval(claimed.record);
    expect(JSON.parse(store.get(dataKey) ?? '{}').status).toBe('approved');
    expect(store.has(threadKey)).toBe(false);
  });
});

describe('claimDingTalkApprovalNotice', () => {
  it('allows one notice per card and clicker', async () => {
    expect(await claimDingTalkApprovalNotice('not-asker', 'confirm-1', 'staff_2')).toBe(true);
    expect(await claimDingTalkApprovalNotice('not-asker', 'confirm-1', 'staff_2')).toBe(false);
    expect(await claimDingTalkApprovalNotice('not-asker', 'confirm-1', 'staff_3')).toBe(true);
    expect(await claimDingTalkApprovalNotice('web-only', 'confirm-1', 'staff_2')).toBe(true);
  });
});
