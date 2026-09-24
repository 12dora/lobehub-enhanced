/**
 * Every broker call `runDingtalkDocsTool` produces for the 18 APIs
 * (typical arguments and optional arguments). The sidecar contract test
 * feeds these through `prepareExec`; the server test checks the executor
 * actually emits them.
 */
export interface DocsExecCall {
  args: Record<string, unknown>;
  op: string;
  via: 'download' | 'exec';
}

export interface DocsExecScenario {
  apiName: string;
  args: Record<string, unknown>;
  calls: DocsExecCall[];
}

export const DOCS_NODE = '14lgw90DnodeDocument0000000001';
export const DOCS_SHEET = 'st-4278sheet01';
export const DOCS_BASE = 'YndMjz5aAbase00000000000000001';
export const DOCS_TABLE = 'knhttimpzdr31aq2r3ykq';
export const DOCS_WORKSPACE = 'e3RmXaPworkspace1';
export const DOCS_FOLDER = 'fld1';
export const DOCS_CURSOR = 'pos:-1.2713976E7';

const exec = (op: string, args: Record<string, unknown>): DocsExecCall => ({
  args,
  op,
  via: 'exec',
});

export const DOCS_EXEC_SCENARIOS: DocsExecScenario[] = [
  {
    apiName: 'searchDocs',
    args: { query: '周报' },
    calls: [exec('doc.search', { limit: 5, query: '周报' })],
  },
  {
    apiName: 'searchDocs',
    args: { limit: 10, query: '周报' },
    calls: [exec('doc.search', { limit: 10, query: '周报' })],
  },
  {
    apiName: 'readDoc',
    args: { nodeId: DOCS_NODE },
    calls: [exec('doc.read', { nodeId: DOCS_NODE })],
  },
  {
    apiName: 'listWikiSpaces',
    args: {},
    calls: [exec('wiki.spaces', { type: 'orgWikiSpace' })],
  },
  {
    apiName: 'listWikiSpaces',
    args: { scope: 'my' },
    calls: [exec('wiki.spaces', { type: 'myWikiSpace' })],
  },
  {
    apiName: 'listWikiNodes',
    args: { workspaceId: DOCS_WORKSPACE },
    calls: [exec('wiki.nodes', { limit: 20, workspaceId: DOCS_WORKSPACE })],
  },
  {
    apiName: 'listWikiNodes',
    args: { cursor: DOCS_CURSOR, folderId: DOCS_FOLDER, workspaceId: DOCS_WORKSPACE },
    calls: [
      exec('wiki.nodes', {
        cursor: DOCS_CURSOR,
        folderId: DOCS_FOLDER,
        limit: 20,
        workspaceId: DOCS_WORKSPACE,
      }),
    ],
  },
  {
    apiName: 'searchDrive',
    args: { query: '库存' },
    calls: [exec('drive.search', { limit: 5, query: '库存' })],
  },
  {
    apiName: 'searchDrive',
    args: { limit: 1, query: '库存' },
    calls: [exec('drive.search', { limit: 1, query: '库存' })],
  },
  {
    apiName: 'listDrive',
    args: {},
    calls: [exec('drive.list', {})],
  },
  {
    apiName: 'listDrive',
    args: { cursor: DOCS_CURSOR, folderId: DOCS_FOLDER },
    calls: [exec('drive.list', { cursor: DOCS_CURSOR, folderId: DOCS_FOLDER })],
  },
  {
    apiName: 'downloadDriveFile',
    args: { nodeId: DOCS_NODE },
    calls: [{ args: { nodeId: DOCS_NODE }, op: 'drive.download', via: 'download' }],
  },
  {
    apiName: 'listSheets',
    args: { nodeId: DOCS_NODE },
    calls: [
      exec('sheet.list', { nodeId: DOCS_NODE }),
      exec('sheet.info', { nodeId: DOCS_NODE, sheetId: DOCS_SHEET }),
    ],
  },
  {
    apiName: 'readSheet',
    args: { nodeId: DOCS_NODE, sheetId: DOCS_SHEET },
    calls: [
      exec('sheet.info', { nodeId: DOCS_NODE, sheetId: DOCS_SHEET }),
      exec('sheet.read', { nodeId: DOCS_NODE, range: 'A1:AD14', sheetId: DOCS_SHEET }),
    ],
  },
  {
    apiName: 'readSheet',
    args: { nodeId: DOCS_NODE, range: 'A1:C3', sheetId: DOCS_SHEET },
    calls: [exec('sheet.read', { nodeId: DOCS_NODE, range: 'A1:C3', sheetId: DOCS_SHEET })],
  },
  {
    apiName: 'readSheet',
    args: { nodeId: DOCS_NODE, range: 'a1:b2' },
    calls: [exec('sheet.read', { nodeId: DOCS_NODE, range: 'A1:B2' })],
  },
  {
    apiName: 'readSheet',
    args: { nodeId: DOCS_NODE, range: 'A1:AO14' },
    calls: [exec('sheet.read', { nodeId: DOCS_NODE, range: 'A1:AD14' })],
  },
  {
    apiName: 'searchAitableBases',
    args: {},
    calls: [exec('aitable.bases', {})],
  },
  {
    apiName: 'searchAitableBases',
    args: { query: '客户' },
    calls: [exec('aitable.bases', { query: '客户' })],
  },
  {
    apiName: 'listAitableTables',
    args: { baseId: DOCS_BASE },
    calls: [exec('aitable.tables', { baseId: DOCS_BASE })],
  },
  {
    apiName: 'getAitableSchema',
    args: { baseId: DOCS_BASE, tableId: DOCS_TABLE },
    calls: [exec('aitable.schema', { baseId: DOCS_BASE, tableId: DOCS_TABLE })],
  },
  {
    apiName: 'queryAitableRecords',
    args: { baseId: DOCS_BASE, tableId: DOCS_TABLE },
    calls: [
      exec('aitable.schema', { baseId: DOCS_BASE, tableId: DOCS_TABLE }),
      exec('aitable.records.query', { baseId: DOCS_BASE, limit: 20, tableId: DOCS_TABLE }),
    ],
  },
  {
    apiName: 'queryAitableRecords',
    args: {
      baseId: DOCS_BASE,
      cursor: DOCS_CURSOR,
      limit: 50,
      query: '甲',
      tableId: DOCS_TABLE,
    },
    calls: [
      exec('aitable.schema', { baseId: DOCS_BASE, tableId: DOCS_TABLE }),
      exec('aitable.records.query', {
        baseId: DOCS_BASE,
        cursor: DOCS_CURSOR,
        limit: 50,
        query: '甲',
        tableId: DOCS_TABLE,
      }),
    ],
  },
  {
    apiName: 'appendDoc',
    args: { markdown: '补充一行', nodeId: DOCS_NODE },
    calls: [exec('doc.append', { markdown: '补充一行', nodeId: DOCS_NODE })],
  },
  {
    apiName: 'createDoc',
    args: { markdown: '正文', title: '新周报' },
    calls: [exec('doc.create', { markdown: '正文', title: '新周报' })],
  },
  {
    apiName: 'createDoc',
    args: { folderId: DOCS_FOLDER, markdown: '', title: '空文档' },
    calls: [exec('doc.create', { folderId: DOCS_FOLDER, markdown: '', title: '空文档' })],
  },
  {
    apiName: 'appendSheetRows',
    args: {
      nodeId: DOCS_NODE,
      rows: [
        ['张三', 1],
        ['李四', 2],
      ],
      sheetId: DOCS_SHEET,
    },
    calls: [
      exec('sheet.append', {
        nodeId: DOCS_NODE,
        sheetId: DOCS_SHEET,
        values: [
          ['张三', 1],
          ['李四', 2],
        ],
      }),
    ],
  },
  {
    apiName: 'createAitableRecords',
    args: {
      baseId: DOCS_BASE,
      records: [{ cells: { BGV86kr: '甲', buxAQKc: true } }],
      tableId: DOCS_TABLE,
    },
    calls: [
      exec('aitable.records.create', {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: '甲', buxAQKc: true } }],
        tableId: DOCS_TABLE,
      }),
    ],
  },
  {
    apiName: 'updateAitableRecords',
    args: {
      baseId: DOCS_BASE,
      records: [{ cells: { BGV86kr: '乙' }, recordId: '4vNpqOwrec' }],
      tableId: DOCS_TABLE,
    },
    calls: [
      exec('aitable.records.update', {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: '乙' }, recordId: '4vNpqOwrec' }],
        tableId: DOCS_TABLE,
      }),
    ],
  },
];

/** Preview-only broker call. Not one of the 18 model APIs. */
export const DOCS_PREVIEW_CALLS: DocsExecCall[] = [exec('doc.info', { nodeId: DOCS_NODE })];

export type DocsServerSchema =
  'appendDoc' | 'appendSheetRows' | 'createAitableRecords' | 'createDoc' | 'updateAitableRecords';

/**
 * Inputs the server zod schemas and the sidecar `prepareExec` must accept or
 * reject together: markdown `@` / `-` / controls, cell controls, empty cells.
 */
export interface DocsContentParityCase {
  accept: boolean;
  label: string;
  /** Fragment of the Chinese server message. Set only when `accept` is false. */
  message?: string;
  server: { args: Record<string, unknown>; schema: DocsServerSchema };
  sidecar: { args: Record<string, unknown>; op: string };
}

const NUL = '\u0000';

export const DOCS_CONTENT_PARITY: DocsContentParityCase[] = [
  {
    accept: false,
    label: 'append markdown starts with @',
    message: '正文不能以 @ 开头',
    server: { args: { markdown: '@secret.md', nodeId: DOCS_NODE }, schema: 'appendDoc' },
    sidecar: { args: { markdown: '@secret.md', nodeId: DOCS_NODE }, op: 'doc.append' },
  },
  {
    accept: false,
    label: 'create markdown starts with @',
    message: '正文不能以 @ 开头',
    server: { args: { markdown: '@secret.md', title: '标题' }, schema: 'createDoc' },
    sidecar: { args: { markdown: '@secret.md', title: '标题' }, op: 'doc.create' },
  },
  {
    accept: false,
    label: 'append markdown is exactly -',
    message: '正文不能是「-」',
    server: { args: { markdown: '-', nodeId: DOCS_NODE }, schema: 'appendDoc' },
    sidecar: { args: { markdown: '-', nodeId: DOCS_NODE }, op: 'doc.append' },
  },
  {
    accept: false,
    label: 'create markdown is exactly -',
    message: '正文不能是「-」',
    server: { args: { markdown: '-', title: '标题' }, schema: 'createDoc' },
    sidecar: { args: { markdown: '-', title: '标题' }, op: 'doc.create' },
  },
  {
    accept: false,
    label: 'append markdown contains a control character',
    message: '正文包含无法使用的字符',
    server: { args: { markdown: `正文${NUL}`, nodeId: DOCS_NODE }, schema: 'appendDoc' },
    sidecar: { args: { markdown: `正文${NUL}`, nodeId: DOCS_NODE }, op: 'doc.append' },
  },
  {
    accept: false,
    label: 'sheet cell contains a control character',
    message: '单元格包含无法使用的字符',
    server: {
      args: { nodeId: DOCS_NODE, rows: [[`甲${NUL}`]], sheetId: DOCS_SHEET },
      schema: 'appendSheetRows',
    },
    sidecar: {
      args: { nodeId: DOCS_NODE, sheetId: DOCS_SHEET, values: [[`甲${NUL}`]] },
      op: 'sheet.append',
    },
  },
  {
    accept: false,
    label: 'aitable create cell contains a control character',
    message: '单元格包含无法使用的字符',
    server: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: `甲${NUL}` } }],
        tableId: DOCS_TABLE,
      },
      schema: 'createAitableRecords',
    },
    sidecar: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: `甲${NUL}` } }],
        tableId: DOCS_TABLE,
      },
      op: 'aitable.records.create',
    },
  },
  {
    accept: false,
    label: 'aitable update cell contains a control character',
    message: '单元格包含无法使用的字符',
    server: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: `甲${NUL}` }, recordId: '4vNpqOwrec' }],
        tableId: DOCS_TABLE,
      },
      schema: 'updateAitableRecords',
    },
    sidecar: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: `甲${NUL}` }, recordId: '4vNpqOwrec' }],
        tableId: DOCS_TABLE,
      },
      op: 'aitable.records.update',
    },
  },
  {
    accept: false,
    label: 'aitable create cells are empty',
    message: '一条记录至少 1 个字段',
    server: {
      args: { baseId: DOCS_BASE, records: [{ cells: {} }], tableId: DOCS_TABLE },
      schema: 'createAitableRecords',
    },
    sidecar: {
      args: { baseId: DOCS_BASE, records: [{ cells: {} }], tableId: DOCS_TABLE },
      op: 'aitable.records.create',
    },
  },
  {
    accept: false,
    label: 'aitable update cells are empty',
    message: '一条记录至少 1 个字段',
    server: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: {}, recordId: '4vNpqOwrec' }],
        tableId: DOCS_TABLE,
      },
      schema: 'updateAitableRecords',
    },
    sidecar: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: {}, recordId: '4vNpqOwrec' }],
        tableId: DOCS_TABLE,
      },
      op: 'aitable.records.update',
    },
  },
  {
    accept: true,
    label: 'append markdown may mention @ after the first character',
    server: { args: { markdown: '见 @张三', nodeId: DOCS_NODE }, schema: 'appendDoc' },
    sidecar: { args: { markdown: '见 @张三', nodeId: DOCS_NODE }, op: 'doc.append' },
  },
  {
    accept: true,
    label: 'a leading space is not an @ file reference',
    server: { args: { markdown: ' @file', nodeId: DOCS_NODE }, schema: 'appendDoc' },
    sidecar: { args: { markdown: ' @file', nodeId: DOCS_NODE }, op: 'doc.append' },
  },
  {
    accept: true,
    label: 'create markdown may be --',
    server: { args: { markdown: '--', title: '标题' }, schema: 'createDoc' },
    sidecar: { args: { markdown: '--', title: '标题' }, op: 'doc.create' },
  },
  {
    accept: true,
    label: 'create markdown may be a dash plus more text',
    server: { args: { markdown: '- ', title: '标题' }, schema: 'createDoc' },
    sidecar: { args: { markdown: '- ', title: '标题' }, op: 'doc.create' },
  },
  {
    accept: true,
    label: 'create markdown may be empty',
    server: { args: { markdown: '', title: '标题' }, schema: 'createDoc' },
    sidecar: { args: { markdown: '', title: '标题' }, op: 'doc.create' },
  },
  {
    accept: true,
    label: 'append markdown may contain tab and newline',
    server: { args: { markdown: '第一行\n\t第二行', nodeId: DOCS_NODE }, schema: 'appendDoc' },
    sidecar: { args: { markdown: '第一行\n\t第二行', nodeId: DOCS_NODE }, op: 'doc.append' },
  },
  {
    accept: true,
    label: 'sheet cell may contain a newline',
    server: {
      args: { nodeId: DOCS_NODE, rows: [['a\nb']], sheetId: DOCS_SHEET },
      schema: 'appendSheetRows',
    },
    sidecar: {
      args: { nodeId: DOCS_NODE, sheetId: DOCS_SHEET, values: [['a\nb']] },
      op: 'sheet.append',
    },
  },
  {
    accept: true,
    label: 'aitable record with one cell',
    server: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: '甲' } }],
        tableId: DOCS_TABLE,
      },
      schema: 'createAitableRecords',
    },
    sidecar: {
      args: {
        baseId: DOCS_BASE,
        records: [{ cells: { BGV86kr: '甲' } }],
        tableId: DOCS_TABLE,
      },
      op: 'aitable.records.create',
    },
  },
];
