import type {
  ApprovalRuleAction,
  ApprovalRuleConditions,
  ApprovalRuleDisabledReason,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Row returned by `dingtalkApprovalRule.list` / `get`. `dailyCap` comes from the
 * current automation tier; `originatorLabels` maps staffId/deptId to directory names.
 */
export interface DingtalkApprovalRuleClientRow {
  action: ApprovalRuleAction;
  conditions: ApprovalRuleConditions;
  createdAt: Date | string;
  createdByTopicId?: string | null;
  dailyCap: number | null;
  dailyCount: number;
  dailyCountDate: Date | string | null;
  disabledReason: ApprovalRuleDisabledReason | null;
  enabled: boolean;
  expiresAt: Date | string | null;
  id: string;
  lastRunAt: Date | string | null;
  name: string;
  originatorLabels: Record<string, string>;
  processCode: string;
  processName: string;
  redirectToName: string | null;
  redirectToStaffId: string | null;
  remark: string | null;
  staffId: string;
  updatedAt: Date | string;
  userId: string;
}

/**
 * Client access to the user-scoped DingTalk approval-rule lambda router.
 */
class DingtalkApprovalRuleService {
  list = async (params?: {
    includeDisabled?: boolean;
  }): Promise<DingtalkApprovalRuleClientRow[]> => {
    return lambdaClient.dingtalkApprovalRule.list.query(params ?? {}) as Promise<
      DingtalkApprovalRuleClientRow[]
    >;
  };

  get = async (id: string): Promise<DingtalkApprovalRuleClientRow> => {
    return lambdaClient.dingtalkApprovalRule.get.query({
      id,
    }) as Promise<DingtalkApprovalRuleClientRow>;
  };

  listRuns = async (id: string, params?: { limit?: number }) => {
    return lambdaClient.dingtalkApprovalRule.listRuns.query({ id, limit: params?.limit });
  };

  create = async (
    params: Parameters<typeof lambdaClient.dingtalkApprovalRule.create.mutate>[0],
  ) => {
    return lambdaClient.dingtalkApprovalRule.create.mutate(params);
  };

  update = async (
    params: Parameters<typeof lambdaClient.dingtalkApprovalRule.update.mutate>[0],
  ) => {
    return lambdaClient.dingtalkApprovalRule.update.mutate(params);
  };

  setEnabled = async (id: string, enabled: boolean) => {
    return lambdaClient.dingtalkApprovalRule.setEnabled.mutate({ enabled, id });
  };

  remove = async (id: string) => {
    return lambdaClient.dingtalkApprovalRule.remove.mutate({ id });
  };
}

export const dingtalkApprovalRuleService = new DingtalkApprovalRuleService();
