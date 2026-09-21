// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssertFeature = vi.fn();
const mockRequireIdentity = vi.fn();
const mockRequest = vi.fn();
const mockResolveStaff = vi.fn();
const mockAppend = vi.fn();

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://aihub.example.com/' },
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/capabilities', () => ({
  assertDingtalkFeature: (...args: unknown[]) => mockAssertFeature(...args),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/identity', () => ({
  requireVerifiedDingtalkIdentity: (...args: unknown[]) => mockRequireIdentity(...args),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/client', () => ({
  dingtalkWorkspaceRequest: (...args: unknown[]) => mockRequest(...args),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/directory', () => ({
  resolveStaff: (...args: unknown[]) => mockResolveStaff(...args),
}));

vi.mock('@/server/enterprise/services/platformAudit', () => ({
  PlatformAuditService: vi.fn(() => ({ append: mockAppend })),
}));

const { DingtalkTodoService } = await import('./index');
const { DingtalkWorkspaceError } = await import('../errors');

const identity = { name: '张三', staffId: 'staff-me', unionId: 'union-me' };

describe('DingtalkTodoService', () => {
  const service = new DingtalkTodoService({} as never, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertFeature.mockResolvedValue(undefined);
    mockRequireIdentity.mockResolvedValue(identity);
    mockAppend.mockResolvedValue({});
    mockResolveStaff.mockResolvedValue({
      deptPath: '研发',
      name: '张三',
      staffId: 'staff-me',
      unionId: 'union-me',
    });
  });

  it('listTodos queries org tasks as creator or executor', async () => {
    mockRequest.mockResolvedValueOnce({
      todoCards: [{ isDone: false, subject: '写周报', taskId: 't1' }],
    });
    const result = await service.listTodos({ done: false });
    expect(mockAssertFeature).toHaveBeenCalledWith('todo');
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api: 'v1',
        body: { isDone: false, roleTypes: [['creator'], ['executor']] },
        method: 'POST',
        path: '/v1.0/todo/users/union-me/org/tasks/query',
      }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({ done: false, subject: '写周报', taskId: 't1' }),
    ]);
  });

  it('createTodo sends APP_URL detailUrl, caller as creator, and unique sourceId', async () => {
    mockRequest.mockResolvedValueOnce({ id: 't-new', subject: '接入待办' });
    const created = await service.createTodo({ subject: '接入待办' });
    expect(created.taskId).toBe('t-new');
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          creatorId: 'union-me',
          detailUrl: {
            appUrl: 'https://aihub.example.com',
            pcUrl: 'https://aihub.example.com',
          },
          executorIds: ['union-me'],
          subject: '接入待办',
        }),
        method: 'POST',
        path: '/v1.0/todo/users/union-me/tasks',
        query: { operatorId: 'union-me' },
      }),
    );
    const sourceId = mockRequest.mock.calls[0][0].body.sourceId as string;
    expect(sourceId).toMatch(/^aihub-todo-/);
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dingtalk.todo.create',
        actorUserId: 'user-1',
        targetId: 't-new',
        targetType: 'dingtalk_todo',
      }),
    );
  });

  it('createTodo resolves executor tokens and rejects ambiguous names', async () => {
    mockResolveStaff.mockResolvedValueOnce({
      ambiguous: [
        { deptPath: '研发', name: '李四', staffId: 'a', unionId: 'u-a' },
        { deptPath: '财务', name: '李四', staffId: 'b', unionId: 'u-b' },
      ],
    });
    await expect(
      service.createTodo({ executorTokens: ['李四'], subject: '请李四处理' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_AMBIGUOUS' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('completeTodo and deleteTodo call the documented write endpoints', async () => {
    mockRequest.mockResolvedValue({});
    await service.completeTodo({ taskId: 't1' });
    await service.deleteTodo({ taskId: 't1' });
    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        body: { done: true },
        method: 'PUT',
        path: '/v1.0/todo/users/union-me/tasks/t1',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'DELETE',
        path: '/v1.0/todo/users/union-me/tasks/t1',
      }),
    );
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dingtalk.todo.complete' }),
    );
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dingtalk.todo.delete' }),
    );
  });

  it('preview(createTodo) returns actingAs, resolved executors, and no danger', async () => {
    mockResolveStaff
      .mockResolvedValueOnce({
        deptPath: '研发',
        name: '张三',
        staffId: 'staff-me',
        unionId: 'union-me',
      })
      .mockResolvedValueOnce({
        deptPath: '财务',
        name: '李四',
        staffId: 'staff-li',
        unionId: 'union-li',
      });
    const preview = await service.preview({
      apiName: 'createTodo',
      args: { executorTokens: ['staff:staff-li'], subject: '对账' },
    });
    expect(preview).toMatchObject({
      actingAs: { deptPath: '研发', name: '张三' },
      danger: false,
      title: '创建待办',
    });
    expect(preview.lines).toEqual(
      expect.arrayContaining([
        { label: '标题', value: '对账' },
        { label: '执行人', value: '李四 · 财务' },
      ]),
    );
    expect(preview.warnings.length).toBeGreaterThan(0);
  });

  it('preview(deleteTodo) is dangerous', async () => {
    const preview = await service.preview({ apiName: 'deleteTodo', args: { taskId: 't1' } });
    expect(preview.danger).toBe(true);
    expect(preview.title).toBe('删除待办');
  });

  it('updateTodo accepts 101 executors and dueTime null to clear', async () => {
    mockResolveStaff.mockImplementation(async (_db, token: string) => ({
      deptPath: '',
      name: 'x',
      staffId: String(token).replace(/^staff:/, ''),
      unionId: `u-${token}`,
    }));
    mockRequest.mockResolvedValue({});
    const tokens = Array.from({ length: 101 }, (_, index) => `staff:e${index}`);
    await service.updateTodo({ dueTime: null, executorTokens: tokens, taskId: 't1' });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          dueTime: null,
          executorIds: expect.any(Array),
        }),
      }),
    );
    expect(mockRequest.mock.calls[0]?.[0].body.executorIds).toHaveLength(101);
  });

  it('createTodo rejects more than 100 executors', async () => {
    const tokens = Array.from({ length: 101 }, (_, index) => `staff:e${index}`);
    await expect(
      service.createTodo({ executorTokens: tokens, subject: '太多执行人' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects unknown preview api names', async () => {
    await expect(service.preview({ apiName: 'listTodos', args: {} })).rejects.toBeInstanceOf(
      DingtalkWorkspaceError,
    );
  });
});
