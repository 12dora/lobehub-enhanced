import { lambdaClient } from '@/libs/trpc/client';
import type {
  AdminDingtalkApprovalRulesDisableInput,
  AdminDingtalkApprovalRulesDisableOutput,
  AdminDingtalkApprovalRulesListInput,
  AdminDingtalkApprovalRulesListOutput,
} from '@/server/enterprise/contracts/adminDingtalkApprovalRules';

/**
 * Typed client boundary for `admin.dingtalkApprovalRules.*`.
 * `list` needs SYSTEM_READ; `disable` needs SYSTEM_OPERATE.
 */
class AdminDingtalkApprovalRulesService {
  list = async (
    input?: AdminDingtalkApprovalRulesListInput,
  ): Promise<AdminDingtalkApprovalRulesListOutput> =>
    lambdaClient.admin.dingtalkApprovalRules.list.query(input ?? {});

  disable = async (
    input: AdminDingtalkApprovalRulesDisableInput,
  ): Promise<AdminDingtalkApprovalRulesDisableOutput> =>
    lambdaClient.admin.dingtalkApprovalRules.disable.mutate(input);
}

export const adminDingtalkApprovalRulesService = new AdminDingtalkApprovalRulesService();
