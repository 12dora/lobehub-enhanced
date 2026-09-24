// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkPersonalError } from '@/server/enterprise/services/dingtalkPersonal/errors';

const exec = vi.hoisted(() => vi.fn());
const downloadOp = vi.hoisted(() => vi.fn());
const settle = vi.hoisted(() => vi.fn());
const ingest = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());

vi.mock('@/server/enterprise/services/dingtalkPersonal/service', () => ({
  DingtalkPersonalService: class {
    exec = exec;
    downloadOp = downloadOp;
  },
}));

vi.mock('@/server/enterprise/services/dingtalkPersonal/tool', () => ({
  buildModelContent: (state: unknown) => JSON.stringify(state),
  settleDingtalkPersonalToolError: settle,
}));

vi.mock('@/server/enterprise/services/dingtalkPersonal/fileIngest', () => ({
  ingestDingtalkPersonalFile: ingest,
}));

vi.mock('@/server/enterprise/services/dingtalkPersonal/audit', () => ({
  appendDingtalkPersonalAudit: (...args: unknown[]) => audit(...args),
}));

const { appendSheetRowsSchema, parseDocsArgs } = await import('./args');
const { previewDingtalkDocsWrite, runDingtalkDocsTool } = await import('./tool');

const db = { tag: 'db' } as never;
const NODE = '14lgw90DnodeDocument0000000001';
const SHEET = 'st-4278sheet01';
const BASE = 'YndMjz5aAbase00000000000000001';
const TABLE = 'knhttimpzdr31aq2r3ykq';

const run = (
  apiName: Parameters<typeof runDingtalkDocsTool>[2],
  args: Record<string, unknown> = {},
) => runDingtalkDocsTool(db, 'user-1', apiName, args, { workspaceId: 'ws-1' });

beforeEach(() => {
  exec.mockReset();
  downloadOp.mockReset();
  settle.mockReset();
  ingest.mockReset();
  audit.mockReset();
  settle.mockResolvedValue({ content: 'settled', success: false });
  audit.mockResolvedValue(undefined);
});

describe('runDingtalkDocsTool', () => {
  it('searches docs with the default limit and projects the sample shape', async () => {
    exec.mockResolvedValueOnce({
      documents: [
        { docType: 'alidoc', name: '周报', nodeId: NODE, url: 'https://example.invalid/d' },
      ],
      hasMore: false,
    });
    const result = await run('searchDocs', { query: '周报' });
    expect(exec).toHaveBeenCalledWith('doc.search', { limit: 5, query: '周报' });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      items: [{ name: '周报', nodeId: NODE }],
      kind: 'docs',
    });
  });

  it('returns the admin-disabled sentence for a docs, sheets, or write switch', async () => {
    exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature: 'docs' }),
    );
    const docs = await run('searchDocs', { query: '周报' });
    expect(docs.success).toBe(false);
    expect(docs.content).toContain('管理员未开启「文档 / 钉盘 / 知识库」');
    expect(docs.content).toContain('DINGTALK_PERSONAL_FEATURE_DISABLED');
    expect(docs.content).toContain('管理员入口');

    exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature: 'sheets' }),
    );
    const sheets = await run('listSheets', { nodeId: NODE });
    expect(sheets.content).toContain('管理员未开启「在线表格 / AI 表格」');

    exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature: 'write' }),
    );
    const write = await run('appendDoc', { markdown: '补充', nodeId: NODE });
    expect(write.content).toContain('管理员未开启「写操作」');
    expect(settle).not.toHaveBeenCalled();
  });

  it('delegates unauthorized, org-policy, and PAT errors to the personal helper', async () => {
    exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED'));
    await run('readDoc', { nodeId: NODE });
    exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_ORG_POLICY_DENIED'));
    await run('readDoc', { nodeId: NODE });
    exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_PAT_REQUIRED', {
        uri: 'https://open.dingtalk.com/dev/cli',
      }),
    );
    await run('readDoc', { nodeId: NODE });
    expect(settle).toHaveBeenCalledTimes(3);
    expect(settle.mock.calls[1][0]).toMatchObject({ code: 'DINGTALK_PERSONAL_ORG_POLICY_DENIED' });
    expect(settle.mock.calls[2][0].details.uri).toBe('https://open.dingtalk.com/dev/cli');
    expect(settle.mock.calls[0][1]).toMatchObject({
      apiName: 'readDoc',
      userId: 'user-1',
      write: false,
    });
  });

  it('rewrites an axls or alidoc download failure before the personal helper sees it', async () => {
    downloadOp.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_UPSTREAM', {
        message:
          'nodeId 指向的节点是钉钉表格（extension=axls），在线表格不支持直接下载。请使用 getRange 工具获取表格数据。',
      }),
    );
    await run('downloadDriveFile', { nodeId: NODE });
    expect(settle.mock.calls[0][0].code).toBe('DINGTALK_PERSONAL_INVALID_ARGS');
    expect(settle.mock.calls[0][0].details.message).toContain('readSheet');

    downloadOp.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_UPSTREAM', {
        message: 'nodeId 指向的节点是钉钉文档（extension=alidoc），不支持直接下载。',
      }),
    );
    await run('downloadDriveFile', { nodeId: NODE });
    expect(settle.mock.calls[1][0].details.message).toContain('readDoc');

    downloadOp.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
        message:
          '该节点是在线表格或在线文档，不能直接下载。在线表格请用 readSheet，在线文档请用 readDoc。',
      }),
    );
    await run('downloadDriveFile', { nodeId: NODE });
    expect(settle.mock.calls[2][0].details.message).toContain('readSheet');
    expect(settle.mock.calls[2][0].details.message).toContain('readDoc');
    expect(settle.mock.calls[2][0].details.message).toContain('DINGTALK_PERSONAL_INVALID_ARGS');
  });

  it('ingests a drive download and caps the model text at 100000 characters', async () => {
    downloadOp.mockResolvedValueOnce({
      buffer: Buffer.from('abc'),
      name: '报价.xlsx',
      sizeBytes: 13218,
    });
    ingest.mockResolvedValueOnce({
      fileId: 'file-1',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: '报价.xlsx',
      parseable: true,
      parseFailed: false,
      sizeBytes: 13218,
      text: '格'.repeat(100_010),
      url: 'https://example.invalid/file',
    });
    const result = await run('downloadDriveFile', { nodeId: NODE });
    expect(downloadOp).toHaveBeenCalledWith('drive.download', { nodeId: NODE });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ name: '报价.xlsx', userId: 'user-1', workspaceId: 'ws-1' }),
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain('已下载钉盘文件');
    expect(result.content).toContain('仅保留前 100000 字');
    expect(String(result.content).length).toBeLessThan(100_200);
    expect(result.state).toMatchObject({
      kind: 'file',
      name: '报价.xlsx',
      preview: '格'.repeat(2000),
    });
  });

  it('reads the used range when range is omitted and says that it was clipped', async () => {
    exec.mockResolvedValueOnce({
      name: '库存',
      nonEmptyRange: { lastColumn: 'AO', lastRow: 14, range: 'A1:AO14' },
    });
    exec.mockResolvedValueOnce({
      data: {
        cells: [[{ value: '品名' }, { value: '数量' }]],
        complete: true,
        hasMore: false,
        truncationReasons: [],
      },
    });
    const result = await run('readSheet', { nodeId: NODE, sheetId: SHEET });
    expect(exec).toHaveBeenNthCalledWith(1, 'sheet.info', { nodeId: NODE, sheetId: SHEET });
    expect(exec).toHaveBeenNthCalledWith(2, 'sheet.read', {
      nodeId: NODE,
      range: 'A1:AD14',
      sheetId: SHEET,
    });
    expect(result.content).toContain('已改为读取 A1:AD14');
    expect(result.content).toContain('继续读取请用 range=AE1:AO14');
    expect(result.state).toMatchObject({
      kind: 'sheetRange',
      range: 'A1:AD14',
      rows: [['品名', '数量']],
    });
  });

  it('asks sheet info for at most 10 sheets', async () => {
    const sheets = Array.from({ length: 12 }, (_, index) => ({
      sheetId: `st-sheet${index}`,
      title: `表${index}`,
    }));
    exec.mockImplementation(async (op: string) => {
      if (op === 'sheet.info') {
        return { columnCount: 2, name: '表', nonEmptyRange: { range: 'A1:B2' }, rowCount: 2 };
      }
      return { data: { sheets } };
    });
    const result = await run('listSheets', { nodeId: NODE });
    const infoCalls = exec.mock.calls.filter((call) => call[0] === 'sheet.info');
    expect(infoCalls).toHaveLength(10);
    expect(result.content).toContain('仅读取了前 10 个');
    expect(result.state).toMatchObject({ kind: 'sheets', nodeId: NODE });
  });

  it('rejects a formula cell and sends every row in one append', async () => {
    let thrown: unknown;
    try {
      parseDocsArgs(appendSheetRowsSchema, { nodeId: NODE, rows: [['=SUM(A1)']], sheetId: SHEET });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'DINGTALK_PERSONAL_INVALID_ARGS',
      details: { message: expect.stringMatching(/不能以 =/) },
    });
    await expect(
      run('appendSheetRows', { nodeId: NODE, rows: [['=SUM(A1)']], sheetId: SHEET }),
    ).resolves.toMatchObject({ success: false });
    expect(settle).toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();

    settle.mockClear();
    exec.mockResolvedValueOnce({ url: 'https://example.invalid/sheet' });
    const result = await run('appendSheetRows', {
      nodeId: NODE,
      rows: [
        ['张三', '销售', 1],
        ['李四', '市场', 2],
      ],
      sheetId: SHEET,
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('sheet.append', {
      nodeId: NODE,
      sheetId: SHEET,
      values: [
        ['张三', '销售', 1],
        ['李四', '市场', 2],
      ],
    });
    expect(result).toMatchObject({
      content: '已追加 2 行',
      state: {
        action: 'appendSheetRows',
        count: 2,
        kind: 'write',
        url: 'https://example.invalid/sheet',
      },
      success: true,
    });
    expect(settle).not.toHaveBeenCalled();
  });

  it('creates aitable records in one non-retried call', async () => {
    exec.mockResolvedValueOnce({ success: true });
    const result = await run('createAitableRecords', {
      baseId: BASE,
      records: [{ cells: { BGV86kr: '甲', buxAQKc: true } }],
      tableId: TABLE,
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('aitable.records.create', {
      baseId: BASE,
      records: [{ cells: { BGV86kr: '甲', buxAQKc: true } }],
      tableId: TABLE,
    });
    expect(result.state).toMatchObject({ action: 'createAitableRecords', count: 1, kind: 'write' });
  });

  it('passes a wiki cursor through and maps my-space to myWikiSpace', async () => {
    exec.mockResolvedValue({ data: { nodes: [], hasMore: false } });
    await run('listWikiNodes', { cursor: 'pos:-1.2713976E7', workspaceId: 'e3RmXaPworkspace1' });
    expect(exec).toHaveBeenCalledWith('wiki.nodes', {
      cursor: 'pos:-1.2713976E7',
      limit: 20,
      workspaceId: 'e3RmXaPworkspace1',
    });
    exec.mockClear();
    exec.mockResolvedValueOnce({ data: { spaces: [] } });
    await run('listWikiSpaces', { scope: 'my' });
    expect(exec).toHaveBeenCalledWith('wiki.spaces', { type: 'myWikiSpace' });
  });

  it('audits a successful write and omits markdown and cell values', async () => {
    const secret = '机密正文不要进审计';
    exec.mockResolvedValue({ url: 'https://example.invalid/doc' });
    const appended = await run('appendDoc', { markdown: secret, nodeId: NODE });
    expect(appended.success).toBe(true);
    expect(audit).toHaveBeenCalledWith(db, 'user-1', 'doc.append', {
      afterDiff: { nodeId: NODE },
      result: 'success',
      targetId: NODE,
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain(secret);

    audit.mockClear();
    exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_UPSTREAM', { message: 'bad' }),
    );
    await run('createDoc', { markdown: secret, title: '新文档' });
    expect(audit).not.toHaveBeenCalled();

    audit.mockRejectedValueOnce(new Error('audit down'));
    exec.mockResolvedValueOnce({});
    const created = await run('createDoc', { folderId: 'fld1', markdown: secret, title: '新文档' });
    expect(created.success).toBe(true);
    expect(audit).toHaveBeenCalledWith(db, 'user-1', 'doc.create', {
      afterDiff: { folderId: 'fld1', title: '新文档' },
      result: 'success',
      targetId: '新文档',
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain(secret);

    audit.mockResolvedValue(undefined);
    audit.mockClear();
    exec.mockResolvedValueOnce({});
    await run('appendSheetRows', { nodeId: NODE, rows: [['甲']], sheetId: SHEET });
    expect(audit).toHaveBeenCalledWith(
      db,
      'user-1',
      'sheet.append',
      expect.objectContaining({
        afterDiff: { count: 1, nodeId: NODE, sheetId: SHEET },
        targetId: NODE,
      }),
    );

    audit.mockClear();
    exec.mockResolvedValueOnce({});
    await run('createAitableRecords', {
      baseId: BASE,
      records: [{ cells: { BGV86kr: secret } }],
      tableId: TABLE,
    });
    expect(audit).toHaveBeenCalledWith(
      db,
      'user-1',
      'aitable.records.create',
      expect.objectContaining({
        afterDiff: { baseId: BASE, count: 1, tableId: TABLE },
        targetId: TABLE,
      }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain(secret);

    audit.mockClear();
    exec.mockResolvedValueOnce({});
    await run('updateAitableRecords', {
      baseId: BASE,
      records: [{ cells: { BGV86kr: secret }, recordId: '4vNpqOwrec' }],
      tableId: TABLE,
    });
    expect(audit).toHaveBeenCalledWith(
      db,
      'user-1',
      'aitable.records.update',
      expect.objectContaining({ targetId: TABLE }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('4vNpqOwrec');
  });

  it('clips a caller range past 200 by 30 and names the next block', async () => {
    exec.mockResolvedValueOnce({
      data: { cells: [[{ value: '品名' }]], complete: true },
    });
    const result = await run('readSheet', { nodeId: NODE, range: 'A1:AO14' });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('sheet.read', { nodeId: NODE, range: 'A1:AD14' });
    expect(result.content).toContain('继续读取请用 range=AE1:AO14');
  });

  it('uses a generic too-large sentence for docs reads', async () => {
    exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_OUTPUT_TOO_LARGE'));
    const result = await run('readDoc', { nodeId: NODE });
    expect(result.success).toBe(false);
    expect(result.content).toBe('内容过大，无法一次读取（DINGTALK_PERSONAL_OUTPUT_TOO_LARGE）。');
    expect(result.content).not.toContain('时间范围');
    expect(settle).not.toHaveBeenCalled();
  });

  it('marks a write timeout as a write when delegating', async () => {
    exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_TIMEOUT'));
    await run('createAitableRecords', {
      baseId: BASE,
      records: [{ cells: { BGV86kr: '甲' } }],
      tableId: TABLE,
    });
    expect(settle.mock.calls[0][1]).toMatchObject({ write: true, apiName: 'createAitableRecords' });
  });
});

describe('previewDingtalkDocsWrite', () => {
  it('resolves the document title and shows the first lines of markdown', async () => {
    exec.mockResolvedValueOnce({ markdown: '旧正文', title: '周报' });
    const preview = await previewDingtalkDocsWrite(db, 'user-1', 'appendDoc', {
      markdown: '第一行\n第二行',
      nodeId: NODE,
    });
    expect(exec).toHaveBeenCalledWith('doc.info', { nodeId: NODE });
    expect(preview).toEqual({
      danger: false,
      lines: ['第一行', '第二行'],
      title: '追加内容到文档「周报」',
      warnings: [],
    });
  });

  it('fails the preview when the document title cannot be resolved', async () => {
    exec.mockResolvedValueOnce({ markdown: '无标题' });
    await expect(
      previewDingtalkDocsWrite(db, 'user-1', 'appendDoc', { markdown: '补充', nodeId: NODE }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_INVALID_ARGS' });
  });

  it('previews a new document, sheet rows, and aitable records', async () => {
    const created = await previewDingtalkDocsWrite(db, 'user-1', 'createDoc', {
      markdown: '正文',
      title: '新周报',
    });
    expect(created.title).toBe('新建文档「新周报」');
    expect(created.danger).toBe(false);

    exec.mockResolvedValueOnce({ name: '库存' });
    const sheet = await previewDingtalkDocsWrite(db, 'user-1', 'appendSheetRows', {
      nodeId: NODE,
      rows: [
        ['张三', '销售'],
        ['李四', '市场'],
      ],
      sheetId: SHEET,
    });
    expect(sheet.title).toBe('向「库存」追加 2 行');
    expect(sheet.lines[0]).toBe('1. 张三 | 销售');

    exec.mockResolvedValueOnce({
      data: {
        tables: [
          {
            fields: [{ fieldId: 'BGV86kr', fieldName: '负责人', type: 'text' }],
            tableId: TABLE,
            tableName: '客户表',
          },
        ],
      },
    });
    const createdRows = await previewDingtalkDocsWrite(db, 'user-1', 'createAitableRecords', {
      baseId: BASE,
      records: [{ cells: { BGV86kr: '甲' } }],
      tableId: TABLE,
    });
    expect(createdRows).toMatchObject({
      danger: false,
      lines: ['1. 负责人：甲'],
      title: '向「客户表」新增 1 条记录',
    });

    exec.mockResolvedValueOnce({
      data: {
        tables: [
          {
            fields: [{ fieldId: 'BGV86kr', fieldName: '负责人', type: 'text' }],
            tableId: TABLE,
            tableName: '客户表',
          },
        ],
      },
    });
    const updated = await previewDingtalkDocsWrite(db, 'user-1', 'updateAitableRecords', {
      baseId: BASE,
      records: [{ cells: { BGV86kr: '乙' }, recordId: '4vNpqOwrec' }],
      tableId: TABLE,
    });
    expect(updated.danger).toBe(false);
    expect(updated.title).toBe('修改「客户表」中的 1 条记录');
    expect(updated.lines[0]).toContain('4vNpqOwrec');
    expect(updated.lines[0]).toContain('负责人：乙');
  });

  it('fails the preview when a field id is not in the schema', async () => {
    exec.mockResolvedValueOnce({
      data: {
        tables: [{ fields: [], tableId: TABLE, tableName: '客户表' }],
      },
    });
    await expect(
      previewDingtalkDocsWrite(db, 'user-1', 'createAitableRecords', {
        baseId: BASE,
        records: [{ cells: { BGV86kr: '甲' } }],
        tableId: TABLE,
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_INVALID_ARGS' });
  });

  it('says how many preview lines were hidden and checks every record field id', async () => {
    exec.mockResolvedValueOnce({ name: '周报' });
    const doc = await previewDingtalkDocsWrite(db, 'user-1', 'appendDoc', {
      markdown: Array.from({ length: 12 }, (_, index) => `行${index + 1}`).join('\n'),
      nodeId: NODE,
    });
    expect(doc.lines).toHaveLength(11);
    expect(doc.lines[10]).toBe('另有 2 行未显示');
    expect(doc.lines[0]).toBe('行1');

    exec.mockResolvedValueOnce({ name: '库存' });
    const sheet = await previewDingtalkDocsWrite(db, 'user-1', 'appendSheetRows', {
      nodeId: NODE,
      rows: Array.from({ length: 6 }, (_, index) => [`行${index + 1}`]),
      sheetId: SHEET,
    });
    expect(sheet.lines[5]).toBe('另有 1 行未显示');

    exec.mockResolvedValueOnce({
      data: {
        tables: [
          {
            fields: [{ fieldId: 'BGV86kr', fieldName: '负责人', type: 'text' }],
            tableId: TABLE,
            tableName: '客户表',
          },
        ],
      },
    });
    await expect(
      previewDingtalkDocsWrite(db, 'user-1', 'createAitableRecords', {
        baseId: BASE,
        records: [
          ...Array.from({ length: 5 }, () => ({ cells: { BGV86kr: '甲' } })),
          { cells: { missingField: '乙' } },
        ],
        tableId: TABLE,
      }),
    ).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_INVALID_ARGS',
      details: { message: expect.stringContaining('missingField') },
    });
  });

  it('rejects a write whose JSON exceeds about 56 KB before calling the broker', async () => {
    await expect(
      previewDingtalkDocsWrite(db, 'user-1', 'appendDoc', {
        markdown: '文'.repeat(20_000),
        nodeId: NODE,
      }),
    ).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_INVALID_ARGS',
      details: { message: expect.stringMatching(/内容过大（约 \d+ KB）/) },
    });
    expect(exec).not.toHaveBeenCalled();

    const ascii = await previewDingtalkDocsWrite(db, 'user-1', 'createDoc', {
      markdown: 'a'.repeat(20_000),
      title: '短文档',
    });
    expect(ascii.title).toBe('新建文档「短文档」');
  });
});
