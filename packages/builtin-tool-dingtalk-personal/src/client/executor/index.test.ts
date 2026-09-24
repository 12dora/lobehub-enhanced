/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callTool = vi.fn();
const preview = vi.fn();

vi.mock('@/services/dingtalkPersonal', () => ({
  dingtalkPersonalService: { callTool, preview },
}));

const { dingtalkPersonalExecutor } = await import('./index');

const ctx = { messageId: 'msg_1' } as any;

const ALL_API_NAMES = [
  'completeTodo',
  'completeTodos',
  'downloadMessageFile',
  'getReport',
  'getReportTemplate',
  'getTodo',
  'listGroupMessages',
  'listMyGroups',
  'listMyTodos',
  'listReportTemplates',
  'listReports',
  'searchGroups',
  'searchMessages',
  'submitReport',
  'updateTodo',
];

describe('dingtalkPersonalExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callTool.mockResolvedValue({ content: '{}', state: { kind: 'todos' }, success: true });
  });

  it('exposes every API of the toolset', () => {
    expect(dingtalkPersonalExecutor.identifier).toBe('lobe-dingtalk-personal');
    expect([...dingtalkPersonalExecutor.getApiNames()].sort()).toEqual(ALL_API_NAMES);
  });

  it.each(ALL_API_NAMES)('forwards %s as one callTool round trip', async (apiName) => {
    const args = { marker: apiName };

    await dingtalkPersonalExecutor.invoke(apiName, args, ctx);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({ apiName, args });
  });

  it('sends empty args when the model sent none', async () => {
    await dingtalkPersonalExecutor.invoke('listReportTemplates', undefined, ctx);

    expect(callTool).toHaveBeenCalledWith({ apiName: 'listReportTemplates', args: {} });
  });

  it('returns a successful server output unchanged', async () => {
    const state = {
      hasMore: false,
      kind: 'todos',
      page: 1,
      status: 'open',
      todos: [{ dueTime: null, priority: 20, subject: '测试待办', taskId: '1001' }],
    };
    callTool.mockResolvedValueOnce({ content: '{"todos":[]}', state, success: true });

    const result = await dingtalkPersonalExecutor.invoke('listMyTodos', { status: 'open' }, ctx);

    expect(result).toEqual({ content: '{"todos":[]}', state, success: true });
  });

  it('maps a tool-level failure to a plugin error with the server content', async () => {
    callTool.mockResolvedValueOnce({
      content: '钉钉限流了，请稍后再试（DINGTALK_PERSONAL_RATE_LIMITED）',
      error: { code: 'DINGTALK_PERSONAL_RATE_LIMITED', message: 'rate limited' },
      success: false,
    });

    const result = await dingtalkPersonalExecutor.invoke('getTodo', { taskId: '1001' }, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toBe('钉钉限流了，请稍后再试（DINGTALK_PERSONAL_RATE_LIMITED）');
    expect(result.error).toEqual({
      body: { code: 'DINGTALK_PERSONAL_RATE_LIMITED', message: 'rate limited' },
      message: 'rate limited',
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

    const result = await dingtalkPersonalExecutor.invoke('listMyTodos', {}, ctx);

    expect(result).toEqual({
      content: '你还没有授权 AI 助手读取你的钉钉个人数据。',
      state,
      success: false,
    });
  });

  it('keeps the batch state of a partial and of a total failure', async () => {
    const partial = {
      action: 'completeTodos',
      failed: 1,
      items: [
        { id: '1001', ok: true, title: '交库存日报' },
        { error: '待办不存在', id: '1002', ok: false },
      ],
      kind: 'batchWrite',
      succeeded: 1,
      summary: '已完成 1 项待办，1 项失败',
      total: 2,
    };
    callTool.mockResolvedValueOnce({
      content: '已完成 1 项待办，1 项失败',
      state: partial,
      success: true,
    });

    const args = { taskIds: ['1001', '1002'] };
    expect(await dingtalkPersonalExecutor.invoke('completeTodos', args, ctx)).toEqual({
      content: '已完成 1 项待办，1 项失败',
      state: partial,
      success: true,
    });
    expect(callTool).toHaveBeenCalledWith({ apiName: 'completeTodos', args });

    const failed = { ...partial, failed: 2, succeeded: 0, summary: '2 项待办均未完成' };
    callTool.mockResolvedValueOnce({
      content: '2 项待办均未完成',
      error: { code: 'DINGTALK_PERSONAL_UPSTREAM', message: '待办不存在' },
      state: failed,
      success: false,
    });

    const result = await dingtalkPersonalExecutor.invoke('completeTodos', args, ctx);

    // The render still lists every item under the mapped error.
    expect(result.success).toBe(false);
    expect(result.state).toEqual(failed);
    expect(result.error?.type).toBe('PluginServerError');
  });

  it('turns a transport failure into a failed result', async () => {
    callTool.mockRejectedValueOnce(new Error('DINGTALK_PERSONAL_DISABLED'));

    const result = await dingtalkPersonalExecutor.invoke('submitReport', {}, ctx);

    expect(result).toEqual({
      content: 'Failed: DINGTALK_PERSONAL_DISABLED',
      error: { message: 'DINGTALK_PERSONAL_DISABLED', type: 'SubmitReportFailed' },
      success: false,
    });
  });
});
