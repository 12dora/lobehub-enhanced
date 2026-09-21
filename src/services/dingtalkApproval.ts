import type {
  AddApproverParams,
  ApproveTaskParams,
  CommentApprovalParams,
  CreateApprovalRuleParams,
  DeleteApprovalRuleParams,
  DeleteTemplateParams,
  DingtalkApprovalPreviewParams,
  GetApprovalDetailParams,
  GetTemplateSchemaParams,
  ListApprovalRulesParams,
  ListMyApplicationsParams,
  ListPendingApprovalsParams,
  ListTemplatesParams,
  RefuseTaskParams,
  ReturnTaskParams,
  SaveTemplateParams,
  SearchDirectoryParams,
  SubmitApprovalParams,
  TransferTaskParams,
  UpdateApprovalRuleParams,
  WithdrawApplicationParams,
} from '@lobechat/builtin-tool-dingtalk-approval';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Client access to the 钉钉审批 lambda router.
 * Mirrors `src/services/reminder.ts`: thin wrappers over `lambdaClient`.
 */
class DingtalkApprovalClientService {
  listTemplates = async (params?: ListTemplatesParams) => {
    return lambdaClient.dingtalkApproval.listTemplates.query(params ?? {});
  };

  getTemplateSchema = async (params: GetTemplateSchemaParams) => {
    return lambdaClient.dingtalkApproval.getTemplateSchema.query(params);
  };

  listPendingApprovals = async (params?: ListPendingApprovalsParams) => {
    return lambdaClient.dingtalkApproval.listPendingApprovals.query(params ?? {});
  };

  listMyApplications = async (params?: ListMyApplicationsParams) => {
    return lambdaClient.dingtalkApproval.listMyApplications.query(params ?? {});
  };

  getApprovalDetail = async (params: GetApprovalDetailParams) => {
    return lambdaClient.dingtalkApproval.getApprovalDetail.query(params);
  };

  searchDirectory = async (params: SearchDirectoryParams) => {
    return lambdaClient.dingtalkApproval.searchDirectory.query(params);
  };

  listApprovalRules = async (params?: ListApprovalRulesParams) => {
    return lambdaClient.dingtalkApproval.listApprovalRules.query(params ?? {});
  };

  submitApproval = async (params: SubmitApprovalParams) => {
    return lambdaClient.dingtalkApproval.submitApproval.mutate(params);
  };

  approveTask = async (params: ApproveTaskParams) => {
    return lambdaClient.dingtalkApproval.approveTask.mutate(params);
  };

  refuseTask = async (params: RefuseTaskParams) => {
    return lambdaClient.dingtalkApproval.refuseTask.mutate(params);
  };

  transferTask = async (params: TransferTaskParams) => {
    return lambdaClient.dingtalkApproval.transferTask.mutate(params);
  };

  commentApproval = async (params: CommentApprovalParams) => {
    return lambdaClient.dingtalkApproval.commentApproval.mutate(params);
  };

  withdrawApplication = async (params: WithdrawApplicationParams) => {
    return lambdaClient.dingtalkApproval.withdrawApplication.mutate(params);
  };

  returnTask = async (params: ReturnTaskParams) => {
    return lambdaClient.dingtalkApproval.returnTask.mutate(params);
  };

  addApprover = async (params: AddApproverParams) => {
    return lambdaClient.dingtalkApproval.addApprover.mutate(params);
  };

  saveTemplate = async (params: SaveTemplateParams) => {
    return lambdaClient.dingtalkApproval.saveTemplate.mutate(params);
  };

  deleteTemplate = async (params: DeleteTemplateParams) => {
    return lambdaClient.dingtalkApproval.deleteTemplate.mutate(params);
  };

  createApprovalRule = async (params: CreateApprovalRuleParams & { topicId?: string | null }) => {
    const { topicId, ...rest } = params;
    return lambdaClient.dingtalkApproval.createApprovalRule.mutate({
      ...rest,
      topicId: topicId ?? undefined,
    });
  };

  updateApprovalRule = async (params: UpdateApprovalRuleParams) => {
    return lambdaClient.dingtalkApproval.updateApprovalRule.mutate(params);
  };

  deleteApprovalRule = async (params: DeleteApprovalRuleParams) => {
    return lambdaClient.dingtalkApproval.deleteApprovalRule.mutate(params);
  };

  /**
   * Server-resolved confirm-card summary for a write API. Frontend
   * Intervention surfaces call this; the model does not.
   */
  preview = async (params: DingtalkApprovalPreviewParams) => {
    return lambdaClient.dingtalkApproval.preview.mutate(params);
  };
}

export const dingtalkApprovalService = new DingtalkApprovalClientService();
