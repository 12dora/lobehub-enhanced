/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callTool = vi.fn();
const preview = vi.fn();

vi.mock('@/services/dingtalkDocs', () => ({
  dingtalkDocsService: { callTool, preview },
}));

const { dingtalkDocsExecutor } = await import('./index');

const ctx = { messageId: 'msg_1' } as any;

const ALL_API_NAMES = [
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
];

describe('dingtalkDocsExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callTool.mockResolvedValue({ content: '{}', state: { kind: 'docs' }, success: true });
  });

  it('exposes every API of the toolset', () => {
    expect(dingtalkDocsExecutor.identifier).toBe('lobe-dingtalk-docs');
    expect([...dingtalkDocsExecutor.getApiNames()].sort()).toEqual(ALL_API_NAMES);
  });

  it.each(ALL_API_NAMES)('forwards %s as one callTool round trip', async (apiName) => {
    const args = { marker: apiName };

    await dingtalkDocsExecutor.invoke(apiName, args, ctx);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({ apiName, args });
    // The preview belongs to the confirm card, never to the execution.
    expect(preview).not.toHaveBeenCalled();
  });

  it('sends empty args when the model sent none', async () => {
    await dingtalkDocsExecutor.invoke('listWikiSpaces', undefined, ctx);

    expect(callTool).toHaveBeenCalledWith({ apiName: 'listWikiSpaces', args: {} });
  });

  it('rejects an API outside the toolset without a round trip', async () => {
    const result = await dingtalkDocsExecutor.invoke('deleteRecords', {}, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ApiNotFound');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('returns a successful server output unchanged', async () => {
    const state = {
      baseId: 'base_1',
      fields: [{ fieldId: 'fld1', name: '名称' }],
      hasMore: false,
      kind: 'aitableRecords',
      records: [{ cells: { 名称: '样品 A' }, recordId: 'rec1' }],
      tableId: 'tbl1',
    };
    callTool.mockResolvedValueOnce({ content: '| 名称 |\n| 样品 A |', state, success: true });

    const result = await dingtalkDocsExecutor.invoke(
      'queryAitableRecords',
      { baseId: 'base_1', tableId: 'tbl1' },
      ctx,
    );

    expect(result).toEqual({ content: '| 名称 |\n| 样品 A |', state, success: true });
  });

  it('maps a tool-level failure to a plugin error with the server content', async () => {
    callTool.mockResolvedValueOnce({
      content: '管理员未开启此项能力（DINGTALK_PERSONAL_FEATURE_DISABLED）',
      error: { code: 'DINGTALK_PERSONAL_FEATURE_DISABLED', message: 'feature disabled' },
      success: false,
    });

    const result = await dingtalkDocsExecutor.invoke('readSheet', { nodeId: 'n1' }, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toBe('管理员未开启此项能力（DINGTALK_PERSONAL_FEATURE_DISABLED）');
    expect(result.error).toEqual({
      body: { code: 'DINGTALK_PERSONAL_FEATURE_DISABLED', message: 'feature disabled' },
      message: 'feature disabled',
      type: 'PluginServerError',
    });
  });

  it('keeps the authorize state renderable by leaving out the error', async () => {
    const state = {
      code: 'DINGTALK_PERSONAL_UNAUTHORIZED',
      kind: 'authorizationRequired',
      settingsPath: '/settings/connector',
    };
    callTool.mockResolvedValueOnce({
      content: '你还没有授权 AI 助手读取你的钉钉个人数据。',
      error: { code: 'DINGTALK_PERSONAL_UNAUTHORIZED', message: 'DINGTALK_PERSONAL_UNAUTHORIZED' },
      state,
      success: false,
    });

    const result = await dingtalkDocsExecutor.invoke('searchDocs', { query: '周报' }, ctx);

    expect(result).toEqual({
      content: '你还没有授权 AI 助手读取你的钉钉个人数据。',
      state,
      success: false,
    });
  });

  it('falls back to the error message when the server sent no content', async () => {
    callTool.mockResolvedValueOnce({
      content: '',
      error: { code: 'DINGTALK_PERSONAL_UPSTREAM', message: 'upstream failed' },
      success: false,
    });

    const result = await dingtalkDocsExecutor.invoke('appendDoc', { nodeId: 'n1' }, ctx);

    expect(result.content).toBe('upstream failed');
  });

  it('turns a transport failure into a failed result', async () => {
    callTool.mockRejectedValueOnce(new Error('DINGTALK_PERSONAL_DISABLED'));

    const result = await dingtalkDocsExecutor.invoke('createAitableRecords', {}, ctx);

    expect(result).toEqual({
      content: 'Failed: DINGTALK_PERSONAL_DISABLED',
      error: { message: 'DINGTALK_PERSONAL_DISABLED', type: 'CreateAitableRecordsFailed' },
      success: false,
    });
  });
});
