import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { adminDingtalkApprovalRulesService } from './adminDingtalkApprovalRules';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    admin: {
      dingtalkApprovalRules: {
        disable: { mutate: vi.fn() },
        list: { query: vi.fn() },
      },
    },
  },
}));

const client = (lambdaClient as any).admin.dingtalkApprovalRules;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('adminDingtalkApprovalRulesService', () => {
  it('list defaults to an empty query object', async () => {
    client.list.query.mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, total: 0 });
    await adminDingtalkApprovalRulesService.list();
    expect(client.list.query).toHaveBeenCalledWith({});
  });

  it('disable forwards ruleId', async () => {
    client.disable.mutate.mockResolvedValueOnce({ id: 'rule_1', enabled: false });
    await adminDingtalkApprovalRulesService.disable({ ruleId: 'rule_1' });
    expect(client.disable.mutate).toHaveBeenCalledWith({ ruleId: 'rule_1' });
  });

  it('disable forwards the caller-supplied reason code', async () => {
    client.disable.mutate.mockResolvedValueOnce({ id: 'rule_1', enabled: false });
    await adminDingtalkApprovalRulesService.disable({
      reason: 'admin.dingtalk.approval_rule.disable',
      ruleId: 'rule_1',
    });
    expect(client.disable.mutate).toHaveBeenCalledWith({
      reason: 'admin.dingtalk.approval_rule.disable',
      ruleId: 'rule_1',
    });
  });
});
