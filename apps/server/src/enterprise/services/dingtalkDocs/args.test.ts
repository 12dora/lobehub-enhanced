// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import {
  appendDocSchema,
  appendSheetRowsSchema,
  createAitableRecordsSchema,
  createDocSchema,
  parseDocsArgs,
  updateAitableRecordsSchema,
} from './args';
import { DOCS_CONTENT_PARITY, type DocsServerSchema } from './sidecarCalls';

const SCHEMAS: Record<DocsServerSchema, ZodType> = {
  appendDoc: appendDocSchema,
  appendSheetRows: appendSheetRowsSchema,
  createAitableRecords: createAitableRecordsSchema,
  createDoc: createDocSchema,
  updateAitableRecords: updateAitableRecordsSchema,
};

describe('docs args mirror sidecar content rules', () => {
  it('rejects markdown, cells, and empty records with a Chinese message', () => {
    for (const item of DOCS_CONTENT_PARITY) {
      let thrown: unknown;
      try {
        parseDocsArgs(SCHEMAS[item.server.schema], item.server.args);
      } catch (error) {
        thrown = error;
      }
      if (item.accept) {
        expect(thrown, item.label).toBeUndefined();
        continue;
      }
      expect(thrown, item.label).toMatchObject({
        code: 'DINGTALK_PERSONAL_INVALID_ARGS',
        details: { message: expect.stringContaining(item.message ?? '') },
      });
    }
  });
});
