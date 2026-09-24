import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { DingtalkDocsApiName } from '../types';
import type { DingtalkDocsRuntimeCaller } from './index';
import {
  createDingtalkDocsRuntime,
  DINGTALK_DOCS_INTERNAL_TOOL_CONTENT,
  DingtalkDocsExecutionRuntime,
} from './index';

const output: BuiltinServerRuntimeOutput = {
  content: '{"ok":true}',
  state: { kind: 'docs' },
  success: true,
};

const samples: Record<keyof typeof DingtalkDocsApiName, object> = {
  appendDoc: { markdown: '补充一段', nodeId: 'doc-1' },
  appendSheetRows: { nodeId: 'sheet-node', rows: [['名称', 1]], sheetId: 'sheet-1' },
  createAitableRecords: {
    baseId: 'base-1',
    records: [{ cells: { fldName: '周报' } }],
    tableId: 'table-1',
  },
  createDoc: { markdown: '# 标题', title: '周报' },
  downloadDriveFile: { nodeId: 'file-1' },
  getAitableSchema: { baseId: 'base-1', tableId: 'table-1' },
  listAitableTables: { baseId: 'base-1' },
  listDrive: { folderId: 'folder-1' },
  listSheets: { nodeId: 'sheet-node' },
  listWikiNodes: { cursor: 'pos:-1.2713976E7', workspaceId: 'space-1' },
  listWikiSpaces: { scope: 'org' },
  queryAitableRecords: { baseId: 'base-1', limit: 20, tableId: 'table-1' },
  readDoc: { nodeId: 'doc-1' },
  readSheet: { nodeId: 'sheet-node', range: 'A1:D10' },
  searchAitableBases: { query: '库存' },
  searchDocs: { limit: 5, query: '周报' },
  searchDrive: { query: '库存' },
  updateAitableRecords: {
    baseId: 'base-1',
    records: [{ cells: { fldName: '已完成' }, recordId: 'rec-1' }],
    tableId: 'table-1',
  },
};

describe('DingtalkDocsExecutionRuntime', () => {
  it('delegates every API to call with the api name, args, and ctx', async () => {
    const call = vi.fn<DingtalkDocsRuntimeCaller['call']>().mockResolvedValue(output);
    const runtime = createDingtalkDocsRuntime({ call });
    const ctx = { botPlatform: 'dingtalk', topicId: 'topic-1' };

    expect(runtime).toBeInstanceOf(DingtalkDocsExecutionRuntime);
    expect(Object.keys(samples).sort()).toEqual(Object.values(DingtalkDocsApiName).sort());

    for (const [apiName, args] of Object.entries(samples)) {
      call.mockClear();
      const method = runtime[apiName as keyof DingtalkDocsExecutionRuntime];
      expect(typeof method).toBe('function');

      const result = await (
        method as (args: object, ctx?: unknown) => Promise<BuiltinServerRuntimeOutput>
      ).call(runtime, args, ctx);

      expect(result).toEqual(output);
      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith(apiName, args, ctx);
    }
  });

  it('forwards an omitted ctx and default empty args', async () => {
    const call = vi.fn<DingtalkDocsRuntimeCaller['call']>().mockResolvedValue(output);
    const runtime = createDingtalkDocsRuntime({ call });

    await runtime.listWikiSpaces();
    expect(call).toHaveBeenCalledWith('listWikiSpaces', {}, undefined);

    await runtime.listDrive();
    expect(call).toHaveBeenLastCalledWith('listDrive', {}, undefined);

    await runtime.searchAitableBases();
    expect(call).toHaveBeenLastCalledWith('searchAitableBases', {}, undefined);
  });

  it('defaults resolveLink to the path itself', () => {
    const runtime = createDingtalkDocsRuntime({ call: vi.fn() });

    expect(runtime.resolveLink('/settings/connector')).toBe('/settings/connector');
  });

  it('exposes the sanitized internal-failure copy', () => {
    expect(DINGTALK_DOCS_INTERNAL_TOOL_CONTENT).toContain('内部错误');
    expect(DINGTALK_DOCS_INTERNAL_TOOL_CONTENT).not.toMatch(/stack|select /i);
  });
});
