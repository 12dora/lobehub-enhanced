import type { BuiltinServerRuntimeOutput, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { dingtalkPersonalService } from '@/services/dingtalkPersonal';

import { DingtalkPersonalApiName, DingtalkPersonalIdentifier } from '../../types';
import type { DingtalkPersonalApiNameValue } from '../apiNames';

const log = debug('lobe-dingtalk-personal:executor');

type ToolArgs = Record<string, unknown>;

const isAuthorizationRequired = (state: unknown): boolean =>
  typeof state === 'object' &&
  state !== null &&
  (state as { kind?: unknown }).kind === 'authorizationRequired';

/**
 * The server output as the tool result. The one reshaping: an
 * `authorizationRequired` failure keeps `success: false` and its content but
 * carries no `error`, because the chat host swaps a result with an error for the
 * raw-arguments fallback and the inline authorize card would never show.
 */
const toResult = (output: BuiltinServerRuntimeOutput): BuiltinToolResult => {
  const errMsg = typeof output.error?.message === 'string' ? output.error.message : undefined;
  const safe = output.content || errMsg || 'Tool execution failed';

  if (output.success) return { content: safe, state: output.state, success: true };

  if (isAuthorizationRequired(output.state)) {
    return { content: safe, state: output.state, success: false };
  }

  return {
    content: safe,
    error: output.error
      ? { body: output.error, message: errMsg ?? safe, type: 'PluginServerError' }
      : undefined,
    state: output.state,
    success: false,
  };
};

const errorResult = (err: unknown, type: string): BuiltinToolResult => {
  const message = err instanceof Error ? err.message : String(err) || 'Unknown error';
  return { content: `Failed: ${message}`, error: { message, type }, success: false };
};

/**
 * SPA executor: every API is one `dingtalkPersonal.callTool` round trip. The
 * server validates, runs the dws op under the user's own authorization and
 * projects the result, so the client only forwards `{ apiName, args }`.
 */
class DingtalkPersonalExecutor extends BaseExecutor<typeof DingtalkPersonalApiName> {
  readonly identifier = DingtalkPersonalIdentifier;
  protected readonly apiEnum = DingtalkPersonalApiName;

  listMyTodos = (params: ToolArgs = {}) =>
    this.forward(DingtalkPersonalApiName.listMyTodos, params);

  getTodo = (params: ToolArgs) => this.forward(DingtalkPersonalApiName.getTodo, params);

  searchGroups = (params: ToolArgs) => this.forward(DingtalkPersonalApiName.searchGroups, params);

  listMyGroups = (params: ToolArgs = {}) =>
    this.forward(DingtalkPersonalApiName.listMyGroups, params);

  listGroupMessages = (params: ToolArgs) =>
    this.forward(DingtalkPersonalApiName.listGroupMessages, params);

  searchMessages = (params: ToolArgs) =>
    this.forward(DingtalkPersonalApiName.searchMessages, params);

  downloadMessageFile = (params: ToolArgs) =>
    this.forward(DingtalkPersonalApiName.downloadMessageFile, params);

  listReports = (params: ToolArgs) => this.forward(DingtalkPersonalApiName.listReports, params);

  getReport = (params: ToolArgs) => this.forward(DingtalkPersonalApiName.getReport, params);

  listReportTemplates = (params: ToolArgs = {}) =>
    this.forward(DingtalkPersonalApiName.listReportTemplates, params);

  getReportTemplate = (params: ToolArgs) =>
    this.forward(DingtalkPersonalApiName.getReportTemplate, params);

  updateTodo = (params: ToolArgs) => this.forward(DingtalkPersonalApiName.updateTodo, params);

  completeTodo = (params: ToolArgs) => this.forward(DingtalkPersonalApiName.completeTodo, params);

  submitReport = (params: ToolArgs) => this.forward(DingtalkPersonalApiName.submitReport, params);

  private async forward(
    apiName: DingtalkPersonalApiNameValue,
    params?: ToolArgs,
  ): Promise<BuiltinToolResult> {
    try {
      log('%s', apiName);
      const output = await dingtalkPersonalService.callTool({ apiName, args: params ?? {} });
      return toResult(output as BuiltinServerRuntimeOutput);
    } catch (error) {
      return errorResult(error, `${apiName.charAt(0).toUpperCase()}${apiName.slice(1)}Failed`);
    }
  }
}

export const dingtalkPersonalExecutor = new DingtalkPersonalExecutor();
