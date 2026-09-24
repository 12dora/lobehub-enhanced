import { describe, expect, it } from 'vitest';

import { describeDocsCall } from './describe';

const P = 'builtins.lobe-dingtalk-docs';

describe('describeDocsCall', () => {
  it('is undefined for an API outside the toolset', () => {
    expect(describeDocsCall('listMyTodos', { query: '周报' })).toBeUndefined();
    expect(describeDocsCall('')).toBeUndefined();
  });

  it('names the search keyword', () => {
    expect(describeDocsCall('searchDocs', { query: '周报' })).toEqual({
      key: `${P}.inspector.searchDocs`,
      params: { query: '周报' },
    });
    expect(describeDocsCall('searchDrive', { query: ' 库存   日报 ' })).toEqual({
      key: `${P}.inspector.searchDrive`,
      params: { query: '库存 日报' },
    });
    expect(describeDocsCall('searchAitableBases', { query: '客户' })).toEqual({
      key: `${P}.inspector.searchAitableBases`,
      params: { query: '客户' },
    });
    expect(describeDocsCall('queryAitableRecords', { baseId: 'b', query: '张三' })).toEqual({
      key: `${P}.inspector.queryAitableRecords`,
      params: { query: '张三' },
    });
  });

  it('falls back to the action name until a detail is known', () => {
    for (const apiName of ['searchDocs', 'readDoc', 'readSheet', 'createDoc', 'appendSheetRows']) {
      expect(describeDocsCall(apiName, {})).toEqual({ key: `${P}.apiName.${apiName}` });
    }
    expect(describeDocsCall('searchAitableBases', {})).toEqual({
      key: `${P}.apiName.searchAitableBases`,
    });
  });

  it('reads the streaming arguments while the final ones are still empty', () => {
    expect(describeDocsCall('searchDocs', {}, { query: '周' })).toEqual({
      key: `${P}.inspector.searchDocs`,
      params: { query: '周' },
    });
    expect(describeDocsCall('readSheet', undefined, { nodeId: 'n', range: 'A1:F20' })).toEqual({
      key: `${P}.inspector.readSheet`,
      params: { range: 'A1:F20' },
    });
    // The final arguments win over what streamed before.
    expect(describeDocsCall('searchDocs', { query: '周报' }, { query: '周' })?.params).toEqual({
      query: '周报',
    });
  });

  it('counts the rows and records of a write, never showing their content', () => {
    const rows = [
      ['张三', '销售部', 50_000],
      ['李四', '市场部', 42_000],
    ];
    expect(describeDocsCall('appendSheetRows', { nodeId: 'n', rows, sheetId: 's' })).toEqual({
      key: `${P}.inspector.appendSheetRows`,
      params: { count: 2 },
    });

    const records = [{ cells: { fld1: '样品 A' } }, { cells: { fld1: '样品 B' } }, { cells: {} }];
    const args = { baseId: 'b', records, tableId: 't' };
    expect(describeDocsCall('createAitableRecords', args)).toEqual({
      key: `${P}.inspector.createAitableRecords`,
      params: { count: 3 },
    });
    expect(
      describeDocsCall('updateAitableRecords', {
        records: [{ cells: { fld1: '改' }, recordId: 'rec1' }],
      }),
    ).toEqual({ key: `${P}.inspector.updateAitableRecords`, params: { count: 1 } });
  });

  it('counts a batch while it streams and skips junk items', () => {
    const streamingRows = { rows: [['a'], ['b'], 'oops', null] };
    expect(describeDocsCall('appendSheetRows', {}, streamingRows)).toEqual({
      key: `${P}.inspector.appendSheetRows`,
      params: { count: 2 },
    });
    expect(describeDocsCall('createAitableRecords', {}, { records: [{}, 3, 'x'] })).toEqual({
      key: `${P}.inspector.createAitableRecords`,
      params: { count: 1 },
    });
    expect(describeDocsCall('createAitableRecords', {}, { records: [] })).toEqual({
      key: `${P}.apiName.createAitableRecords`,
    });
    expect(describeDocsCall('appendSheetRows', { rows: 'A1' })).toEqual({
      key: `${P}.apiName.appendSheetRows`,
    });
  });

  it('names the new document by its title', () => {
    expect(describeDocsCall('createDoc', { markdown: '# 周报', title: '9 月周报' })).toEqual({
      key: `${P}.inspector.createDoc`,
      params: { title: '9 月周报' },
    });
  });

  it('picks up the resolved name from the result', () => {
    expect(
      describeDocsCall('readDoc', { nodeId: 'n1' }, undefined, {
        kind: 'doc',
        length: 10,
        nodeId: 'n1',
        preview: '…',
        title: '销售周报',
      }),
    ).toEqual({ key: `${P}.inspector.readDoc`, params: { title: '销售周报' } });

    // readSheet without a range: the server read the used range and the result says which.
    expect(
      describeDocsCall('readSheet', { nodeId: 'n1' }, undefined, {
        kind: 'sheetRange',
        range: 'A1:AO14',
        rows: [],
        truncated: false,
      }),
    ).toEqual({ key: `${P}.inspector.readSheet`, params: { range: 'A1:AO14' } });

    expect(
      describeDocsCall('downloadDriveFile', { nodeId: 'n1' }, undefined, {
        kind: 'file',
        name: '库存.xlsx',
        sizeBytes: 1,
      }),
    ).toEqual({ key: `${P}.inspector.downloadDriveFile`, params: { name: '库存.xlsx' } });

    expect(
      describeDocsCall('getAitableSchema', { baseId: 'b', tableId: 't' }, undefined, {
        fields: [],
        kind: 'aitableSchema',
        tableName: '客户表',
      }),
    ).toEqual({ key: `${P}.inspector.getAitableSchema`, params: { name: '客户表' } });
  });

  it('ignores a result of another kind', () => {
    expect(
      describeDocsCall('readDoc', { nodeId: 'n1' }, undefined, {
        code: 'DINGTALK_PERSONAL_UNAUTHORIZED',
        kind: 'authorizationRequired',
      }),
    ).toEqual({ key: `${P}.apiName.readDoc` });
  });

  it('never surfaces ids', () => {
    const summary = describeDocsCall('readDoc', { nodeId: '14lgGw3P8vv9PgIJXYZ90D' });

    expect(JSON.stringify(summary)).not.toContain('14lg');
  });

  it('says which knowledge bases are listed', () => {
    expect(describeDocsCall('listWikiSpaces', { scope: 'my' })).toEqual({
      key: `${P}.inspector.listMyWikiSpaces`,
    });
    expect(describeDocsCall('listWikiSpaces', { scope: 'org' })).toEqual({
      key: `${P}.inspector.listOrgWikiSpaces`,
    });
    expect(describeDocsCall('listWikiSpaces', {})).toEqual({
      key: `${P}.apiName.listWikiSpaces`,
    });
  });

  it('marks a listing that continues from a cursor', () => {
    const nextNodes = { cursor: 'pos:-1.2713976E7', workspaceId: 'w' };
    expect(describeDocsCall('listWikiNodes', nextNodes)).toEqual({
      key: `${P}.apiName.listWikiNodes`,
      nextPage: true,
    });
    expect(describeDocsCall('listDrive', {})).toEqual({ key: `${P}.apiName.listDrive` });
    expect(
      describeDocsCall('queryAitableRecords', { baseId: 'b', cursor: 'c1', query: '张三' }),
    ).toEqual({
      key: `${P}.inspector.queryAitableRecords`,
      nextPage: true,
      params: { query: '张三' },
    });
  });

  it('truncates a long detail', () => {
    const summary = describeDocsCall('searchDocs', { query: '周'.repeat(60) });

    expect(summary?.params?.query).toHaveLength(41);
    expect(String(summary?.params?.query).endsWith('…')).toBe(true);
  });
});
