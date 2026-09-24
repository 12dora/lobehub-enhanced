import { BuiltinToolManifestSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { DingtalkDocsManifest } from './manifest';
import { DingtalkDocsApiName, DingtalkDocsWriteApiNames } from './types';

const ALL_APIS = [
  'appendDoc',
  'appendSheetRows',
  'createAitableRecords',
  'createDoc',
  'downloadDriveFile',
  'getAitableSchema',
  'listAitableTables',
  'listDrive',
  'listSheets',
  'listWikiNodes',
  'listWikiSpaces',
  'queryAitableRecords',
  'readDoc',
  'readSheet',
  'searchAitableBases',
  'searchDocs',
  'searchDrive',
  'updateAitableRecords',
] as const;

const WRITE_APIS = [
  'appendDoc',
  'appendSheetRows',
  'createAitableRecords',
  'createDoc',
  'updateAitableRecords',
] as const;

const A1_CELL = '[A-Z]{1,3}[1-9]\\d{0,4}';

describe('DingtalkDocsManifest', () => {
  it('matches the builtin tool manifest schema', () => {
    const parsed = BuiltinToolManifestSchema.safeParse(DingtalkDocsManifest);

    expect(parsed.success).toBe(true);
  });

  it('uses the stable lobe-dingtalk-docs identifier and all 18 APIs', () => {
    expect(DingtalkDocsManifest.identifier).toBe('lobe-dingtalk-docs');
    expect(DingtalkDocsManifest.type).toBe('builtin');
    expect(DingtalkDocsManifest.meta.title).toBe('钉钉文档与表格');
    expect(DingtalkDocsManifest.meta.avatar).toBeTruthy();
    expect(DingtalkDocsManifest.meta.description).toContain('在线表格');
    expect(DingtalkDocsManifest.meta.description).toContain('AI 表格');
    expect(Object.values(DingtalkDocsApiName).slice().sort()).toEqual([...ALL_APIS].sort());
    expect(DingtalkDocsManifest.api.map((item) => item.name).sort()).toEqual([...ALL_APIS].sort());
  });

  it('sets humanIntervention always on exactly the five writes and never on reads', () => {
    const writes = DingtalkDocsManifest.api
      .filter((api) => api.humanIntervention === 'always')
      .map((api) => api.name)
      .sort();
    const reads = DingtalkDocsManifest.api
      .filter((api) => api.humanIntervention === 'never')
      .map((api) => api.name)
      .sort();

    expect(writes).toEqual([...WRITE_APIS].sort());
    expect([...DingtalkDocsWriteApiNames].sort()).toEqual([...WRITE_APIS].sort());
    const writeSet = new Set<string>(WRITE_APIS);
    expect(reads).toEqual([...ALL_APIS].filter((name) => !writeSet.has(name)).sort());
    expect(writes.length + reads.length).toBe(DingtalkDocsManifest.api.length);
  });

  it('describes every API in Chinese and rejects extra properties', () => {
    for (const api of DingtalkDocsManifest.api) {
      expect(api.description).toMatch(/[\u4E00-\u9FFF]/);
      expect(api.parameters.additionalProperties).toBe(false);
      expect(api.parameters.type).toBe('object');
    }
  });

  it('caps search, sheet, and aitable arrays the way the sidecar does', () => {
    const byName = Object.fromEntries(DingtalkDocsManifest.api.map((api) => [api.name, api]));
    const idPattern = '^[\\w+/=.:-]{1,256}$';

    expect(byName.searchDocs.parameters.properties.query.maxLength).toBe(200);
    expect(byName.searchDocs.parameters.properties.query.minLength).toBe(1);
    expect(byName.searchDocs.parameters.properties.limit.maximum).toBe(10);
    expect(byName.searchDocs.parameters.required).toEqual(['query']);

    expect(byName.searchDrive.parameters.properties.query.maxLength).toBe(200);
    expect(byName.searchDrive.parameters.properties.limit.maximum).toBe(10);
    expect(byName.readDoc.parameters.properties.nodeId.pattern).toBe(idPattern);
    expect(byName.listWikiSpaces.parameters.properties.scope.enum).toEqual(['org', 'my']);
    expect('pos:-1.2713976E7').toMatch(
      new RegExp(byName.listWikiNodes.parameters.properties.cursor.pattern),
    );
    expect(byName.listWikiNodes.description).toContain('30');

    const range = new RegExp(byName.readSheet.parameters.properties.range.pattern);
    expect(byName.readSheet.parameters.properties.range.pattern).toBe(
      `^${A1_CELL}(?::${A1_CELL})?$`,
    );
    expect('A1:AD200').toMatch(range);
    expect('A1:AO14').toMatch(range);
    expect('AE1:AH20').toMatch(range);
    expect('A201').toMatch(range);
    expect('AA10:C20').toMatch(range);
    expect('A0').not.toMatch(range);
    expect('AAAA1').not.toMatch(range);
    expect(byName.readSheet.parameters.required).toEqual(['nodeId']);
    expect(byName.readSheet.description).toContain('200');
    expect(byName.readSheet.description).toContain('30');

    expect(byName.searchAitableBases.parameters.properties.query.minLength).toBe(2);
    expect(byName.searchAitableBases.parameters.properties.query.maxLength).toBe(100);
    expect(byName.queryAitableRecords.parameters.properties.limit.maximum).toBe(50);
    expect(byName.queryAitableRecords.parameters.properties.limit.minimum).toBe(1);
    expect(byName.getAitableSchema.parameters.required).toEqual(['baseId', 'tableId']);

    expect(byName.appendDoc.parameters.properties.markdown.minLength).toBe(1);
    expect(byName.appendDoc.parameters.properties.markdown.maxLength).toBe(20_000);
    expect(byName.createDoc.parameters.properties.title.maxLength).toBe(100);
    expect(byName.createDoc.parameters.properties.title.minLength).toBe(1);
    expect(byName.createDoc.parameters.properties.markdown.maxLength).toBe(20_000);
    expect(byName.createDoc.parameters.required).toEqual(['title', 'markdown']);

    const rows = byName.appendSheetRows.parameters.properties.rows;
    expect(rows.minItems).toBe(1);
    expect(rows.maxItems).toBe(50);
    expect(rows.items.maxItems).toBe(30);
    expect(rows.items.items.anyOf[0].maxLength).toBe(500);
    expect(rows.items.items.anyOf[0].pattern).toBe('^([^=].{0,499})?$');
    const plainCell = new RegExp(rows.items.items.anyOf[0].pattern);
    expect('名称').toMatch(plainCell);
    expect('').toMatch(plainCell);
    expect('=SUM(1)').not.toMatch(plainCell);
    expect(byName.appendSheetRows.description).toContain('一次调用');

    const created = byName.createAitableRecords.parameters.properties.records;
    expect(created.minItems).toBe(1);
    expect(created.maxItems).toBe(20);
    expect(created.items.properties.cells.maxProperties).toBe(50);
    expect(created.items.properties.cells.additionalProperties.anyOf[0].maxLength).toBe(2000);
    expect(created.items.required).toEqual(['cells']);
    expect(byName.createAitableRecords.description).toContain('不能重试');

    const updated = byName.updateAitableRecords.parameters.properties.records;
    expect(updated.maxItems).toBe(20);
    expect(updated.items.required).toEqual(['recordId', 'cells']);
    expect(byName.downloadDriveFile.description).toContain('readSheet');
    expect(byName.downloadDriveFile.description).toContain('readDoc');
  });
});
