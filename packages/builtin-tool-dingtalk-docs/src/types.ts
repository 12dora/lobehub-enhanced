export const DingtalkDocsIdentifier = 'lobe-dingtalk-docs';

export const DingtalkDocsApiName = {
  appendDoc: 'appendDoc',
  appendSheetRows: 'appendSheetRows',
  createAitableRecords: 'createAitableRecords',
  createDoc: 'createDoc',
  downloadDriveFile: 'downloadDriveFile',
  getAitableSchema: 'getAitableSchema',
  listAitableTables: 'listAitableTables',
  listDrive: 'listDrive',
  listSheets: 'listSheets',
  listWikiNodes: 'listWikiNodes',
  listWikiSpaces: 'listWikiSpaces',
  queryAitableRecords: 'queryAitableRecords',
  readDoc: 'readDoc',
  readSheet: 'readSheet',
  searchAitableBases: 'searchAitableBases',
  searchDocs: 'searchDocs',
  searchDrive: 'searchDrive',
  updateAitableRecords: 'updateAitableRecords',
} as const;

export type DingtalkDocsApiName = (typeof DingtalkDocsApiName)[keyof typeof DingtalkDocsApiName];

/** Write APIs — each has humanIntervention: 'always'. Arrays are one call. */
export const DingtalkDocsWriteApiNames = [
  DingtalkDocsApiName.appendDoc,
  DingtalkDocsApiName.createDoc,
  DingtalkDocsApiName.appendSheetRows,
  DingtalkDocsApiName.createAitableRecords,
  DingtalkDocsApiName.updateAitableRecords,
] as const;

export type DingtalkDocsWriteApiName = (typeof DingtalkDocsWriteApiNames)[number];

export const DingtalkDocsWikiScopes = ['org', 'my'] as const;
export type DingtalkDocsWikiScope = (typeof DingtalkDocsWikiScopes)[number];

export interface SearchDocsParams {
  /** 1–10. Default 5. */
  limit?: number;
  /** 1–200 characters. */
  query: string;
}

export interface ReadDocParams {
  nodeId: string;
}

export interface ListWikiSpacesParams {
  /** org = 组织知识库, my = 我的知识库. Default org. */
  scope?: DingtalkDocsWikiScope;
}

export interface ListWikiNodesParams {
  /** Cursor such as `pos:-1.2713976E7`. */
  cursor?: string;
  folderId?: string;
  workspaceId: string;
}

export interface SearchDriveParams {
  /** 1–10. Default 5. */
  limit?: number;
  /** 1–200 characters. */
  query: string;
}

export interface ListDriveParams {
  cursor?: string;
  folderId?: string;
}

export interface DownloadDriveFileParams {
  nodeId: string;
}

export interface ListSheetsParams {
  nodeId: string;
}

export interface ReadSheetParams {
  nodeId: string;
  /**
   * Any A1 notation. One read spans at most 200 rows × 30 columns;
   * a larger range is clipped from the top-left and the result names the next block.
   * Omitted: the server uses the used range, clipped the same way.
   */
  range?: string;
  sheetId?: string;
}

export interface SearchAitableBasesParams {
  /** 2–100 characters. Omit to list recent bases. */
  query?: string;
}

export interface ListAitableTablesParams {
  baseId: string;
}

export interface GetAitableSchemaParams {
  baseId: string;
  tableId: string;
}

export interface QueryAitableRecordsParams {
  baseId: string;
  cursor?: string;
  /** 1–50. Default 20. */
  limit?: number;
  query?: string;
  tableId: string;
}

export interface AppendDocParams {
  /** 1–20000 characters. */
  markdown: string;
  nodeId: string;
}

export interface CreateDocParams {
  folderId?: string;
  /** 0–20000 characters. */
  markdown: string;
  /** 1–100 characters. */
  title: string;
}

/** Sheet cell: string ≤ 500 not starting with `=`, or a finite number. */
export type SheetCell = number | string;

export interface AppendSheetRowsParams {
  nodeId: string;
  /** 1–50 rows, each ≤ 30 columns. */
  rows: SheetCell[][];
  sheetId: string;
}

export type AitableCellValue = boolean | number | string;

export interface AitableRecordCells {
  /** Keys are fieldId from getAitableSchema. At most 50 fields. */
  cells: Record<string, AitableCellValue>;
}

export interface CreateAitableRecordsParams {
  baseId: string;
  /** 1–20 records. Non-idempotent: never retry. */
  records: AitableRecordCells[];
  tableId: string;
}

export interface AitableRecordUpdate extends AitableRecordCells {
  recordId: string;
}

export interface UpdateAitableRecordsParams {
  baseId: string;
  /** 1–20 records. */
  records: AitableRecordUpdate[];
  tableId: string;
}

export interface DocItem {
  docType: string;
  modifiedTime?: number | string | null;
  name: string;
  nodeId: string;
  url?: string;
}

export interface DocsState {
  hasMore: boolean;
  items: DocItem[];
  kind: 'docs';
}

export interface DocState {
  kind: 'doc';
  length: number;
  nodeId: string;
  /** At most 2000 characters. */
  preview: string;
  title: string;
  url?: string;
}

export interface WikiSpaceItem {
  description?: string;
  name: string;
  url?: string;
  workspaceId: string;
}

export interface WikiSpacesState {
  kind: 'wikiSpaces';
  spaces: WikiSpaceItem[];
}

export interface WikiNodeItem {
  extension?: string;
  hasChildren: boolean;
  name: string;
  nodeId: string;
  type: string;
  url?: string;
}

export interface WikiNodesState {
  hasMore: boolean;
  kind: 'wikiNodes';
  nextCursor?: string;
  nodes: WikiNodeItem[];
  workspaceId: string;
}

export interface DriveFileItem {
  fileSize?: number;
  name: string;
  nodeId: string;
  type: string;
}

export interface DriveFilesState {
  files: DriveFileItem[];
  hasMore: boolean;
  kind: 'driveFiles';
  nextCursor?: string;
}

/** Same shape as lobe-dingtalk-personal FileState. */
export interface FileState {
  fileId?: string;
  kind: 'file';
  name: string;
  preview?: string;
  sizeBytes: number;
  url?: string;
}

export interface SheetItem {
  columnCount?: number;
  rowCount?: number;
  sheetId: string;
  title: string;
  usedRange?: string;
}

export interface SheetsState {
  kind: 'sheets';
  nodeId: string;
  sheets: SheetItem[];
}

export interface SheetRangeState {
  kind: 'sheetRange';
  nodeId: string;
  range: string;
  rows: string[][];
  sheetId?: string;
  truncated: boolean;
}

export interface AitableBaseItem {
  baseId: string;
  baseName: string;
}

export interface AitableBasesState {
  bases: AitableBaseItem[];
  kind: 'aitableBases';
}

export interface AitableTableItem {
  tableId: string;
  tableName: string;
}

export interface AitableTablesState {
  baseId: string;
  kind: 'aitableTables';
  tables: AitableTableItem[];
}

export interface AitableField {
  fieldId: string;
  name: string;
  type: string;
}

export interface AitableSchemaState {
  baseId: string;
  fields: AitableField[];
  kind: 'aitableSchema';
  tableId: string;
  tableName: string;
}

export interface AitableRecord {
  /** Keys are field names, not field ids. */
  cells: Record<string, string>;
  recordId: string;
}

export interface AitableRecordsState {
  baseId: string;
  fields: Array<Pick<AitableField, 'fieldId' | 'name'>>;
  hasMore: boolean;
  kind: 'aitableRecords';
  nextCursor?: string;
  records: AitableRecord[];
  tableId: string;
}

export interface WriteState {
  action: DingtalkDocsWriteApiName;
  count?: number;
  kind: 'write';
  summary: string;
  url?: string;
}

/**
 * Login card payload. Same shape as DingtalkPersonalLoginView so client code
 * can render the shared authorization card without importing the server.
 */
export interface DingtalkDocsLoginView {
  errorCode?: 'IDENTITY_MISMATCH' | 'ORG_CLI_DISABLED' | 'LOGIN_TIMEOUT' | 'LOGIN_FAILED';
  expiresAt: string;
  jobId: string;
  mismatchUserName?: string;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
  userCode: string;
  verificationUrl: string;
}

/** Same shape as lobe-dingtalk-personal AuthRequiredState. */
export interface AuthRequiredState {
  /**
   * URL already embedded in the tool `content` markdown link.
   * DingTalk: device verification URL. Web and other clients: settings deep link.
   */
  authUrl?: string;
  code: string;
  kind: 'authorizationRequired';
  login?: DingtalkDocsLoginView;
  settingsPath: '/settings/connector';
}

/** Every projected tool state. `kind` selects the render. */
export type DingtalkDocsToolState =
  | AitableBasesState
  | AitableRecordsState
  | AitableSchemaState
  | AitableTablesState
  | AuthRequiredState
  | DocState
  | DocsState
  | DriveFilesState
  | FileState
  | SheetRangeState
  | SheetsState
  | WikiNodesState
  | WikiSpacesState
  | WriteState;

/** Confirm-card preview (lambda `preview`; not a model-facing API). */
export interface DingtalkDocsPreview {
  danger: boolean;
  lines: string[];
  title: string;
  warnings: string[];
}
