import type { BuiltinServerRuntimeOutput, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { dingtalkDocsService } from '@/services/dingtalkDocs';

import { DingtalkDocsApiName, DingtalkDocsIdentifier } from '../../types';
import type { DingtalkDocsApiNameValue } from '../apiNames';

const log = debug('lobe-dingtalk-docs:executor');

type ToolArgs = Record<string, unknown>;

const isAuthorizationRequired = (state: unknown): boolean =>
  typeof state === 'object' &&
  state !== null &&
  (state as { kind?: unknown }).kind === 'authorizationRequired';

/**
 * The server output as the tool result. Same reshaping as lobe-dingtalk-personal: an
 * `authorizationRequired` failure keeps `success: false` and its content but carries no `error`,
 * because the chat host swaps a result with an error for the raw-arguments fallback and the inline
 * authorize card would never show.
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
 * SPA executor: every API is one `dingtalkDocs.callTool` round trip. The server validates,
 * runs the dws op under the member's own authorization and projects the result, so the client only
 * forwards `{ apiName, args }`. Writes reach this point only after the confirm card was approved.
 */
class DingtalkDocsExecutor extends BaseExecutor<typeof DingtalkDocsApiName> {
  readonly identifier = DingtalkDocsIdentifier;
  protected readonly apiEnum = DingtalkDocsApiName;

  // 文档 / 知识库 / 钉盘
  searchDocs = (params: ToolArgs) => this.forward(DingtalkDocsApiName.searchDocs, params);

  readDoc = (params: ToolArgs) => this.forward(DingtalkDocsApiName.readDoc, params);

  listWikiSpaces = (params: ToolArgs = {}) =>
    this.forward(DingtalkDocsApiName.listWikiSpaces, params);

  listWikiNodes = (params: ToolArgs) => this.forward(DingtalkDocsApiName.listWikiNodes, params);

  searchDrive = (params: ToolArgs) => this.forward(DingtalkDocsApiName.searchDrive, params);

  listDrive = (params: ToolArgs = {}) => this.forward(DingtalkDocsApiName.listDrive, params);

  downloadDriveFile = (params: ToolArgs) =>
    this.forward(DingtalkDocsApiName.downloadDriveFile, params);

  // 在线表格
  listSheets = (params: ToolArgs) => this.forward(DingtalkDocsApiName.listSheets, params);

  readSheet = (params: ToolArgs) => this.forward(DingtalkDocsApiName.readSheet, params);

  // AI 表格
  searchAitableBases = (params: ToolArgs = {}) =>
    this.forward(DingtalkDocsApiName.searchAitableBases, params);

  listAitableTables = (params: ToolArgs) =>
    this.forward(DingtalkDocsApiName.listAitableTables, params);

  getAitableSchema = (params: ToolArgs) =>
    this.forward(DingtalkDocsApiName.getAitableSchema, params);

  queryAitableRecords = (params: ToolArgs) =>
    this.forward(DingtalkDocsApiName.queryAitableRecords, params);

  // Writes (confirmed)
  appendDoc = (params: ToolArgs) => this.forward(DingtalkDocsApiName.appendDoc, params);

  createDoc = (params: ToolArgs) => this.forward(DingtalkDocsApiName.createDoc, params);

  appendSheetRows = (params: ToolArgs) => this.forward(DingtalkDocsApiName.appendSheetRows, params);

  createAitableRecords = (params: ToolArgs) =>
    this.forward(DingtalkDocsApiName.createAitableRecords, params);

  updateAitableRecords = (params: ToolArgs) =>
    this.forward(DingtalkDocsApiName.updateAitableRecords, params);

  private async forward(
    apiName: DingtalkDocsApiNameValue,
    params?: ToolArgs,
  ): Promise<BuiltinToolResult> {
    try {
      log('%s', apiName);
      const output = await dingtalkDocsService.callTool({ apiName, args: params ?? {} });
      return toResult(output as BuiltinServerRuntimeOutput);
    } catch (error) {
      return errorResult(error, `${apiName.charAt(0).toUpperCase()}${apiName.slice(1)}Failed`);
    }
  }
}

export const dingtalkDocsExecutor = new DingtalkDocsExecutor();
