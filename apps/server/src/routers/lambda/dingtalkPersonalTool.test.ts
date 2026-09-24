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

vi.mock('@/server/enterprise/services/dingtalkPersonal', () => ({
  DingtalkPersonalError: mocks.DingtalkPersonalError,
}));

vi.mock('@/server/enterprise/services/dingtalkPersonal/tool', () => ({
  DINGTALK_PERSONAL_API_NAMES: [
    'listMyTodos',
    'getTodo',
    'searchGroups',
    'listMyGroups',
    'listGroupMessages',
    'searchMessages',
    'downloadMessageFile',
    'listReports',
    'getReport',
    'listReportTemplates',
    'getReportTemplate',
    'updateTodo',
    'completeTodo',
    'submitReport',
  ],
  previewDingtalkPersonalWrite: mocks.preview,
  runDingtalkPersonalTool: mocks.run,
}));

const { router } = await import('@/libs/trpc/lambda');
const { dingtalkPersonalToolProcedures } = await import('./dingtalkPersonalTool');

const procedures = router(dingtalkPersonalToolProcedures);

const caller = (ctx?: { workspaceId?: string | null }) =>
  procedures.createCaller({ userId: 'user-1', workspaceId: ctx?.workspaceId } as never);

describe('dingtalkPersonalToolProcedures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('callTool runs the web tool path and returns domain failures as data', async () => {
    mocks.run.mockResolvedValueOnce({
      content: '{}',
      state: { kind: 'todos' },
      success: true,
    });
    const ok = await caller({ workspaceId: 'ws-9' }).callTool({
      apiName: 'listMyTodos',
      args: { page: 1 },
    });
    expect(ok.success).toBe(true);
    expect(mocks.run).toHaveBeenCalledWith(
      mocks.db,
      'user-1',
      'listMyTodos',
      { page: 1 },
      {
        botPlatform: undefined,
        workspaceId: 'ws-9',
      },
    );

    mocks.run.mockResolvedValueOnce({
      content: '未授权',
      error: { code: 'DINGTALK_PERSONAL_UNAUTHORIZED', message: '未授权' },
      success: false,
    });
    await expect(
      caller().callTool({ apiName: 'getTodo', args: { taskId: '1' } }),
    ).resolves.toMatchObject({ success: false });
  });

  it('callTool defaults args and drops a null workspace id', async () => {
    mocks.run.mockResolvedValueOnce({ content: '{}', success: true });
    await caller({ workspaceId: null }).callTool({ apiName: 'listReportTemplates' });
    expect(mocks.run).toHaveBeenCalledWith(
      mocks.db,
      'user-1',
      'listReportTemplates',
      {},
      { botPlatform: undefined, workspaceId: undefined },
    );
  });

  it('rejects an unknown api name before calling the tool', async () => {
    await expect(
      caller().callTool({ apiName: 'dropTable' as 'listMyTodos', args: {} }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('preview returns the confirm card payload', async () => {
    const preview = { danger: false, lines: ['待办：测试'], title: '完成待办', warnings: [] };
    mocks.preview.mockResolvedValueOnce(preview);
    await expect(
      caller().preview({ apiName: 'completeTodo', args: { taskId: 't1' } }),
    ).resolves.toEqual(preview);
    expect(mocks.preview).toHaveBeenCalledWith(mocks.db, 'user-1', 'completeTodo', {
      taskId: 't1',
    });
  });

  it.each([
    ['DINGTALK_PERSONAL_DISABLED', 'FORBIDDEN'],
    ['DINGTALK_PERSONAL_FEATURE_DISABLED', 'FORBIDDEN'],
    ['DINGTALK_IDENTITY_UNBOUND', 'PRECONDITION_FAILED'],
    ['DINGTALK_IDENTITY_UNVERIFIED', 'PRECONDITION_FAILED'],
    ['DINGTALK_IDENTITY_INACTIVE', 'PRECONDITION_FAILED'],
    ['DINGTALK_PERSONAL_CORP_ID_MISSING', 'PRECONDITION_FAILED'],
    ['DINGTALK_PERSONAL_LOGIN_NOT_FOUND', 'NOT_FOUND'],
    ['DINGTALK_PERSONAL_RATE_LIMITED', 'TOO_MANY_REQUESTS'],
    ['DINGTALK_PERSONAL_BROKER_UNAVAILABLE', 'INTERNAL_SERVER_ERROR'],
    ['DINGTALK_PERSONAL_TIMEOUT', 'INTERNAL_SERVER_ERROR'],
    ['DINGTALK_PERSONAL_UNAUTHORIZED', 'BAD_REQUEST'],
    ['DINGTALK_PERSONAL_INVALID_ARGS', 'BAD_REQUEST'],
  ] as const)('maps %s to %s', async (code, trpcCode) => {
    mocks.preview.mockRejectedValueOnce(new mocks.DingtalkPersonalError(code, { feature: 'todo' }));
    await expect(caller().preview({ apiName: 'updateTodo', args: {} })).rejects.toMatchObject({
      cause: { data: { code, details: { feature: 'todo' } } },
      code: trpcCode,
      message: code,
    });
  });

  it('maps unknown preview failures without leaking the message', async () => {
    mocks.preview.mockRejectedValueOnce(new Error('ECONNRESET postgres://secret'));
    await expect(caller().preview({ apiName: 'submitReport', args: {} })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'DINGTALK_PERSONAL_INTERNAL',
    });
  });
});
