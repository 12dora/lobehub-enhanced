import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import {
  appendDocSchema,
  appendSheetRowsSchema,
  createAitableRecordsSchema,
  createDocSchema,
  parseDocsArgs,
  updateAitableRecordsSchema,
} from '../../server/src/enterprise/services/dingtalkDocs/args.ts';
import {
  DOCS_CONTENT_PARITY,
  DOCS_EXEC_SCENARIOS,
  DOCS_NODE,
  DOCS_PREVIEW_CALLS,
  type DocsContentParityCase,
  type DocsServerSchema,
} from '../../server/src/enterprise/services/dingtalkDocs/sidecarCalls.ts';
import { prepareExec } from './ops.ts';

const SERVER_SCHEMAS: Record<DocsServerSchema, ZodType> = {
  appendDoc: appendDocSchema,
  appendSheetRows: appendSheetRowsSchema,
  createAitableRecords: createAitableRecordsSchema,
  createDoc: createDocSchema,
  updateAitableRecords: updateAitableRecordsSchema,
};

const PROFILE = 'dingcorp0123456789:012345678901234567';

describe('docs executor args pass sidecar prepareExec', () => {
  const calls = [
    ...DOCS_EXEC_SCENARIOS.flatMap((scenario) => scenario.calls),
    ...DOCS_PREVIEW_CALLS,
  ];

  it('accepts every call the docs executor and append preview produce', () => {
    expect(calls.length).toBeGreaterThan(18);
    for (const call of calls) {
      expect(
        () => prepareExec(call.op, PROFILE, call.args),
        `${call.op} ${JSON.stringify(call.args)}`,
      ).not.toThrow();
    }
  });

  it('rejects the fixed flags the server used to forward', () => {
    expect(() => prepareExec('drive.search', PROFILE, { query: '库存', target: 'file' })).toThrow(
      /未知参数/,
    );
    expect(() => prepareExec('drive.list', PROFILE, { limit: 20 })).toThrow(/未知参数/);
    expect(() =>
      prepareExec('drive.download', PROFILE, { nodeId: DOCS_NODE, output: './files/' }),
    ).toThrow(/未知参数/);
    expect(() =>
      prepareExec('sheet.read', PROFILE, {
        nodeId: DOCS_NODE,
        range: 'A1:B2',
        valueRenderOption: 'formatted_value',
      }),
    ).toThrow(/未知参数/);
    expect(() => prepareExec('aitable.bases', PROFILE, { limit: 10 })).toThrow(/未知参数/);
    expect(() => prepareExec('aitable.bases', PROFILE, { query: '客户' })).not.toThrow();
  });

  it('rejects markdown, cells, and empty records exactly when the sidecar does', () => {
    const rejects = (item: DocsContentParityCase, side: 'server' | 'sidecar'): boolean => {
      try {
        if (side === 'server') {
          parseDocsArgs(SERVER_SCHEMAS[item.server.schema], item.server.args);
        } else {
          prepareExec(item.sidecar.op, PROFILE, item.sidecar.args);
        }
        return false;
      } catch {
        return true;
      }
    };

    expect(DOCS_CONTENT_PARITY.length).toBeGreaterThan(10);
    for (const item of DOCS_CONTENT_PARITY) {
      const server = rejects(item, 'server');
      const sidecar = rejects(item, 'sidecar');
      expect(server, item.label).toBe(sidecar);
      expect(server, item.label).toBe(!item.accept);
    }
  });
});
