// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByPlatform = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());
const mockResolveNotifyAppConfig = vi.hoisted(() => vi.fn());
const mockReadNotifyAppFromProviderRow = vi.hoisted(() => vi.fn());
const mockRequest = vi.hoisted(() => vi.fn());

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
      missingScopes: ['Calendar.Event.Read'],
      ok: false,
      reason: 'forbidden',
    });
    expect(
      mockRequest.mock.calls.some((call) => String(call[0].path).includes('/users/union-1')),
    ).toBe(true);
  });

  it('does not probe todo or calendar with a dummy id when no active directory user exists', async () => {
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
    expect(result.approval.ok).toBe(true);
    expect(result.todo).toEqual({ ok: false, reason: 'unreachable' });
    expect(result.calendar).toEqual({ ok: false, reason: 'unreachable' });
    expect(mockRequest.mock.calls.every((call) => !String(call[0].path).includes('/users/0'))).toBe(
      true,
    );
  });

  it('maps NOT_FOUND and INVALID probes to unreachable', async () => {
    mockRequest.mockImplementation(async (req: { path: string }) => {
      if (String(req.path).includes('todo')) {
        throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
      }
      if (String(req.path).includes('calendar')) {
        throw new DingtalkWorkspaceError('DINGTALK_INVALID');
      }
      return {};
    });
    const result = await probeWorkspacePermissions();
    expect(result.approval.ok).toBe(true);
    expect(result.todo).toEqual({ ok: false, reason: 'unreachable' });
    expect(result.calendar).toEqual({ ok: false, reason: 'unreachable' });
  });
});
