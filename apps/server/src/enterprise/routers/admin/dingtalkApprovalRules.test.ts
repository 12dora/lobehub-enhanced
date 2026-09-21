// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { toAdminDingtalkApprovalRuleItem } from './dingtalkApprovalRules';

describe('toAdminDingtalkApprovalRuleItem', () => {
  it('includes conditions and originatorLabels', () => {
    const item = toAdminDingtalkApprovalRuleItem(
      {
        action: 'agree',
        conditions: { match: 'all', originators: { staffIds: ['s1'] } },
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        createdByTopicId: null,
        dailyCount: 1,
        dailyCountDate: '2026-03-01',
        disabledReason: null,
        enabled: true,
        expiresAt: null,
        id: 'rule_1',
        lastRunAt: null,
        name: '自动同意',
        processCode: 'PROC_1',
        processName: '差旅',
        redirectToName: null,
        redirectToStaffId: null,
        remark: null,
        staffId: 'staff_me',
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        userDisplayName: '王工',
        userEmail: 'wang@example.com',
        userId: 'user_1',
      },
      { s1: '张三' },
    );

    expect(item.conditions).toEqual({ match: 'all', originators: { staffIds: ['s1'] } });
    expect(item.originatorLabels).toEqual({ s1: '张三' });
  });
});
