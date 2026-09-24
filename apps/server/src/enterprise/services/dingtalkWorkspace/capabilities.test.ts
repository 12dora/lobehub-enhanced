// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByPlatform = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());
const mockResolveNotifyAppConfig = vi.hoisted(() => vi.fn());
const mockReadNotifyAppFromProviderRow = vi.hoisted(() => vi.fn());
const mockRequest = vi.hoisted(() => vi.fn());
const mockPeekOrgTodoReadGate = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/systemBotProvider', () => ({
  SystemBotProviderModel: { findByPlatform: mockFindByPlatform },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: mockInitWithEnvKey },
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/notifyApp', () => ({
  readNotifyAppFromProviderRow: mockReadNotifyAppFromProviderRow,
  resolveNotifyAppConfig: mockResolveNotifyAppConfig,
}));

vi.mock('./client', () => ({
  dingtalkWorkspaceRequest: (...args: unknown[]) => mockRequest(...args),
}));

vi.mock('./todo/orgReadGate', () => ({
  CUSTOM_TODO_READ_SCOPE: 'Custom.Todo.Read',
  peekOrgTodoReadGate: (...args: unknown[]) => mockPeekOrgTodoReadGate(...args),
}));

const {
  assertDingtalkFeature,
  getDingtalkWorkspaceCapabilities,
  invalidateDingtalkWorkspaceCapabilities,
  peekDingtalkWorkspaceCapabilities,
  probeWorkspacePermissions,
  resetDingtalkWorkspaceCapabilitiesCacheForTest,
} = await import('./capabilities');
const { DingtalkWorkspaceError } = await import('./errors');

describe('dingtalk workspace capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDingtalkWorkspaceCapabilitiesCacheForTest();
    mockGetServerDB.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ staffId: 'staff-1', unionId: 'union-1' }],
          }),
        }),
      }),
    });
    mockInitWithEnvKey.mockResolvedValue({});
    mockFindByPlatform.mockResolvedValue({
      credentials: { notifyAppSecret: 'secret' },
      settings: {
        approvalAutomationTier: 'strict',
        notifyAgentId: '9',
        notifyAppKey: 'key',
        robotCode: 'robot',
        workspaceApprovalEnabled: true,
        workspaceCalendarEnabled: false,
        workspaceTodoEnabled: true,
      },
    });
    mockReadNotifyAppFromProviderRow.mockReturnValue({
      agentId: '9',
      appKey: 'key',
      appSecret: 'secret',
    });
    mockResolveNotifyAppConfig.mockResolvedValue({
      agentId: '9',
      appKey: 'key',
      appSecret: 'secret',
    });
    mockPeekOrgTodoReadGate.mockResolvedValue(undefined);
  });

  it('is on only when the notify app is configured and the switch is on', async () => {
    const caps = await getDingtalkWorkspaceCapabilities();
    expect(caps).toEqual({
      approval: true,
      automationTier: 'strict',
      calendar: false,
      todo: true,
    });
    expect(peekDingtalkWorkspaceCapabilities()).toEqual(caps);
  });

  it('fails closed when the notify app is missing', async () => {
    mockReadNotifyAppFromProviderRow.mockReturnValue(null);
    invalidateDingtalkWorkspaceCapabilities();
    const caps = await getDingtalkWorkspaceCapabilities();
    expect(caps.approval).toBe(false);
    expect(caps.todo).toBe(false);
    await expect(assertDingtalkFeature('approval')).rejects.toMatchObject({
      code: 'DINGTALK_NOT_CONFIGURED',
    });
  });

  it('throws FEATURE_DISABLED when the switch is off', async () => {
    await getDingtalkWorkspaceCapabilities();
    await expect(assertDingtalkFeature('calendar')).rejects.toBeInstanceOf(DingtalkWorkspaceError);
    await expect(assertDingtalkFeature('calendar')).rejects.toMatchObject({
      code: 'DINGTALK_FEATURE_DISABLED',
    });
  });

  it('maps a missing notify app on probe to not_configured', async () => {
    mockResolveNotifyAppConfig.mockResolvedValueOnce(null);
    await expect(probeWorkspacePermissions()).resolves.toEqual({
      approval: { ok: false, reason: 'not_configured' },
      calendar: { ok: false, reason: 'not_configured' },
      todo: { ok: false, reason: 'not_configured' },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('reports missing scopes when a probe is forbidden', async () => {
    mockRequest.mockImplementation(async (req: { path: string }) => {
      if (String(req.path).includes('calendar')) {
        throw new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', 'Forbidden.AccessDenied');
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.approval.ok).toBe(true);
    expect(result.todo.ok).toBe(true);
    expect(result.calendar).toEqual({
      missingScopes: ['Calendar.Event.Read', 'Calendar.Event.Write', 'Calendar.EventSchedule.Read'],
      ok: false,
      reason: 'forbidden',
    });
    expect(
      mockRequest.mock.calls.some((call) => String(call[0].path).includes('/users/union-1')),
    ).toBe(true);
  });

  it('fails calendar when write or schedule scopes are missing even if events read succeeds', async () => {
    mockRequest.mockImplementation(async (req: { method?: string; path: string }) => {
      if (String(req.path).includes('querySchedule')) {
        throw new DingtalkWorkspaceError(
          'DINGTALK_FORBIDDEN',
          'Forbidden.AccessDenied.AccessTokenPermissionDenied',
          ['Calendar.EventSchedule.Read'],
        );
      }
      if (String(req.path).includes('/calendars/primary/events') && req.method === 'POST') {
        throw new DingtalkWorkspaceError(
          'DINGTALK_FORBIDDEN',
          'Forbidden.AccessDenied.AccessTokenPermissionDenied',
          ['Calendar.Event.Write'],
        );
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.calendar).toEqual({
      missingScopes: ['Calendar.Event.Write', 'Calendar.EventSchedule.Read'],
      ok: false,
      reason: 'forbidden',
    });
    expect(result.approval.ok).toBe(true);
    expect(result.todo.ok).toBe(true);
  });

  it('fails todo when the write scope is missing even if the query succeeds', async () => {
    mockRequest.mockImplementation(async (req: { method?: string; path: string }) => {
      if (req.method === 'POST' && String(req.path).endsWith('/tasks')) {
        throw new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', 'Forbidden.AccessDenied');
      }
      if (req.method === 'POST' && String(req.path).endsWith('/processInstances')) {
        throw new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', 'Forbidden.AccessDenied');
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.todo).toEqual({
      missingScopes: ['Todo.Todo.Write'],
      ok: false,
      reason: 'forbidden',
    });
    expect(result.approval).toEqual({
      missingScopes: ['Workflow.Instance.Write'],
      ok: false,
      reason: 'forbidden',
    });
  });

  it('uses parsed scope codes from a 403 and falls back to the static list', async () => {
    mockRequest.mockImplementation(async (req: { method?: string; path: string }) => {
      if (String(req.path).includes('/calendars/primary/events') && req.method === 'POST') {
        throw new DingtalkWorkspaceError(
          'DINGTALK_FORBIDDEN',
          'Forbidden.AccessDenied.AccessTokenPermissionDenied',
          ['Calendar.Event.Write'],
        );
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.calendar).toEqual({
      missingScopes: ['Calendar.Event.Write'],
      ok: false,
      reason: 'forbidden',
    });
  });

  it('keeps the DingTalk apply URL next to the missing scopes', async () => {
    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    mockRequest.mockImplementation(async (req: { method?: string; path: string }) => {
      if (String(req.path).includes('/calendars/primary/events') && req.method === 'POST') {
        throw new DingtalkWorkspaceError(
          'DINGTALK_FORBIDDEN',
          'Forbidden.AccessDenied.AccessTokenPermissionDenied',
          ['Calendar.Event.Write'],
          applyUrl,
        );
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.calendar).toEqual({
      applyUrl,
      missingScopes: ['Calendar.Event.Write'],
      ok: false,
      reason: 'forbidden',
    });
  });

  it('does not probe when no active directory user exists', async () => {
    mockGetServerDB.mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    });
    mockRequest.mockResolvedValue({});
    const result = await probeWorkspacePermissions();
    expect(result.approval).toEqual({ ok: false, reason: 'unreachable' });
    expect(result.todo).toEqual({ ok: false, reason: 'unreachable' });
    expect(result.calendar).toEqual({ ok: false, reason: 'unreachable' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('probes approval with staffId and omits empty nextToken on todo', async () => {
    mockRequest.mockResolvedValue({});
    await probeWorkspacePermissions();

    const approval = mockRequest.mock.calls.find((call) =>
      String(call[0].path).includes('userVisibilities/templates'),
    )?.[0];
    expect(approval?.query).toEqual({ userId: 'staff-1', maxResults: 1, nextToken: 0 });

    const todoQuery = mockRequest.mock.calls.find((call) =>
      String(call[0].path).includes('/org/tasks/query'),
    )?.[0];
    expect(todoQuery?.body).toEqual({ isDone: false });
    expect(todoQuery?.body).not.toHaveProperty('nextToken');
  });

  it('maps NOT_FOUND and INVALID on required reads to unreachable', async () => {
    mockRequest.mockImplementation(async (req: { method?: string; path: string }) => {
      if (String(req.path).includes('/org/tasks/query')) {
        throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
      }
      if (String(req.path).includes('/calendars/primary/events') && req.method === 'GET') {
        throw new DingtalkWorkspaceError('DINGTALK_INVALID');
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.approval.ok).toBe(true);
    expect(result.todo).toEqual({ ok: false, reason: 'unreachable' });
    expect(result.calendar).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('treats empty-body write 400/404 as scope present and never sends a filled body', async () => {
    mockRequest.mockImplementation(
      async (req: { body?: unknown; method?: string; path: string }) => {
        const body = req.body && typeof req.body === 'object' ? req.body : null;
        const isEmptyWrite =
          req.method === 'POST' && body !== null && !('isDone' in body) && !('userIds' in body);
        if (isEmptyWrite) {
          expect(JSON.stringify(req.body)).toBe('{}');
          throw new DingtalkWorkspaceError('DINGTALK_INVALID', 'InvalidParameter');
        }
        return {};
      },
    );
    const result = await probeWorkspacePermissions();
    expect(result.approval).toEqual({ ok: true });
    expect(result.todo).toEqual({ ok: true });
    expect(result.calendar).toEqual({ ok: true });

    const writeBodies = mockRequest.mock.calls
      .map((call) => call[0])
      .filter(
        (req: { body?: unknown; method?: string; path: string }) =>
          req.method === 'POST' &&
          (String(req.path).endsWith('/processInstances') ||
            String(req.path).endsWith('/tasks') ||
            String(req.path).endsWith('/events')),
      )
      .map((req: { body?: unknown }) => req.body);
    expect(writeBodies).toEqual([{}, {}, {}]);
  });

  it('keeps calendar ok when only rooms is forbidden, listing the rooms scope as a warning', async () => {
    mockRequest.mockImplementation(async (req: { path: string }) => {
      if (String(req.path).includes('/rooms/meetingRoomLists')) {
        throw new DingtalkWorkspaceError(
          'DINGTALK_FORBIDDEN',
          'Forbidden.AccessDenied.AccessTokenPermissionDenied',
          ['VideoConference.Conference.Read'],
        );
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.calendar).toEqual({
      missingScopes: ['VideoConference.Conference.Read'],
      ok: true,
    });
    expect(result.approval.ok).toBe(true);
    expect(result.todo.ok).toBe(true);
  });

  it('ignores rate-limited or unavailable write sub-probes without failing the capability', async () => {
    mockRequest.mockImplementation(async (req: { method?: string; path: string }) => {
      if (req.method === 'POST' && String(req.path).endsWith('/processInstances')) {
        throw new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED', 'QpsLimitForApi');
      }
      if (req.method === 'POST' && String(req.path).endsWith('/tasks')) {
        throw new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.approval).toEqual({ ok: true });
    expect(result.todo).toEqual({ ok: true });
  });

  it('runs sub-probes sequentially per capability and covers every required scope', async () => {
    mockRequest.mockResolvedValue({});
    await probeWorkspacePermissions();

    const byCapability = (predicate: (path: string, method: string) => boolean) =>
      mockRequest.mock.calls
        .map((call) => call[0] as { method: string; path: string; body?: unknown; query?: unknown })
        .filter((req) => predicate(String(req.path), req.method));

    const approval = byCapability(
      (path) => path.includes('userVisibilities/templates') || path.endsWith('/processInstances'),
    );
    expect(approval.map((req) => `${req.method} ${req.path}`)).toEqual([
      'GET /v1.0/workflow/processes/userVisibilities/templates',
      'POST /v1.0/workflow/processInstances',
    ]);
    expect(JSON.stringify(approval[1]?.body)).toBe('{}');

    const todo = byCapability((path) => path.includes('/todo/'));
    expect(todo.map((req) => `${req.method} ${req.path}`)).toEqual([
      'POST /v1.0/todo/users/union-1/org/tasks/query',
      'POST /v1.0/todo/users/union-1/tasks',
    ]);
    expect(JSON.stringify(todo[1]?.body)).toBe('{}');

    const calendar = byCapability(
      (path) => path.includes('/calendar/') || path.includes('/rooms/meetingRoomLists'),
    );
    expect(calendar.map((req) => `${req.method} ${req.path}`)).toEqual([
      'GET /v1.0/calendar/users/union-1/calendars/primary/events',
      'POST /v1.0/calendar/users/union-1/calendars/primary/events',
      'POST /v1.0/calendar/users/union-1/querySchedule',
      'GET /v1.0/rooms/meetingRoomLists',
    ]);
    expect(JSON.stringify(calendar[1]?.body)).toBe('{}');
    const schedule = calendar[2];
    expect(schedule?.body).toMatchObject({ userIds: ['union-1'] });
    const start = Date.parse((schedule?.body as { startTime: string }).startTime);
    const end = Date.parse((schedule?.body as { endTime: string }).endTime);
    expect(end - start).toBe(60 * 60_000);
    expect(calendar[3]?.query).toEqual({ maxResults: 1, unionId: 'union-1' });
  });

  it('reports Custom.Todo.Read as optional from the cached gate and does not call DingTalk for it', async () => {
    mockPeekOrgTodoReadGate.mockResolvedValue('unavailable');
    mockRequest.mockResolvedValue({});
    const unavailable = await probeWorkspacePermissions();
    expect(unavailable.todo).toEqual({
      missingScopes: ['Custom.Todo.Read'],
      ok: true,
    });
    expect(
      mockRequest.mock.calls.filter((call) =>
        String(call[0].path).includes('/organizations/tasks/query'),
      ),
    ).toHaveLength(0);

    mockRequest.mockClear();
    mockPeekOrgTodoReadGate.mockResolvedValue('available');
    const available = await probeWorkspacePermissions();
    expect(available.todo).toEqual({ ok: true });
    expect(
      mockRequest.mock.calls.filter((call) =>
        String(call[0].path).includes('/organizations/tasks/query'),
      ),
    ).toHaveLength(0);

    mockPeekOrgTodoReadGate.mockResolvedValue(undefined);
    const unknown = await probeWorkspacePermissions();
    expect(unknown.todo.missingScopes).toBeUndefined();
    expect(unknown.todo.ok).toBe(true);
  });
});
