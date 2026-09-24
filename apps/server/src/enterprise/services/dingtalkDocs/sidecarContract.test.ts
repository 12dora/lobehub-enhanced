// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCS_EXEC_SCENARIOS, DOCS_SHEET, DOCS_TOOL_CALL_ID } from './sidecarCalls';
import type { DingtalkDocsApiName } from './types';

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

const { runDingtalkDocsTool } = await import('./tool');

const db = { tag: 'db' } as never;

describe('docs executor sidecar contract', () => {
  beforeEach(() => {
    exec.mockReset();
    downloadOp.mockReset();
    settle.mockReset();
    ingest.mockReset();
    audit.mockReset();
    settle.mockResolvedValue({ content: 'settled', success: false });
    audit.mockResolvedValue(undefined);
    ingest.mockResolvedValue({
      fileId: 'file-1',
      name: '报价.xlsx',
      parseable: false,
      parseFailed: false,
      sizeBytes: 4,
      text: '',
    });
    exec.mockImplementation(async (op: string) => {
      if (op === 'sheet.list') {
        return { data: { sheets: [{ sheetId: DOCS_SHEET, title: '库存' }] } };
      }
      if (op === 'sheet.info') {
        return { name: '库存', nonEmptyRange: { range: 'A1:AO14' } };
      }
      if (op === 'sheet.read') {
        return { data: { cells: [[{ value: '品名' }]], complete: true } };
      }
      if (op === 'aitable.schema') {
        return {
          data: {
            tables: [
              {
                fields: [{ fieldId: 'BGV86kr', name: '负责人', type: 'text' }],
                tableId: 'knhttimpzdr31aq2r3ykq',
                tableName: '客户表',
              },
            ],
          },
        };
      }
      return {};
    });
  });

  it('emits only the allow-listed calls for every API, including optional args', async () => {
    const apis = new Set<string>();
    for (const scenario of DOCS_EXEC_SCENARIOS) {
      apis.add(scenario.apiName);
      const calls: Array<{ args: Record<string, unknown>; op: string; via: string }> = [];
      exec.mockImplementation(async (op: string, args: Record<string, unknown>) => {
        calls.push({ args, op, via: 'exec' });
        if (op === 'sheet.list') {
          return { data: { sheets: [{ sheetId: DOCS_SHEET, title: '库存' }] } };
        }
        if (op === 'sheet.info') {
          return { name: '库存', nonEmptyRange: { range: 'A1:AO14' } };
        }
        if (op === 'sheet.read') {
          return { data: { cells: [[{ value: '品名' }]], complete: true } };
        }
        if (op === 'aitable.schema') {
          return {
            data: {
              tables: [
                {
                  fields: [{ fieldId: 'BGV86kr', name: '负责人', type: 'text' }],
                  tableName: '客户表',
                },
              ],
            },
          };
        }
        return {};
      });
      downloadOp.mockImplementation(async (op: string, args: Record<string, unknown>) => {
        calls.push({ args, op, via: 'download' });
        return { buffer: Buffer.from('abc'), name: '报价.xlsx', sizeBytes: 3 };
      });
      const result = await runDingtalkDocsTool(
        db,
        'user-1',
        scenario.apiName as DingtalkDocsApiName,
        scenario.args,
        { toolCallId: DOCS_TOOL_CALL_ID },
      );
      expect(result.success, scenario.apiName).toBe(true);
      expect(calls, `${scenario.apiName} ${JSON.stringify(scenario.args)}`).toEqual(scenario.calls);
    }
    expect(apis.size).toBe(18);
  });
});
