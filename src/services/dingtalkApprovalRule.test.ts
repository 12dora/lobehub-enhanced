import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { dingtalkApprovalRuleService } from './dingtalkApprovalRule';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    dingtalkApprovalRule: {
      create: { mutate: vi.fn() },
      get: { query: vi.fn() },
      list: { query: vi.fn() },
      listRuns: { query: vi.fn() },
      remove: { mutate: vi.fn() },
      setEnabled: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
    },
  },
}));

const client = (lambdaClient as any).dingtalkApprovalRule;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dingtalkApprovalRuleService', () => {
  it('list defaults to an empty query object', async () => {
    client.list.query.mockResolvedValueOnce([
      { dailyCap: 50, id: 'rule_1', originatorLabels: { staff_1: '张三' } },
    ]);
    const rows = await dingtalkApprovalRuleService.list();
    expect(client.list.query).toHaveBeenCalledWith({});
    expect(rows[0]).toMatchObject({ dailyCap: 50, originatorLabels: { staff_1: '张三' } });
  });

  it('get returns dailyCap and originatorLabels from the lambda row', async () => {
    client.get.query.mockResolvedValueOnce({
      dailyCap: null,
      id: 'rule_1',
      originatorLabels: {},
    });
    await expect(dingtalkApprovalRuleService.get('rule_1')).resolves.toMatchObject({
      dailyCap: null,
      originatorLabels: {},
    });
    expect(client.get.query).toHaveBeenCalledWith({ id: 'rule_1' });
  });

  it('setEnabled forwards id and enabled', async () => {
    client.setEnabled.mutate.mockResolvedValueOnce({ id: 'rule_1', enabled: false });
    await dingtalkApprovalRuleService.setEnabled('rule_1', false);
    expect(client.setEnabled.mutate).toHaveBeenCalledWith({ enabled: false, id: 'rule_1' });
  });

  it('listRuns forwards the optional limit', async () => {
    client.listRuns.query.mockResolvedValueOnce([]);
    await dingtalkApprovalRuleService.listRuns('rule_1', { limit: 8 });
    expect(client.listRuns.query).toHaveBeenCalledWith({ id: 'rule_1', limit: 8 });
  });
});
