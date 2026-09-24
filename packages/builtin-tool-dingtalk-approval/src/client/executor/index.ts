import type {
  BuiltinServerRuntimeOutput,
  BuiltinToolContext,
  BuiltinToolResult,
} from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { dingtalkApprovalService } from '@/services/dingtalkApproval';

import type { IDingtalkApprovalService } from '../../ExecutionRuntime';
import { DingtalkApprovalExecutionRuntime } from '../../ExecutionRuntime';
import { DingtalkApprovalIdentifier } from '../../manifest';
import type {
  AddApproverParams,
  ApproveTaskParams,
  CommentApprovalParams,
  CreateApprovalRuleParams,
  DeleteApprovalRuleParams,
  DeleteTemplateParams,
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
} from '../../types';
import { DingtalkApprovalApiName } from '../../types';

const log = debug('lobe-dingtalk-approval:executor');

/** Batch params exactly as the runtime declares them (`{ tasks, remark }`). */
type BatchParams<K extends 'approveTasks' | 'refuseTasks'> = Parameters<
  DingtalkApprovalExecutionRuntime[K]
>[0];

const loadApprovalService = async (): Promise<IDingtalkApprovalService> => {
  return {
    addApprover: (params) => dingtalkApprovalService.addApprover(params),
    approveTask: (params) => dingtalkApprovalService.approveTask(params),
    commentApproval: (params) => dingtalkApprovalService.commentApproval(params),
    createApprovalRule: (params) => dingtalkApprovalService.createApprovalRule(params),
    deleteApprovalRule: (params) => dingtalkApprovalService.deleteApprovalRule(params),
    deleteTemplate: (params) => dingtalkApprovalService.deleteTemplate(params),
    getApprovalDetail: (params) => dingtalkApprovalService.getApprovalDetail(params),
    getTemplateSchema: (params) => dingtalkApprovalService.getTemplateSchema(params),
    listApprovalRules: (params) => dingtalkApprovalService.listApprovalRules(params),
    listMyApplications: (params) => dingtalkApprovalService.listMyApplications(params),
    listPendingApprovals: (params) => dingtalkApprovalService.listPendingApprovals(params),
    listTemplates: (params) => dingtalkApprovalService.listTemplates(params),
    refuseTask: (params) => dingtalkApprovalService.refuseTask(params),
    returnTask: (params) => dingtalkApprovalService.returnTask(params),
    saveTemplate: (params) => dingtalkApprovalService.saveTemplate(params),
    searchDirectory: async (params) =>
      (await dingtalkApprovalService.searchDirectory(params)) ?? {
        ambiguous: false,
        departments: [],
        users: [],
      },
    submitApproval: (params) => dingtalkApprovalService.submitApproval(params),
    transferTask: (params) => dingtalkApprovalService.transferTask(params),
    updateApprovalRule: (params) => dingtalkApprovalService.updateApprovalRule(params),
    withdrawApplication: (params) => dingtalkApprovalService.withdrawApplication(params),
  };
};

class DingtalkApprovalExecutor extends BaseExecutor<typeof DingtalkApprovalApiName> {
  readonly identifier = DingtalkApprovalIdentifier;
  protected readonly apiEnum = DingtalkApprovalApiName;
  private runtimePromise?: Promise<DingtalkApprovalExecutionRuntime>;

  private getRuntime() {
    this.runtimePromise ??= loadApprovalService().then(
      (service) => new DingtalkApprovalExecutionRuntime(service),
    );
    return this.runtimePromise;
  }

  private call = async (
    run: (runtime: DingtalkApprovalExecutionRuntime) => Promise<BuiltinServerRuntimeOutput>,
    type: string,
  ): Promise<BuiltinToolResult> => {
    try {
      const runtime = await this.getRuntime();
      return this.toResult(await run(runtime));
    } catch (error) {
      return this.errorResult(error, type);
    }
  };

  listTemplates = async (params: ListTemplatesParams = {}): Promise<BuiltinToolResult> => {
    log('listTemplates q=%s', params.q);
    return this.call((runtime) => runtime.listTemplates(params), 'ListTemplatesFailed');
  };

  getTemplateSchema = async (params: GetTemplateSchemaParams): Promise<BuiltinToolResult> => {
    log('getTemplateSchema processCode=%s', params.processCode);
    return this.call((runtime) => runtime.getTemplateSchema(params), 'GetTemplateSchemaFailed');
  };

  listPendingApprovals = async (
    params: ListPendingApprovalsParams = {},
  ): Promise<BuiltinToolResult> => {
    log('listPendingApprovals limit=%s', params.limit);
    return this.call(
      (runtime) => runtime.listPendingApprovals(params),
      'ListPendingApprovalsFailed',
    );
  };

  listMyApplications = async (
    params: ListMyApplicationsParams = {},
  ): Promise<BuiltinToolResult> => {
    log('listMyApplications status=%s', params.status);
    return this.call((runtime) => runtime.listMyApplications(params), 'ListMyApplicationsFailed');
  };

  getApprovalDetail = async (params: GetApprovalDetailParams): Promise<BuiltinToolResult> => {
    log('getApprovalDetail id=%s', params.processInstanceId);
    return this.call((runtime) => runtime.getApprovalDetail(params), 'GetApprovalDetailFailed');
  };

  searchDirectory = async (params: SearchDirectoryParams): Promise<BuiltinToolResult> => {
    log('searchDirectory q=%s kind=%s', params.q, params.kind);
    return this.call((runtime) => runtime.searchDirectory(params), 'SearchDirectoryFailed');
  };

  listApprovalRules = async (params: ListApprovalRulesParams = {}): Promise<BuiltinToolResult> => {
    log('listApprovalRules includeDisabled=%s', params.includeDisabled);
    return this.call((runtime) => runtime.listApprovalRules(params), 'ListApprovalRulesFailed');
  };

  submitApproval = async (params: SubmitApprovalParams): Promise<BuiltinToolResult> => {
    log('submitApproval processCode=%s', params.processCode);
    return this.call((runtime) => runtime.submitApproval(params), 'SubmitApprovalFailed');
  };

  approveTask = async (params: ApproveTaskParams): Promise<BuiltinToolResult> => {
    log('approveTask taskId=%s', params.taskId);
    return this.call((runtime) => runtime.approveTask(params), 'ApproveTaskFailed');
  };

  refuseTask = async (params: RefuseTaskParams): Promise<BuiltinToolResult> => {
    log('refuseTask taskId=%s', params.taskId);
    return this.call((runtime) => runtime.refuseTask(params), 'RefuseTaskFailed');
  };

  approveTasks = async (params: BatchParams<'approveTasks'>): Promise<BuiltinToolResult> => {
    log('approveTasks count=%d', params?.tasks?.length ?? 0);
    return this.call((runtime) => runtime.approveTasks(params), 'ApproveTasksFailed');
  };

  refuseTasks = async (params: BatchParams<'refuseTasks'>): Promise<BuiltinToolResult> => {
    log('refuseTasks count=%d', params?.tasks?.length ?? 0);
    return this.call((runtime) => runtime.refuseTasks(params), 'RefuseTasksFailed');
  };

  transferTask = async (params: TransferTaskParams): Promise<BuiltinToolResult> => {
    log('transferTask taskId=%s', params.taskId);
    return this.call((runtime) => runtime.transferTask(params), 'TransferTaskFailed');
  };

  commentApproval = async (params: CommentApprovalParams): Promise<BuiltinToolResult> => {
    log('commentApproval id=%s', params.processInstanceId);
    return this.call((runtime) => runtime.commentApproval(params), 'CommentApprovalFailed');
  };

  withdrawApplication = async (params: WithdrawApplicationParams): Promise<BuiltinToolResult> => {
    log('withdrawApplication id=%s', params.processInstanceId);
    return this.call((runtime) => runtime.withdrawApplication(params), 'WithdrawApplicationFailed');
  };

  returnTask = async (params: ReturnTaskParams): Promise<BuiltinToolResult> => {
    log('returnTask taskId=%s', params.taskId);
    return this.call((runtime) => runtime.returnTask(params), 'ReturnTaskFailed');
  };

  addApprover = async (params: AddApproverParams): Promise<BuiltinToolResult> => {
    log('addApprover taskId=%s', params.taskId);
    return this.call((runtime) => runtime.addApprover(params), 'AddApproverFailed');
  };

  saveTemplate = async (params: SaveTemplateParams): Promise<BuiltinToolResult> => {
    log('saveTemplate name=%s', params.name);
    return this.call((runtime) => runtime.saveTemplate(params), 'SaveTemplateFailed');
  };

  deleteTemplate = async (params: DeleteTemplateParams): Promise<BuiltinToolResult> => {
    log('deleteTemplate processCode=%s', params.processCode);
    return this.call((runtime) => runtime.deleteTemplate(params), 'DeleteTemplateFailed');
  };

  createApprovalRule = async (
    params: CreateApprovalRuleParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    log('createApprovalRule name=%s', params.name);
    return this.call(
      (runtime) => runtime.createApprovalRule({ ...params, topicId: ctx?.topicId }),
      'CreateApprovalRuleFailed',
    );
  };

  updateApprovalRule = async (params: UpdateApprovalRuleParams): Promise<BuiltinToolResult> => {
    log('updateApprovalRule id=%s', params.id);
    return this.call((runtime) => runtime.updateApprovalRule(params), 'UpdateApprovalRuleFailed');
  };

  deleteApprovalRule = async (params: DeleteApprovalRuleParams): Promise<BuiltinToolResult> => {
    log('deleteApprovalRule id=%s', params.id);
    return this.call((runtime) => runtime.deleteApprovalRule(params), 'DeleteApprovalRuleFailed');
  };

  private toResult(output: BuiltinServerRuntimeOutput): BuiltinToolResult {
    const errMsg = typeof output.error?.message === 'string' ? output.error.message : undefined;
    const safe = output.content || errMsg || 'Tool execution failed';
    if (!output.success) {
      return {
        content: safe,
        error: output.error
          ? { body: output.error, message: errMsg ?? safe, type: 'PluginServerError' }
          : undefined,
        state: output.state,
        success: false,
      };
    }
    return { content: safe, state: output.state, success: true };
  }

  private errorResult(err: unknown, type: string): BuiltinToolResult {
    const message = err instanceof Error ? err.message : String(err) || 'Unknown error';
    return { content: `Failed: ${message}`, error: { message, type }, success: false };
  }
}

export const dingtalkApprovalExecutor = new DingtalkApprovalExecutor();
