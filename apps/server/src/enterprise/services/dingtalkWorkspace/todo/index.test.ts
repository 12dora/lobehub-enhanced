// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appEnv } from '@/envs/app';

const mockAssertFeature = vi.fn();
const mockRequireIdentity = vi.fn();
const mockRequest = vi.fn();
const mockResolveStaff = vi.fn();
const mockAppend = vi.fn();
const mockListPending = vi.fn();

const redisState = vi.hoisted(() => {
  const store = new Map<string, string>();
  const sets: Array<{ extra: unknown[]; key: string; value: string }> = [];
  return {
    client: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string, ...extra: unknown[]) => {
        sets.push({ extra, key, value });
        if (extra.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      },
    },
    sets,
    store,
  };
});

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

vi.mock('@/server/enterprise/services/dingtalkWorkspace/approval', () => ({
  DingtalkApprovalService: vi.fn(() => ({
    listPending: (...args: unknown[]) => mockListPending(...args),
  })),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisState.client,
}));

const mockGetPersonalConfig = vi.fn();
const mockPersonalGetStatus = vi.fn();
const mockPersonalExec = vi.fn();

vi.mock('@/server/enterprise/services/dingtalkPersonal', () => ({
  DingtalkPersonalService: class {
    constructor(_db: unknown, _userId: string) {}

    exec(...args: unknown[]) {
      return mockPersonalExec(...args);
    }

    getStatus() {
      return mockPersonalGetStatus();
    }
  },
  getDingtalkPersonalConfig: (...args: unknown[]) => mockGetPersonalConfig(...args),
}));

const {
  DingtalkTodoService,
  invalidateDingtalkTodoListCache,
  ORG_TODO_UNAVAILABLE_NOTE,
  PERSONAL_TODO_ERROR_NOTE,
  PERSONAL_TODO_MERGED_NOTE,
  personalTodoAuthNote,
  resetOrgTodoReadGateForTest,
  resetTodoListCacheForTest,
  todoMergedInvalidationCountForTest,
} = await import('./index');
const {
  ORG_TODO_READ_DISCOVER_CLAIM_KEY,
  ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS,
  ORG_TODO_READ_GATE_REDIS_KEY,
  ORG_TODO_READ_GATE_TTL_SECONDS,
} = await import('./orgReadGate');
const { DingtalkWorkspaceError } = await import('../errors');

const identity = { name: '张三', staffId: 'staff-me', unionId: 'union-me' };

describe('personalTodoAuthNote', () => {
  it('includes the web deep link and drops a trailing slash on APP_URL', () => {
    expect(personalTodoAuthNote('https://aihub.example.com/')).toBe(
      '授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：[点此前往授权](https://aihub.example.com/settings/connector?dingtalkPersonal=authorize)',
    );
    expect(personalTodoAuthNote('')).toBe(
      '授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：[点此前往授权](/settings/connector?dingtalkPersonal=authorize)',
    );
    expect(personalTodoAuthNote(null)).toContain(
      '[点此前往授权](/settings/connector?dingtalkPersonal=authorize)',
    );
    expect(personalTodoAuthNote('https://aihub.example.com', 'dingtalk')).toBe(
      '授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：[点此前往授权](https://aihub.example.com/dingtalk/sso?redirect=%2Fsettings%2Fconnector%3FdingtalkPersonal%3Dauthorize)',
    );
  });
});

describe('DingtalkTodoService', () => {
  const service = new DingtalkTodoService({} as never, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    resetTodoListCacheForTest();
    resetOrgTodoReadGateForTest();
    redisState.store.clear();
    redisState.sets.length = 0;
    mockListPending.mockResolvedValue({ rows: [], truncated: false });
    mockAssertFeature.mockResolvedValue(undefined);
    mockRequireIdentity.mockResolvedValue(identity);
    mockAppend.mockResolvedValue({});
    mockGetPersonalConfig.mockResolvedValue({
      brokerConfigured: false,
      enabled: false,
      features: {
        chat: false,
        docs: false,
        report: false,
        sheets: false,
        todo: false,
        write: false,
      },
    });
    mockPersonalGetStatus.mockReset();
    mockPersonalExec.mockReset();
    mockResolveStaff.mockResolvedValue({
      deptPath: '研发',
      name: '张三',
      staffId: 'staff-me',
      unionId: 'union-me',
    });
  });

  it('listTodos queries org tasks as creator or executor', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest.mockResolvedValueOnce({
      todoCards: [{ isDone: false, subject: '写周报', taskId: 't1' }],
    });
    const result = await service.listTodos({ done: false });
    expect(mockAssertFeature).toHaveBeenCalledWith('todo');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api: 'v1',
        body: { isDone: false, roleTypes: [['creator'], ['executor']] },
        method: 'POST',
        path: '/v1.0/todo/users/union-me/org/tasks/query',
      }),
    );
    expect(result.appTodos).toEqual([
      expect.objectContaining({
        done: false,
        source: 'assistant',
        subject: '写周报',
        taskId: 't1',
      }),
    ]);
    expect(result.orgTodos).toBeUndefined();
    expect(result.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
  });

  it('merges approvals with assistant todos and dedups org cards by taskId', async () => {
    mockListPending.mockResolvedValue({
      rows: [
        {
          createdAt: '2026-09-21 10:00',
          originatorName: '李四',
          processInstanceId: 'pi-1',
          summary: [],
          taskId: 'ap-1',
          title: '请假',
        },
      ],
      truncated: false,
    });
    mockRequest.mockImplementation(
      async (req: { body?: Record<string, unknown>; path?: string }) => {
        const path = String(req.path);
        if (path.includes('/organizations/tasks/query')) {
          expect(req.body).toMatchObject({
            isDone: false,
            maxResults: 20,
            needPersonalTodo: true,
            roleTypes: [['creator'], ['executor']],
          });
          return {
            todoCards: [
              { isDone: false, subject: '助手重复', taskId: 't1' },
              { isDone: false, subject: '客户端待办', taskId: 't2' },
              { isDone: false, subject: '与审批同号', taskId: 'ap-1' },
            ],
          };
        }
        return {
          todoCards: [
            { isDone: false, subject: '助手重复', taskId: 't1' },
            { isDone: false, subject: '助手重复', taskId: 't1' },
          ],
        };
      },
    );

    const result = await service.listTodos({ done: false });

    expect(result.appTodos).toEqual([
      expect.objectContaining({ source: 'assistant', subject: '助手重复', taskId: 't1' }),
    ]);
    expect(result.orgTodos).toEqual([
      expect.objectContaining({ source: 'org', subject: '客户端待办', taskId: 't2' }),
      expect.objectContaining({ source: 'org', subject: '与审批同号', taskId: 'ap-1' }),
    ]);
    expect(result.approvals).toEqual({
      count: 1,
      items: [
        {
          createdAt: '2026-09-21 10:00',
          originatorName: '李四',
          processInstanceId: 'pi-1',
          source: 'approval',
          taskId: 'ap-1',
          title: '请假',
        },
      ],
      truncated: false,
    });
    expect(result.notes).toEqual([]);
    expect(
      mockRequest.mock.calls.filter((call) =>
        String(call[0].path).includes('/organizations/tasks/query'),
      ),
    ).toHaveLength(1);
    expect(redisState.store.get(ORG_TODO_READ_GATE_REDIS_KEY)).toBe('available');
    expect(mockListPending).toHaveBeenCalledWith({ limit: 20, refresh: undefined });
  });

  it('remembers a Custom.Todo.Read 403 for 24h and does not call again', async () => {
    let orgCalls = 0;
    mockRequest.mockImplementation(async (req: { path?: string }) => {
      const path = String(req.path);
      if (path.includes('/organizations/tasks/query')) {
        orgCalls += 1;
        throw new DingtalkWorkspaceError(
          'DINGTALK_FORBIDDEN',
          'Forbidden.AccessDenied.AccessTokenPermissionDenied',
          ['Custom.Todo.Read'],
        );
      }
      return { todoCards: [{ isDone: false, subject: '写周报', taskId: 't1' }] };
    });

    const first = await service.listTodos();
    expect(first.orgTodos).toBeUndefined();
    expect(first.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
    expect(first.appTodos.map((item) => item.source)).toEqual(['assistant']);
    expect(orgCalls).toBe(1);
    expect(redisState.sets).toEqual([
      expect.objectContaining({
        extra: ['EX', ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS, 'NX'],
        key: ORG_TODO_READ_DISCOVER_CLAIM_KEY,
        value: '1',
      }),
      expect.objectContaining({
        extra: ['EX', ORG_TODO_READ_GATE_TTL_SECONDS],
        key: ORG_TODO_READ_GATE_REDIS_KEY,
        value: 'unavailable',
      }),
    ]);

    resetOrgTodoReadGateForTest();
    const second = await service.listTodos({ refresh: true });
    expect(second.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
    expect(orgCalls).toBe(1);
    expect(mockListPending).toHaveBeenLastCalledWith({ limit: 20, refresh: true });
    expect(
      mockRequest.mock.calls.filter((call) =>
        String(call[0].path).includes('/organizations/tasks/query'),
      ),
    ).toHaveLength(1);
  });

  it('single-flights the org read probe so concurrent listTodos share one 403', async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let orgCalls = 0;
    mockRequest.mockImplementation(async (req: { path?: string }) => {
      if (String(req.path).includes('/organizations/tasks/query')) {
        orgCalls += 1;
        await hold;
        throw new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', 'Forbidden', ['Custom.Todo.Read']);
      }
      return { todoCards: [] };
    });

    const pending = Promise.all([
      service.listTodos({ refresh: true }),
      service.listTodos({ refresh: true }),
    ]);
    await vi.waitFor(() => expect(orgCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(orgCalls).toBe(1);
    release();
    const [left, right] = await pending;
    expect(orgCalls).toBe(1);
    expect(left.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
    expect(right.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
    expect(right.orgTodos).toBeUndefined();
  });

  it('misses the merged cache when the verified DingTalk identity changes', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '张三的待办', taskId: 't-zhang' }] });
    const first = await service.listTodos({ done: false });
    expect(first.appTodos[0]?.taskId).toBe('t-zhang');
    expect(mockRequireIdentity).toHaveBeenCalledTimes(1);

    mockRequest.mockClear();
    mockListPending.mockClear();
    const cached = await service.listTodos({ done: false });
    expect(mockRequireIdentity).toHaveBeenCalledTimes(2);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockListPending).not.toHaveBeenCalled();
    expect(cached.appTodos[0]?.taskId).toBe('t-zhang');

    mockRequireIdentity.mockResolvedValue({
      name: '李四',
      staffId: 'staff-li',
      unionId: 'union-li',
    });
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '李四的待办', taskId: 't-li' }] });
    const rebound = await service.listTodos({ done: false });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/v1.0/todo/users/union-li/org/tasks/query' }),
    );
    expect(rebound.appTodos.map((item) => item.taskId)).toEqual(['t-li']);
    expect(rebound.appTodos.some((item) => item.taskId === 't-zhang')).toBe(false);
  });

  it('does not serve a merged cache when DingTalk identity verification fails', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    await service.listTodos();
    mockRequireIdentity.mockRejectedValue(
      new DingtalkWorkspaceError('DINGTALK_IDENTITY_UNVERIFIED'),
    );
    mockRequest.mockClear();
    await expect(service.listTodos()).rejects.toMatchObject({
      code: 'DINGTALK_IDENTITY_UNVERIFIED',
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('skips the org probe when another replica holds the discovery claim', async () => {
    redisState.store.set(ORG_TODO_READ_DISCOVER_CLAIM_KEY, '1');
    mockRequest.mockImplementation(async (req: { path?: string }) => {
      if (String(req.path).includes('/organizations/tasks/query')) {
        throw new Error('org call');
      }
      return { todoCards: [{ subject: '写周报', taskId: 't1' }] };
    });

    const result = await service.listTodos();

    expect(result.appTodos.map((item) => item.taskId)).toEqual(['t1']);
    expect(result.orgTodos).toBeUndefined();
    expect(result.notes).toEqual([]);
    expect(
      mockRequest.mock.calls.filter((call) =>
        String(call[0].path).includes('/organizations/tasks/query'),
      ),
    ).toHaveLength(0);
    expect(redisState.sets).toEqual([
      expect.objectContaining({
        extra: ['EX', ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS, 'NX'],
        key: ORG_TODO_READ_DISCOVER_CLAIM_KEY,
      }),
    ]);
  });

  it('makes no DingTalk calls on a merged cache hit', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    await service.listTodos();
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockListPending).toHaveBeenCalledTimes(1);

    mockRequest.mockClear();
    mockListPending.mockClear();
    const cached = await service.listTodos();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockListPending).not.toHaveBeenCalled();
    expect(cached.appTodos[0]?.taskId).toBe('t1');
    expect(cached.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
  });

  it('drops one user merged cache when personal todo writes invalidate it', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest
      .mockResolvedValueOnce({ todoCards: [{ subject: '旧', taskId: 't0' }] })
      .mockResolvedValueOnce({ todoCards: [{ subject: '新', taskId: 't0' }] });

    await service.listTodos();
    invalidateDingtalkTodoListCache('someone-else');
    const kept = await service.listTodos();
    expect(kept.appTodos[0]?.subject).toBe('旧');

    invalidateDingtalkTodoListCache('user-1');
    const again = await service.listTodos();
    expect(again.appTodos[0]?.subject).toBe('新');
    expect(
      mockRequest.mock.calls.filter((call) => String(call[0].path).includes('/org/tasks/query')),
    ).toHaveLength(2);
  });

  it('does not cache a merged list that overlapped an invalidation', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockRequest.mockImplementation(async () => {
      await hold;
      return { todoCards: [{ subject: '旧', taskId: 't0' }] };
    });

    const pending = service.listTodos();
    await vi.waitFor(() => expect(mockRequest).toHaveBeenCalled());
    invalidateDingtalkTodoListCache('user-1');
    release();
    const first = await pending;
    expect(first.appTodos[0]?.taskId).toBe('t0');

    mockRequest.mockReset();
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '新', taskId: 't1' }] });
    const second = await service.listTodos();
    expect(mockRequest).toHaveBeenCalled();
    expect(second.appTodos.map((item) => item.taskId)).toEqual(['t1']);
  });

  it('drops the merged cache after a todo is created', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest
      .mockResolvedValueOnce({ todoCards: [{ subject: '旧', taskId: 't0' }] })
      .mockResolvedValueOnce({ id: 't-new', subject: '新待办' })
      .mockResolvedValueOnce({ todoCards: [{ subject: '新待办', taskId: 't-new' }] });

    await service.listTodos();
    await service.createTodo({ subject: '新待办' });
    const again = await service.listTodos();

    expect(again.appTodos.map((item) => item.taskId)).toEqual(['t-new']);
    expect(
      mockRequest.mock.calls.filter((call) => String(call[0].path).includes('/org/tasks/query')),
    ).toHaveLength(2);
  });

  it('keeps assistant todos when the approval feature is off', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockListPending.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_FEATURE_DISABLED'));
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    const result = await service.listTodos();
    expect(result.appTodos).toHaveLength(1);
    expect(result.approvals).toEqual({ count: 0, items: [], truncated: false });
    expect(result.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
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
    mockRequest.mockResolvedValueOnce({
      todoCards: [
        {
          dueTime: Date.parse('2026-09-22T18:00:00+08:00'),
          subject: '写周报',
          taskId: 't1',
        },
      ],
    });
    const preview = await service.preview({ apiName: 'deleteTodo', args: { taskId: 't1' } });
    expect(preview.danger).toBe(true);
    expect(preview.title).toBe('删除待办');
    expect(preview.lines).toEqual([
      { label: '待办', value: '写周报' },
      { label: '截止时间', value: '2026-09-22 18:00' },
    ]);
    expect(JSON.stringify(preview.lines)).not.toContain('t1');
  });

  it('preview(updateTodo) resolves the subject from the cached list', async () => {
    mockRequest.mockResolvedValueOnce({
      todoCards: [{ subject: '写周报', taskId: 't1' }],
    });
    const preview = await service.preview({
      apiName: 'updateTodo',
      args: { subject: '改标题', taskId: 't1' },
    });
    expect(preview.lines).toEqual(
      expect.arrayContaining([
        { label: '待办', value: '写周报' },
        { label: '标题', value: '改标题' },
      ]),
    );
    expect(JSON.stringify(preview.lines)).not.toContain('t1');
  });

  it('preview(deleteTodo) reuses the per-user list cache', async () => {
    mockRequest.mockResolvedValue({
      todoCards: [{ subject: '写周报', taskId: 't1' }],
    });
    await service.preview({ apiName: 'deleteTodo', args: { taskId: 't1' } });
    await service.preview({ apiName: 'completeTodo', args: { taskId: 't1' } });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('preview throws DINGTALK_NOT_FOUND for an unknown todo id', async () => {
    mockRequest.mockResolvedValueOnce({ todoCards: [] });
    await expect(
      service.preview({ apiName: 'deleteTodo', args: { taskId: 'missing' } }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_FOUND' });
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

  it('completeTodos writes each id in order, then drops the merged cache once', async () => {
    mockRequest.mockResolvedValue({});
    const before = todoMergedInvalidationCountForTest();
    const result = await service.completeTodos({ taskIds: ['t1', 't2'] });
    expect(result.items).toEqual([
      { id: 't1', ok: true },
      { id: 't2', ok: true },
    ]);
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
        method: 'PUT',
        path: '/v1.0/todo/users/union-me/tasks/t2',
      }),
    );
    expect(todoMergedInvalidationCountForTest()).toBe(before + 1);
    expect(mockAppend).toHaveBeenCalledTimes(2);
  });

  it('stops a todo batch on rate limit and leaves the rest unexecuted', async () => {
    mockRequest
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    const result = await service.completeTodos({ taskIds: ['t1', 't2', 't3'] });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.items.map((item) => item.ok)).toEqual([true, false, false]);
    expect(result.items[1]?.errorCode).toBe('DINGTALK_RATE_LIMITED');
    expect(result.items[2]?.skipped).toBe(true);
    expect(todoMergedInvalidationCountForTest()).toBe(1);
  });

  it('continues a todo batch after a per-item miss', async () => {
    mockRequest
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_NOT_FOUND'))
      .mockResolvedValueOnce({});
    const result = await service.deleteTodos({ taskIds: ['t1', 'missing', 't3'] });
    expect(mockRequest).toHaveBeenCalledTimes(3);
    expect(result.items[1]?.errorCode).toBe('DINGTALK_NOT_FOUND');
    expect(result.items[2]?.ok).toBe(true);
    expect(result.items[2]?.skipped).toBeUndefined();
  });

  it('rejects a duplicate or empty todo batch before any write', async () => {
    await expect(service.completeTodos({ taskIds: ['t1', 't1'] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.completeTodos({ taskIds: [] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.deleteTodos({ taskIds: ['  '] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      service.completeTodos({ taskIds: Array.from({ length: 21 }, (_, index) => `t${index}`) }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('stops the whole todo batch when the feature switch is off', async () => {
    mockAssertFeature.mockRejectedValueOnce(
      new DingtalkWorkspaceError('DINGTALK_FEATURE_DISABLED'),
    );
    const result = await service.completeTodos({ taskIds: ['t1', 't2'] });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(result.items[0]?.errorCode).toBe('DINGTALK_FEATURE_DISABLED');
    expect(result.items[1]?.skipped).toBe(true);
    expect(todoMergedInvalidationCountForTest()).toBe(0);
  });

  it('continues after a per-item forbidden and stops when the app lacks permission', async () => {
    mockRequest
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_FORBIDDEN'))
      .mockResolvedValueOnce({});
    const continued = await service.completeTodos({ taskIds: ['t1', 't2'] });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(continued.items[0]?.errorCode).toBe('DINGTALK_FORBIDDEN');
    expect(continued.items[0]?.applyUrl).toBeUndefined();
    expect(continued.items[1]?.ok).toBe(true);

    mockRequest.mockReset();
    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    mockRequest.mockRejectedValueOnce(
      new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', 'Forbidden', ['Todo.Todo.Write'], applyUrl),
    );
    const stopped = await service.deleteTodos({ taskIds: ['t1', 't2'] });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(stopped.items[0]).toMatchObject({
      applyUrl,
      errorCode: 'DINGTALK_FORBIDDEN',
      id: 't1',
      ok: false,
    });
    expect(stopped.items[1]?.skipped).toBe(true);

    mockRequest.mockReset();
    mockRequest
      .mockRejectedValueOnce(
        new DingtalkWorkspaceError(
          'DINGTALK_FORBIDDEN',
          'Forbidden',
          undefined,
          'https://evil.example/phish',
        ),
      )
      .mockResolvedValueOnce({});
    const phishing = await service.completeTodos({ taskIds: ['t1', 't2'] });
    expect(phishing.items[0]?.applyUrl).toBeUndefined();
    expect(phishing.items[1]?.ok).toBe(true);
  });

  it('stops a todo batch after two consecutive unavailable responses', async () => {
    mockRequest
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'))
      .mockResolvedValueOnce({});
    const once = await service.completeTodos({ taskIds: ['t1', 't2'] });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(once.items[0]?.errorCode).toBe('DINGTALK_UNAVAILABLE');
    expect(once.items[1]?.ok).toBe(true);

    mockRequest.mockReset();
    mockRequest
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'))
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'))
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'));
    const reset = await service.deleteTodos({ taskIds: ['a', 'b', 'c', 'd', 'e'] });
    expect(mockRequest).toHaveBeenCalledTimes(4);
    expect(reset.items.map((item) => item.ok)).toEqual([false, true, false, false, false]);
    expect(reset.items[3]?.errorCode).toBe('DINGTALK_UNAVAILABLE');
    expect(reset.items[4]?.skipped).toBe(true);
    expect(reset.items[4]?.errorCode).toBeUndefined();
  });

  it('fills batch titles from the cached subject, including failed and skipped rows', async () => {
    mockRequest
      .mockResolvedValueOnce({
        todoCards: [
          { isDone: false, subject: '写周报', taskId: 't1' },
          { isDone: false, subject: '对账', taskId: 't2' },
        ],
      })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    await service.preview({ apiName: 'completeTodo', args: { taskId: 't1' } });
    const result = await service.completeTodos({ taskIds: ['t1', 't2', 't3'] });
    expect(result.items[0]).toEqual({ id: 't1', ok: true, title: '写周报' });
    expect(result.items[1]).toMatchObject({
      errorCode: 'DINGTALK_RATE_LIMITED',
      id: 't2',
      ok: false,
      title: '对账',
    });
    expect(result.items[2]).toEqual({ id: 't3', ok: false, skipped: true });
  });

  it('logs an unexpected batch error and still records the item', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRequest.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce({});
    try {
      const result = await service.completeTodos({ taskIds: ['t1', 't2'] });
      expect(result.items[0]?.errorCode).toBe('DINGTALK_INTERNAL');
      expect(result.items[1]?.ok).toBe(true);
      expect(spy).toHaveBeenCalledWith('[dingtalk.todo] batch item failed', {
        code: 'DINGTALK_INTERNAL',
        errorClass: 'Error',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('does not log a domain batch failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRequest.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_NOT_FOUND'));
    try {
      await service.completeTodos({ taskIds: ['t1'] });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps a successful batch item when the audit write throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRequest.mockResolvedValueOnce({});
    mockAppend.mockRejectedValueOnce(new Error('audit down'));
    try {
      const result = await service.completeTodos({ taskIds: ['t1'] });
      expect(result.items).toEqual([{ id: 't1', ok: true }]);
      expect(spy).toHaveBeenCalledWith('[dingtalk.todo] audit append failed', {
        action: 'complete',
        errorClass: 'Error',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('preview(completeTodos) titles the batch and fails if any todo cannot be resolved', async () => {
    mockRequest.mockResolvedValueOnce({
      todoCards: [
        { subject: '写周报', taskId: 't1' },
        { subject: '对账', taskId: 't2' },
      ],
    });
    const preview = await service.preview({
      apiName: 'completeTodos',
      args: { taskIds: ['t1', 't2'] },
    });
    expect(preview.danger).toBe(false);
    expect(preview.title).toBe('完成 2 项待办');
    expect(preview.lines).toEqual([
      { label: '待办', value: '1. 写周报' },
      { label: '待办', value: '2. 对账' },
    ]);
    expect(preview.warnings).toEqual(['仅能查看和编辑通过本应用创建的待办']);
    expect(JSON.stringify(preview.lines)).not.toContain('t1');
    expect(mockRequest).toHaveBeenCalledTimes(1);

    mockRequest.mockResolvedValueOnce({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    await expect(
      service.preview({ apiName: 'deleteTodos', args: { taskIds: ['t1', 'missing'] } }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_FOUND' });
  });

  it('preview(deleteTodos) is dangerous and rejects duplicates before lookup', async () => {
    mockRequest.mockResolvedValueOnce({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    const preview = await service.preview({
      apiName: 'deleteTodos',
      args: { taskIds: ['t1'] },
    });
    expect(preview.danger).toBe(true);
    expect(preview.title).toBe('删除 1 项待办');
    expect(preview.lines).toEqual([{ label: '待办', value: '1. 写周报' }]);
    mockRequest.mockClear();
    await expect(
      service.preview({ apiName: 'completeTodos', args: { taskIds: ['t1', 't1'] } }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects unknown preview api names', async () => {
    await expect(service.preview({ apiName: 'listTodos', args: {} })).rejects.toBeInstanceOf(
      DingtalkWorkspaceError,
    );
  });

  const enablePersonalTodo = () => {
    mockGetPersonalConfig.mockResolvedValue({
      brokerConfigured: true,
      enabled: true,
      features: {
        chat: false,
        docs: false,
        report: false,
        sheets: false,
        todo: true,
        write: false,
      },
    });
  };

  const personalList = (todos: unknown[], hasMore = false) => ({
    data: { count: todos.length, hasMore, page: 1, size: 20, todos },
    ok: true,
    outcome: 'success',
  });

  it('leaves the org note in place when personal todos are off', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    const result = await service.listTodos({ done: false });
    expect(result.personalTodos).toBeUndefined();
    expect(result.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
    expect(mockPersonalGetStatus).not.toHaveBeenCalled();
    expect(mockPersonalExec).not.toHaveBeenCalled();
  });

  it('merges personal todos, keeps the assistant copy, and drops the org note', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    enablePersonalTodo();
    mockPersonalGetStatus.mockResolvedValue({ state: 'authorized' });
    mockRequest.mockResolvedValue({
      todoCards: [{ isDone: false, subject: '写周报', taskId: 't1' }],
    });
    mockPersonalExec.mockResolvedValue(
      personalList(
        [
          {
            dueTime: 1790326800000,
            finalStatusStage: 0,
            priority: 20,
            subject: '个人侧重复',
            taskId: 't1',
          },
          {
            dueTime: null,
            finalStatusStage: 0,
            priority: null,
            subject: '无截止',
            taskId: 't-open',
          },
          {
            dueTime: 1790129842237,
            finalStatusStage: 2,
            priority: 40,
            subject: '测试待办 123',
            taskId: 't-personal',
          },
          {
            dueTime: 1790129842237,
            finalStatusStage: 2,
            priority: 40,
            subject: '重复个人待办',
            taskId: 't-personal',
          },
        ],
        true,
      ),
    );

    const result = await service.listTodos({ done: false });

    expect(mockPersonalExec).toHaveBeenCalledTimes(1);
    expect(mockPersonalExec).toHaveBeenCalledWith('todo.list', {
      page: 1,
      size: 20,
      status: 'open',
    });
    expect(result.appTodos).toEqual([
      expect.objectContaining({ source: 'assistant', subject: '写周报', taskId: 't1' }),
    ]);
    expect(result.personalTodos).toEqual([
      expect.objectContaining({
        done: false,
        source: 'personal',
        stage: 0,
        subject: '无截止',
        taskId: 't-open',
      }),
      expect.objectContaining({
        done: false,
        dueTime: 1790129842237,
        priority: 40,
        source: 'personal',
        stage: 2,
        subject: '测试待办 123',
        taskId: 't-personal',
      }),
    ]);
    expect(result.personalTodos?.[0]).not.toHaveProperty('dueTime');
    expect(result.personalTodos?.[0]).not.toHaveProperty('priority');
    expect(result.notes).toEqual([PERSONAL_TODO_MERGED_NOTE]);
    expect(result.truncated).toBe(true);
    expect(result.orgTodos).toBeUndefined();
  });

  it('keeps an org todo that shares a taskId with a personal todo', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'available');
    enablePersonalTodo();
    mockPersonalGetStatus.mockResolvedValue({ state: 'authorized' });
    mockRequest.mockImplementation(async (req: { path?: string }) => {
      if (String(req.path).includes('/organizations/tasks/query')) {
        return { todoCards: [{ isDone: false, subject: '组织里的', taskId: 't-org' }] };
      }
      return { todoCards: [{ isDone: false, subject: '助手', taskId: 't1' }] };
    });
    mockPersonalExec.mockResolvedValue(
      personalList([
        { finalStatusStage: 0, priority: 20, subject: '组织里的个人副本', taskId: 't-org' },
        { finalStatusStage: 0, priority: 20, subject: '只在个人', taskId: 't-only' },
      ]),
    );

    const result = await service.listTodos({ done: false });

    expect(result.orgTodos).toEqual([
      expect.objectContaining({ source: 'org', subject: '组织里的', taskId: 't-org' }),
    ]);
    expect(result.personalTodos?.map((item) => item.taskId)).toEqual(['t-org', 't-only']);
    expect(result.notes).toEqual([PERSONAL_TODO_MERGED_NOTE]);
  });

  it('asks dws for done todos when done is true', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    enablePersonalTodo();
    mockPersonalGetStatus.mockResolvedValue({ state: 'authorized' });
    mockRequest.mockResolvedValue({ todoCards: [] });
    mockPersonalExec.mockResolvedValue({
      hasMore: false,
      todos: [{ finalStatusStage: 1, isDone: true, subject: '已完成', taskId: 't-done' }],
    });

    const result = await service.listTodos({ done: true });

    expect(mockPersonalExec).toHaveBeenCalledWith('todo.list', {
      page: 1,
      size: 20,
      status: 'done',
    });
    expect(result.personalTodos).toEqual([
      expect.objectContaining({
        done: true,
        source: 'personal',
        subject: '已完成',
        taskId: 't-done',
      }),
    ]);
  });

  it('replaces the org note when personal todos are unauthorized or expired', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    enablePersonalTodo();
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });

    mockPersonalGetStatus.mockResolvedValue({ state: 'unauthorized' });
    const unauthorized = await service.listTodos({ done: false });
    expect(unauthorized.notes).toEqual([personalTodoAuthNote(appEnv.APP_URL)]);
    expect(unauthorized.personalTodos).toBeUndefined();
    expect(mockPersonalExec).not.toHaveBeenCalled();

    resetTodoListCacheForTest();
    mockPersonalGetStatus.mockResolvedValue({ state: 'expired' });
    const expired = await service.listTodos({ done: false });
    expect(expired.notes).toEqual([personalTodoAuthNote(appEnv.APP_URL)]);
    expect(mockPersonalExec).not.toHaveBeenCalled();
  });

  it('does not add an authorize note when org todos are already visible', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'available');
    enablePersonalTodo();
    mockPersonalGetStatus.mockResolvedValue({ state: 'unauthorized' });
    mockRequest.mockImplementation(async (req: { path?: string }) => {
      if (String(req.path).includes('/organizations/tasks/query')) {
        return { todoCards: [{ subject: '客户端待办', taskId: 't2' }] };
      }
      return { todoCards: [{ subject: '写周报', taskId: 't1' }] };
    });

    const result = await service.listTodos({ done: false });

    expect(result.notes).toEqual([]);
    expect(result.orgTodos?.map((item) => item.taskId)).toEqual(['t2']);
    expect(result.personalTodos).toBeUndefined();
    expect(mockPersonalExec).not.toHaveBeenCalled();
  });

  it('keeps assistant todos when the personal read fails', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    enablePersonalTodo();
    mockPersonalGetStatus.mockResolvedValue({ state: 'authorized' });
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    mockPersonalExec.mockRejectedValue(
      Object.assign(new Error('upstream'), { code: 'DINGTALK_PERSONAL_UPSTREAM' }),
    );

    const result = await service.listTodos();

    expect(result.appTodos).toHaveLength(1);
    expect(result.personalTodos).toBeUndefined();
    expect(result.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE, PERSONAL_TODO_ERROR_NOTE]);
  });

  it('swaps the org note when an authorized read comes back unauthorized', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    enablePersonalTodo();
    mockPersonalGetStatus.mockResolvedValue({ state: 'authorized' });
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    mockPersonalExec.mockRejectedValue(
      Object.assign(new Error('expired'), { code: 'DINGTALK_PERSONAL_EXPIRED' }),
    );

    const result = await service.listTodos();

    expect(result.personalTodos).toBeUndefined();
    expect(result.notes).toEqual([personalTodoAuthNote(appEnv.APP_URL)]);
  });

  it('adds a note when personal status cannot be read and still returns todos', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    enablePersonalTodo();
    mockPersonalGetStatus.mockRejectedValue(new Error('db down'));
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });

    const result = await service.listTodos();

    expect(result.appTodos).toHaveLength(1);
    expect(result.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE, PERSONAL_TODO_ERROR_NOTE]);
    expect(mockPersonalExec).not.toHaveBeenCalled();
  });

  it('stays on the legacy list when personal config cannot be loaded', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockGetPersonalConfig.mockRejectedValue(new Error('connector down'));
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });

    const result = await service.listTodos();

    expect(result.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);
    expect(result.personalTodos).toBeUndefined();
    expect(mockPersonalGetStatus).not.toHaveBeenCalled();
    expect(mockPersonalExec).not.toHaveBeenCalled();
  });

  it('does not serve a feature-off cache after the caller authorizes personal todos', async () => {
    redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
    mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
    const first = await service.listTodos({ done: false });
    expect(first.notes).toEqual([ORG_TODO_UNAVAILABLE_NOTE]);

    enablePersonalTodo();
    mockPersonalGetStatus.mockResolvedValue({ state: 'authorized' });
    mockPersonalExec.mockResolvedValue(
      personalList([{ finalStatusStage: 0, priority: 20, subject: '测试待办 123', taskId: 'tp' }]),
    );
    const second = await service.listTodos({ done: false });

    expect(mockPersonalExec).toHaveBeenCalledTimes(1);
    expect(second.personalTodos?.map((item) => item.taskId)).toEqual(['tp']);
    expect(second.notes).toEqual([PERSONAL_TODO_MERGED_NOTE]);
  });

  it('reuses a merged personal list for 5 minutes unless refresh is set', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T08:00:00.000Z'));
    try {
      redisState.store.set(ORG_TODO_READ_GATE_REDIS_KEY, 'unavailable');
      enablePersonalTodo();
      mockPersonalGetStatus.mockResolvedValue({ state: 'authorized' });
      mockRequest.mockResolvedValue({ todoCards: [{ subject: '写周报', taskId: 't1' }] });
      mockPersonalExec.mockResolvedValue(
        personalList([
          { finalStatusStage: 0, priority: 20, subject: '测试待办 123', taskId: 'tp' },
        ]),
      );

      await service.listTodos({ done: false });
      vi.advanceTimersByTime(5 * 60_000 - 1000);
      const cached = await service.listTodos({ done: false });
      expect(cached.personalTodos?.map((item) => item.taskId)).toEqual(['tp']);
      expect(mockPersonalExec).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      await service.listTodos({ done: false });
      expect(mockPersonalExec).toHaveBeenCalledTimes(2);

      const refreshed = await service.listTodos({ done: false, refresh: true });
      expect(refreshed.notes).toEqual([PERSONAL_TODO_MERGED_NOTE]);
      expect(mockPersonalExec).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
