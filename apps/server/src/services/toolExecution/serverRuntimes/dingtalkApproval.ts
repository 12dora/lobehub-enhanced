import type { IDingtalkApprovalService } from '@lobechat/builtin-tool-dingtalk-approval/executionRuntime';
import {
  createDingtalkApprovalRuntime,
  DingtalkApprovalExecutionRuntime,
} from '@lobechat/builtin-tool-dingtalk-approval/executionRuntime';
import { DingtalkApprovalIdentifier } from '@lobechat/builtin-tool-dingtalk-approval/manifest';

import type { ServerRuntimeRegistration } from './types';

export { createDingtalkApprovalRuntime, DingtalkApprovalExecutionRuntime };
export type { IDingtalkApprovalService };

export const dingtalkApprovalRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { serverDB, topicId, userId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for DingTalk approval execution');
    }

    const [{ DingtalkApprovalService }, { DingtalkApprovalRuleService }, { ReminderService }] =
      await Promise.all([
        import('@/server/enterprise/services/dingtalkWorkspace/approval'),
        import('@/server/enterprise/services/dingtalkWorkspace/approvalRules'),
        import('@/server/enterprise/services/reminder'),
      ]);
    const approval = new DingtalkApprovalService(serverDB, userId);
    const rules = new DingtalkApprovalRuleService(serverDB, userId);
    const directory = new ReminderService(serverDB, userId);

    return createDingtalkApprovalRuntime({
      addApprover: (params) => approval.appendTask(params),
      approveTask: (params) => approval.executeTask({ ...params, result: 'agree' }),
      commentApproval: (params) => approval.addComment(params),
      createApprovalRule: (params) => {
        const { processName: _processName, topicId: ruleTopicId, ...rest } = params;
        return rules.create({
          ...rest,
          createdByTopicId: ruleTopicId ?? topicId ?? undefined,
        });
      },
      deleteApprovalRule: (params) => rules.remove(params.id),
      deleteTemplate: (params) => approval.deleteTemplate(params),
      getApprovalDetail: (params) => approval.getInstance(params.processInstanceId),
      getTemplateSchema: (params) => approval.getTemplateSchema(params.processCode),
      listApprovalRules: (params) =>
        rules.list({ includeDisabled: params?.includeDisabled ?? false }),
      listMyApplications: (params) => approval.listInitiated(params),
      listPendingApprovals: (params) => approval.listPending(params),
      listTemplates: (params) => approval.listTemplates(params),
      refuseTask: (params) => approval.executeTask({ ...params, result: 'refuse' }),
      returnTask: (params) => approval.revertTask(params),
      saveTemplate: (params) => {
        const mapLeaf = (field: (typeof params.fields)[number]) => ({
          bizAlias: field.bizAlias,
          componentId: field.componentId,
          componentType: field.componentType,
          format: field.format,
          label: field.label,
          options: field.options,
          placeholder: field.placeholder,
          required: field.required,
          unit: field.unit,
        });
        const fields = params.fields.map((field) => ({
          ...mapLeaf(field),
          ...(field.children && field.children.length > 0
            ? { children: field.children.map(mapLeaf) }
            : {}),
        }));
        return approval.saveTemplate({
          description: params.description,
          fields,
          name: params.name,
          processCode: params.processCode,
        });
      },
      searchDirectory: (params) => directory.searchDirectory(params.q, params.kind),
      submitApproval: (params) =>
        approval.createInstance({
          approverStaffTokens: params.approverStaffTokens,
          ccStaffTokens: params.ccStaffTokens,
          deptId: params.deptId,
          formValues: params.formValues,
          processCode: params.processCode,
          targetSelectActioners: params.targetSelectActioners?.map((item) => ({
            actionerKey: item.actionerKey,
            staffTokens: item.actionerStaffTokens,
          })),
        }),
      transferTask: (params) => approval.redirectTask(params),
      updateApprovalRule: (params) => {
        const { id, processName: _processName, ...patch } = params;
        return rules.update(id, patch);
      },
      withdrawApplication: (params) => approval.terminateInstance(params),
    });
  },
  identifier: DingtalkApprovalIdentifier,
};
