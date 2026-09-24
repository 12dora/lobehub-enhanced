// @vitest-environment node
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class DingtalkPersonalError extends Error {
    code: string;
    details?: Record<string, unknown>;
    constructor(code: string, details?: Record<string, unknown>) {
      super(code);
      this.name = 'DingtalkPersonalError';
      this.code = code;
      this.details = details;
    }
  }
  return {
    db: { tag: 'server-db' },
    DingtalkPersonalError,
    preview: vi.fn(),
    run: vi.fn(),
  };
});

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => mocks.db),
}));

vi.mock('@/server/enterprise/services/dingtalkPersonal/errors', () => ({
  DingtalkPersonalError: mocks.DingtalkPersonalError,
}));

vi.mock('@/server/enterprise/services/dingtalkDocs/tool', () => ({
  DINGTALK_DOCS_API_NAMES: [
    'searchDocs',
    'readDoc',
    'listWikiSpaces',
    'listWikiNodes',
    'searchDrive',
    'listDrive',
    'downloadDriveFile',
    'listSheets',
    'readSheet',
    'searchAitableBases',
    'listAitableTables',
    'getAitableSchema',
    'queryAitableRecords',
    'appendDoc',
    'createDoc',
    'appendSheetRows',
    'createAitableRecords',
    'updateAitableRecords',
  ],
  previewDingtalkDocsWrite: mocks.preview,
  runDingtalkDocsTool: mocks.run,
}));

const { dingtalkDocsRouter } = await import('./dingtalkDocsTool');

const caller = (ctx?: { workspaceId?: string | null }) =>
  dingtalkDocsRouter.createCaller({ userId: 'user-1', workspaceId: ctx?.workspaceId } as never);

describe('dingtalkDocsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays registered as dingtalkDocs, matching dingtalkPersonal', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain(
      "dingtalkDocs: lazyRouter(() => import('./dingtalkDocsTool').then((m) => m.dingtalkDocsRouter))",
    );
    expect(source).not.toContain('dingtalkDocsTool:');
  });

  it('callTool runs the tool and keeps domain failures in the result', async () => {
    mocks.run.mockResolvedValueOnce({ content: '{}', state: { kind: 'docs' }, success: true });
    const ok = await caller({ workspaceId: 'ws-9' }).callTool({
      apiName: 'searchDocs',
      args: { query: '周报' },
    });
    expect(ok.success).toBe(true);
    expect(mocks.run).toHaveBeenCalledWith(
      mocks.db,
      'user-1',
      'searchDocs',
      { query: '周报' },
      {
        botPlatform: undefined,
        workspaceId: 'ws-9',
      },
    );

    mocks.run.mockResolvedValueOnce({ content: '未授权', success: false });
    await expect(
      caller().callTool({ apiName: 'readDoc', args: { nodeId: 'n1' } }),
    ).resolves.toMatchObject({
      success: false,
    });
  });

  it('preview maps a feature-disabled error to FORBIDDEN', async () => {
    mocks.preview.mockRejectedValueOnce(
      new mocks.DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature: 'docs' }),
    );
    await expect(
      caller().preview({ apiName: 'appendDoc', args: { markdown: 'a', nodeId: 'n1' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'DINGTALK_PERSONAL_FEATURE_DISABLED' });
  });

  it('preview returns the confirm card', async () => {
    const preview = { danger: false, lines: ['正文'], title: '新建文档「周报」', warnings: [] };
    mocks.preview.mockResolvedValueOnce(preview);
    await expect(
      caller().preview({ apiName: 'createDoc', args: { markdown: '正文', title: '周报' } }),
    ).resolves.toEqual(preview);
  });
});
