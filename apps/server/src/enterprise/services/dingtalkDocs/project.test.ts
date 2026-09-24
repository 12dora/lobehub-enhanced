// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  aitableCellText,
  projectAitableRecords,
  projectAitableSchema,
  projectDoc,
  projectDocs,
  projectDriveFiles,
  projectSheetRange,
  projectWikiNodes,
  projectWikiSpaces,
  readCreatedCount,
  readResultUrl,
  trimSheetGrid,
} from './project';

const NODE = '14lgw90DnodeDocument0000000001';
const NODE_FILE = 'NkDwZBYnodeFile00000000000001';
const WS = 'e3RmXaPworkspace1';

describe('dingtalk docs projections', () => {
  it('projects a doc search payload and drops a null modified time', () => {
    const state = projectDocs({
      count: 1,
      documents: [
        {
          docType: 'xlsx',
          modifiedTime: null,
          name: '周报',
          nodeId: NODE,
          url: 'https://example.invalid/doc',
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-1',
    });
    expect(state).toEqual({
      hasMore: true,
      items: [{ docType: 'xlsx', name: '周报', nodeId: NODE, url: 'https://example.invalid/doc' }],
      kind: 'docs',
    });
  });

  it('caps doc markdown at 100000 characters and keeps a 2000 character preview', () => {
    const markdown = `标题行\n${'正'.repeat(100_050)}`;
    const projected = projectDoc({ markdown, nodeId: NODE, success: true, title: '周报' }, NODE);
    expect(projected.state.kind).toBe('doc');
    expect(projected.state.length).toBe(markdown.length);
    expect(projected.state.preview).toHaveLength(2000);
    expect(projected.state.title).toBe('周报');
    expect(projected.content).toContain('仅保留前 100000 字');
    expect(projected.content.length).toBeLessThan(markdown.length);
  });

  it('projects wiki spaces and nodes, including a scientific-notation cursor', () => {
    expect(
      projectWikiSpaces({
        data: {
          spaces: [
            {
              description: '制度',
              name: '公司知识库',
              url: 'https://example.invalid/wiki',
              workspaceId: WS,
            },
            { description: '', name: '空描述', workspaceId: 'e3RmmaPworkspace1' },
          ],
        },
        ok: true,
      }).spaces,
    ).toEqual([
      {
        description: '制度',
        name: '公司知识库',
        url: 'https://example.invalid/wiki',
        workspaceId: WS,
      },
      { name: '空描述', workspaceId: 'e3RmmaPworkspace1' },
    ]);

    const nodes = projectWikiNodes(
      {
        data: {
          hasMore: true,
          nextCursor: 'pos:-1.2713976E7',
          nodes: [
            {
              extension: 'axls',
              hasChildren: false,
              name: '库存表',
              nodeId: NODE,
              type: 'file',
              url: 'https://example.invalid/node',
            },
          ],
        },
      },
      WS,
    );
    expect(nodes.nextCursor).toBe('pos:-1.2713976E7');
    expect(nodes.nodes[0]).toMatchObject({ extension: 'axls', hasChildren: false, type: 'file' });
  });

  it('projects drive files from the wrapped data object', () => {
    const state = projectDriveFiles({
      data: {
        files: [
          { fileSize: 13218, name: '报价.xlsx', nodeId: NODE_FILE, type: 'FILE' },
          { name: '目录', nodeId: NODE, type: 'FOLDER' },
        ],
        hasMore: true,
        nextCursor: '179200',
      },
      ok: true,
    });
    expect(state.files[0]).toEqual({
      fileSize: 13218,
      name: '报价.xlsx',
      nodeId: NODE_FILE,
      type: 'FILE',
    });
    expect(state.files[1].fileSize).toBeUndefined();
    expect(state.nextCursor).toBe('179200');
  });

  it('trims trailing empty rows and columns and renders a markdown table', () => {
    const rows = trimSheetGrid([
      ['姓名', '部门', ''],
      ['张三', '销售', ''],
      ['', '', ''],
    ]);
    expect(rows).toEqual([
      ['姓名', '部门'],
      ['张三', '销售'],
    ]);
    const projected = projectSheetRange(
      {
        data: {
          cells: [
            [{ value: '姓名' }, { value: '部门' }, { value: '' }],
            [{ value: '张三' }, { value: '销售' }, { value: '' }],
            [{ value: '' }, { value: '' }, { value: '' }],
          ],
          complete: true,
          hasMore: false,
          truncationReasons: [],
        },
      },
      { nodeId: NODE, range: 'A1:C3', sheetId: 'Sheet1' },
    );
    expect(projected.state.rows).toEqual(rows);
    expect(projected.state.truncated).toBe(false);
    expect(projected.markdown).toBe('| A | B |\n| --- | --- |\n| 姓名 | 部门 |\n| 张三 | 销售 |');
  });

  it('marks an incomplete sheet read as truncated', () => {
    const projected = projectSheetRange(
      {
        data: {
          cells: [[{ value: '仅此' }]],
          complete: false,
          hasMore: true,
          truncationReasons: ['max'],
        },
      },
      { nodeId: NODE, range: 'A1' },
    );
    expect(projected.state.truncated).toBe(true);
    expect(projected.markdown).toContain('不完整');
  });

  it('maps aitable cells onto field names', () => {
    const schema = projectAitableSchema(
      {
        data: {
          tables: [
            {
              fields: [
                { fieldId: 'BGV86kr', fieldName: '负责人', type: 'text' },
                { fieldId: 'buxAQKc', fieldName: '备注', type: 'text' },
              ],
              tableId: 'knhttimpzdr31aq2r3ykq',
              tableName: '客户表',
            },
          ],
        },
        success: true,
      },
      { baseId: 'YndMjz5aAbase00000000000000001', tableId: 'knhttimpzdr31aq2r3ykq' },
    );
    expect(schema.tableName).toBe('客户表');
    expect(schema.fields[0]).toEqual({ fieldId: 'BGV86kr', name: '负责人', type: 'text' });

    expect(aitableCellText({ id: 'bsuu7IP', name: '甲' })).toBe('甲');
    expect(aitableCellText(['甲', { text: '乙' }])).toBe('甲、乙');
    expect(aitableCellText(true)).toBe('是');

    const projected = projectAitableRecords(
      {
        data: {
          nextCursor: '9NCp0E6cur',
          records: [
            {
              cells: { BGV86kr: { id: 'bsuu7IP', name: '甲' }, buxAQKc: '跟进中' },
              recordId: '4vNpqOwrec',
            },
          ],
        },
        success: true,
      },
      schema,
    );
    expect(projected.state.hasMore).toBe(true);
    expect(projected.state.nextCursor).toBe('9NCp0E6cur');
    expect(projected.state.records).toEqual([
      { cells: { 负责人: '甲', 备注: '跟进中' }, recordId: '4vNpqOwrec' },
    ]);
    expect(projected.unknownFieldIds).toEqual([]);
  });

  it('reads a nested doc url, then a node or base id that passes the id check', () => {
    const nested = {
      complete: true,
      contractVersion: '1',
      data: {
        nodeId: NODE,
        result: { docUrl: 'https://alidocs.dingtalk.com/i/nodes/from-result', name: '周报' },
      },
    };
    expect(readResultUrl(nested)).toBe('https://alidocs.dingtalk.com/i/nodes/from-result');
    expect(
      readResultUrl({
        data: { nodeId: NODE, result: { url: 'https://alidocs.dingtalk.com/i/nodes/from-url' } },
      }),
    ).toBe('https://alidocs.dingtalk.com/i/nodes/from-url');
    expect(readResultUrl({ data: { nodeId: NODE, result: { name: '周报' } } })).toBe(
      `https://alidocs.dingtalk.com/i/nodes/${NODE}`,
    );
    expect(readResultUrl({ data: { baseId: 'YndMjz5aAbase00000000000000001' } })).toBe(
      'https://alidocs.dingtalk.com/i/nodes/YndMjz5aAbase00000000000000001',
    );
    expect(readResultUrl({}, NODE)).toBe(`https://alidocs.dingtalk.com/i/nodes/${NODE}`);
    expect(readResultUrl({ data: { nodeId: 'https://evil.example/x' } }, NODE)).toBe(
      `https://alidocs.dingtalk.com/i/nodes/${NODE}`,
    );
    expect(readResultUrl({}, 'https://alidocs.dingtalk.com/i/nodes/abc')).toBeUndefined();
    expect(readResultUrl({}, 'bad id')).toBeUndefined();
    expect(readResultUrl({ url: 'javascript:alert(1)' }, NODE)).toBe(
      `https://alidocs.dingtalk.com/i/nodes/${NODE}`,
    );
  });

  it('counts created records from data.newRecordIds', () => {
    expect(readCreatedCount({ data: { newRecordIds: ['cNWjCoD8Pn', ''] } })).toBe(1);
    expect(readCreatedCount({ data: { newRecordIds: [] } })).toBe(0);
    expect(readCreatedCount({ success: true })).toBeUndefined();
  });
});
