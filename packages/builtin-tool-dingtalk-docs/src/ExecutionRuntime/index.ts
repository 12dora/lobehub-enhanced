import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import type { AppLinkResolver } from '@lobechat/utils/appLink';

import type {
  AppendDocParams,
  AppendSheetRowsParams,
  CreateAitableRecordsParams,
  CreateDocParams,
  DingtalkDocsApiName,
  DownloadDriveFileParams,
  GetAitableSchemaParams,
  ListAitableTablesParams,
  ListDriveParams,
  ListSheetsParams,
  ListWikiNodesParams,
  ListWikiSpacesParams,
  QueryAitableRecordsParams,
  ReadDocParams,
  ReadSheetParams,
  SearchAitableBasesParams,
  SearchDocsParams,
  SearchDriveParams,
  UpdateAitableRecordsParams,
} from '../types';
import { DingtalkDocsApiName as DingtalkDocsApi } from '../types';

/** LLM-visible copy when the tool throws outside the domain handler. */
export const DINGTALK_DOCS_INTERNAL_TOOL_CONTENT =
  '操作失败（内部错误），请稍后重试。不要向用户展示技术细节。';

export interface DingtalkDocsRuntimeCaller {
  call: (
    apiName: DingtalkDocsApiName,
    args: Record<string, unknown>,
    ctx?: unknown,
  ) => Promise<BuiltinServerRuntimeOutput>;
}

export interface DingtalkDocsRuntimeOptions {
  /** Resolves manual-action links for the surface (`serverAppLinkResolver(botPlatform)`). */
  resolveLink?: AppLinkResolver;
}

const asArgs = (args: object): Record<string, unknown> => ({
  ...(args as Record<string, unknown>),
});

/**
 * Thin server runtime. Each API forwards to the injected `call`
 * (runDingtalkDocsTool on the server). No DingTalk or database access here.
 */
export class DingtalkDocsExecutionRuntime {
  readonly resolveLink: AppLinkResolver;

  constructor(
    private readonly caller: DingtalkDocsRuntimeCaller,
    options?: DingtalkDocsRuntimeOptions,
  ) {
    this.resolveLink = options?.resolveLink ?? ((path) => path);
  }

  private invoke(apiName: DingtalkDocsApiName, args: object = {}, ctx?: unknown) {
    return this.caller.call(apiName, asArgs(args), ctx);
  }

  searchDocs(args: SearchDocsParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.searchDocs, args, ctx);
  }

  readDoc(args: ReadDocParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.readDoc, args, ctx);
  }

  listWikiSpaces(args: ListWikiSpacesParams = {}, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.listWikiSpaces, args, ctx);
  }

  listWikiNodes(args: ListWikiNodesParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.listWikiNodes, args, ctx);
  }

  searchDrive(args: SearchDriveParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.searchDrive, args, ctx);
  }

  listDrive(args: ListDriveParams = {}, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.listDrive, args, ctx);
  }

  downloadDriveFile(args: DownloadDriveFileParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.downloadDriveFile, args, ctx);
  }

  listSheets(args: ListSheetsParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.listSheets, args, ctx);
  }

  readSheet(args: ReadSheetParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.readSheet, args, ctx);
  }

  searchAitableBases(args: SearchAitableBasesParams = {}, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.searchAitableBases, args, ctx);
  }

  listAitableTables(args: ListAitableTablesParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.listAitableTables, args, ctx);
  }

  getAitableSchema(args: GetAitableSchemaParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.getAitableSchema, args, ctx);
  }

  queryAitableRecords(args: QueryAitableRecordsParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.queryAitableRecords, args, ctx);
  }

  appendDoc(args: AppendDocParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.appendDoc, args, ctx);
  }

  createDoc(args: CreateDocParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.createDoc, args, ctx);
  }

  appendSheetRows(args: AppendSheetRowsParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.appendSheetRows, args, ctx);
  }

  createAitableRecords(args: CreateAitableRecordsParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.createAitableRecords, args, ctx);
  }

  updateAitableRecords(args: UpdateAitableRecordsParams, ctx?: unknown) {
    return this.invoke(DingtalkDocsApi.updateAitableRecords, args, ctx);
  }
}

export const createDingtalkDocsRuntime = (
  caller: DingtalkDocsRuntimeCaller,
  options?: DingtalkDocsRuntimeOptions,
) => new DingtalkDocsExecutionRuntime(caller, options);
