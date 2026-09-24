/**
 * API names and state shapes live in `@lobechat/builtin-tool-dingtalk-docs`.
 * This module keeps the tuple the lambda `z.enum` already imports.
 */
import {
  DingtalkDocsApiName as DingtalkDocsApi,
  type DingtalkDocsApiName,
  DingtalkDocsWriteApiNames,
} from '@lobechat/builtin-tool-dingtalk-docs';

export type {
  AitableBaseItem,
  AitableBasesState,
  AitableField,
  AitableRecord,
  AitableRecordsState,
  AitableSchemaState,
  AitableTableItem,
  AitableTablesState,
  AuthRequiredState,
  DingtalkDocsApiName,
  DingtalkDocsPreview,
  DingtalkDocsToolState,
  DingtalkDocsWriteApiName,
  DocItem,
  DocsState,
  DocState,
  DriveFileItem,
  DriveFilesState,
  FileState,
  SheetItem,
  SheetRangeState,
  SheetsState,
  WikiNodeItem,
  WikiNodesState,
  WikiSpaceItem,
  WikiSpacesState,
  WriteState,
} from '@lobechat/builtin-tool-dingtalk-docs';

/** Same shape as the package `WriteState`. Kept for existing server imports. */
export type { WriteState as DocsWriteState } from '@lobechat/builtin-tool-dingtalk-docs';

export const DINGTALK_DOCS_WRITE_API_NAMES = DingtalkDocsWriteApiNames;

/** Order matches the package object and the lambda router. */
export const DINGTALK_DOCS_API_NAMES = [
  DingtalkDocsApi.searchDocs,
  DingtalkDocsApi.readDoc,
  DingtalkDocsApi.listWikiSpaces,
  DingtalkDocsApi.listWikiNodes,
  DingtalkDocsApi.searchDrive,
  DingtalkDocsApi.listDrive,
  DingtalkDocsApi.downloadDriveFile,
  DingtalkDocsApi.listSheets,
  DingtalkDocsApi.readSheet,
  DingtalkDocsApi.searchAitableBases,
  DingtalkDocsApi.listAitableTables,
  DingtalkDocsApi.getAitableSchema,
  DingtalkDocsApi.queryAitableRecords,
  DingtalkDocsApi.appendDoc,
  DingtalkDocsApi.createDoc,
  DingtalkDocsApi.appendSheetRows,
  DingtalkDocsApi.createAitableRecords,
  DingtalkDocsApi.updateAitableRecords,
] as [DingtalkDocsApiName, ...DingtalkDocsApiName[]];
