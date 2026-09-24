import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import type { AppLinkResolver } from '@lobechat/utils/appLink';

import type {
  CompleteTodoParams,
  DingtalkPersonalApiName,
  DownloadMessageFileParams,
  GetReportParams,
  GetReportTemplateParams,
  GetTodoParams,
  ListGroupMessagesParams,
  ListMyGroupsParams,
  ListMyTodosParams,
  ListReportsParams,
  ListReportTemplatesParams,
  SearchGroupsParams,
  SearchMessagesParams,
  SubmitReportParams,
  UpdateTodoParams,
} from '../types';
import { DingtalkPersonalApiName as DingtalkPersonalApi } from '../types';

/** LLM-visible copy when the tool throws outside the domain handler. */
export const DINGTALK_PERSONAL_INTERNAL_TOOL_CONTENT =
  '操作失败（内部错误），请稍后重试。不要向用户展示技术细节。';

export interface DingtalkPersonalRuntimeCaller {
  call: (
    apiName: DingtalkPersonalApiName,
    args: Record<string, unknown>,
    ctx?: unknown,
  ) => Promise<BuiltinServerRuntimeOutput>;
}

export interface DingtalkPersonalRuntimeOptions {
  /** Resolves manual-action links for the surface (`serverAppLinkResolver(botPlatform)`). */
  resolveLink?: AppLinkResolver;
}

const asArgs = (args: object): Record<string, unknown> => ({
  ...(args as Record<string, unknown>),
});

/**
 * Thin server runtime. Each API forwards to the injected `call`
 * (runDingtalkPersonalTool on the server). No DingTalk or database access here.
 */
export class DingtalkPersonalExecutionRuntime {
  readonly resolveLink: AppLinkResolver;

  constructor(
    private readonly caller: DingtalkPersonalRuntimeCaller,
    options?: DingtalkPersonalRuntimeOptions,
  ) {
    this.resolveLink = options?.resolveLink ?? ((path) => path);
  }

  private invoke(apiName: DingtalkPersonalApiName, args: object = {}, ctx?: unknown) {
    return this.caller.call(apiName, asArgs(args), ctx);
  }

  listMyTodos(args: ListMyTodosParams = {}, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.listMyTodos, args, ctx);
  }

  getTodo(args: GetTodoParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.getTodo, args, ctx);
  }

  searchGroups(args: SearchGroupsParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.searchGroups, args, ctx);
  }

  listMyGroups(args: ListMyGroupsParams = {}, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.listMyGroups, args, ctx);
  }

  listGroupMessages(args: ListGroupMessagesParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.listGroupMessages, args, ctx);
  }

  searchMessages(args: SearchMessagesParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.searchMessages, args, ctx);
  }

  downloadMessageFile(args: DownloadMessageFileParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.downloadMessageFile, args, ctx);
  }

  listReports(args: ListReportsParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.listReports, args, ctx);
  }

  getReport(args: GetReportParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.getReport, args, ctx);
  }

  listReportTemplates(args: ListReportTemplatesParams = {}, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.listReportTemplates, args, ctx);
  }

  getReportTemplate(args: GetReportTemplateParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.getReportTemplate, args, ctx);
  }

  updateTodo(args: UpdateTodoParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.updateTodo, args, ctx);
  }

  completeTodo(args: CompleteTodoParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.completeTodo, args, ctx);
  }

  submitReport(args: SubmitReportParams, ctx?: unknown) {
    return this.invoke(DingtalkPersonalApi.submitReport, args, ctx);
  }
}

export const createDingtalkPersonalRuntime = (
  caller: DingtalkPersonalRuntimeCaller,
  options?: DingtalkPersonalRuntimeOptions,
) => new DingtalkPersonalExecutionRuntime(caller, options);
