import { describe, expect, it } from 'vitest';

import { adminDingtalkApprovalRuleItemSchema } from './adminDingtalkApprovalRules';

describe('adminDingtalkApprovalRuleItemSchema', () => {
  it('requires conditions and originatorLabels on every admin row', () => {
    const parsed = adminDingtalkApprovalRuleItemSchema.parse({
      action: 'agree',
      conditions: {
        match: 'all',
        originators: { deptIds: ['d1'], staffIds: ['s1'] },
      },
      createdAt: '2026-03-01T00:00:00.000Z',
      dailyCount: 2,
      dailyCountDate: '2026-03-01',
      disabledReason: null,
      enabled: true,
      expiresAt: null,
      id: 'rule_1',
      lastRunAt: null,
      name: '自动同意',
      originatorLabels: { d1: '研发部', s1: '张三' },
      processCode: 'PROC_1',
      processName: '差旅',
      redirectToName: null,
      staffId: 'staff_me',
      updatedAt: '2026-03-01T00:00:00.000Z',
      userDisplayName: '王工',
      userEmail: 'wang@example.com',
      userId: 'user_1',
    });
    expect(parsed.originatorLabels.s1).toBe('张三');
    expect(parsed.conditions.originators?.staffIds).toEqual(['s1']);
  });
});
