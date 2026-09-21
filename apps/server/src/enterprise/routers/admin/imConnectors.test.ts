// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import type { LobeChatDatabase } from '@/database/type';
import { createCallerFactory } from '@/libs/trpc/lambda';

import { ImConnectorPlatformUserAlreadyBoundError } from '../../services/imConnectors/bindings';
import { createAdminAuthorizationFixture } from '../../testing/adminAuthorizationFixture';
import { adminRouter } from '../admin';

const db: LobeChatDatabase = await getTestDB();
const createCaller = createCallerFactory(adminRouter);
const fixture = createAdminAuthorizationFixture({ namespace: 'im-connectors' });

const serviceMocks = vi.hoisted(() => ({
  directoryStatus: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listBindings: vi.fn(),
  probeWorkspacePermissions: vi.fn(),
  removeBinding: vi.fn(),
  syncDirectory: vi.fn(),
  test: vi.fn(),
  testNotifyApp: vi.fn(),
  upsert: vi.fn(),
  upsertBinding: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => db) }));

vi.mock('../../services/imConnectors/service', () => ({
  ImConnectorsAdminService: class {
    directoryStatus = serviceMocks.directoryStatus;
    get = serviceMocks.get;
    list = serviceMocks.list;
    listBindings = serviceMocks.listBindings;
    probeWorkspacePermissions = serviceMocks.probeWorkspacePermissions;
    removeBinding = serviceMocks.removeBinding;
    syncDirectory = serviceMocks.syncDirectory;
    test = serviceMocks.test;
    testNotifyApp = serviceMocks.testNotifyApp;
    upsert = serviceMocks.upsert;
    upsertBinding = serviceMocks.upsertBinding;
  },
}));

const sampleView = {
  approvalAutomationTier: 'moderate' as const,
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: null,
  clientSecretFingerprint: null,
  configured: false,
  enabled: false,
  hasClientSecret: false,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  notifyAgentId: null,
  notifyAppKey: null,
  notifyAppSecretSet: false,
  notifyRobotEnabled: true,
  notifyWorkNoticeEnabled: true,
  platform: 'dingtalk' as const,
  pushEnabled: true,
  robotCode: null,
  selectCardTemplateId: null,
  stats: { linkedUsers: 0, messages7d: 0, pushes7d: 0 },
  status: {
    connectedAt: null,
    lastError: null,
    lastErrorAt: null,
    lastEventAt: null,
    state: 'unknown' as const,
  },
  updatedAt: null,
  workspaceApprovalEnabled: false,
  workspaceCalendarEnabled: false,
  workspaceTodoEnabled: false,
};

const sampleBinding = {
  createdAt: '2026-09-16T00:00:00.000Z',
  platformUserId: 'staff_1',
  platformUsername: 'Alice',
  source: 'manual' as const,
  userEmail: 'admin@jiefakj.com',
  userId: 'user_admin',
  userName: 'Break Glass',
};

beforeAll(async () => {
  vi.stubEnv('ENABLE_PLATFORM_ADMIN', '1');
  await fixture.setup(db);
});

afterAll(async () => {
  await fixture.cleanup(db);
  vi.unstubAllEnvs();
});

beforeEach(() => {
  serviceMocks.get.mockReset().mockResolvedValue(sampleView);
  serviceMocks.list.mockReset().mockResolvedValue({ items: [sampleView] });
  serviceMocks.test.mockReset().mockResolvedValue({
    errorCode: null,
    errorMessage: null,
    latencyMs: 8,
    ok: true,
    robotName: null,
  });
  serviceMocks.upsert.mockReset().mockResolvedValue({ ...sampleView, configured: true });
  serviceMocks.listBindings.mockReset().mockResolvedValue({
    hasMore: false,
    items: [sampleBinding],
    total: 1,
  });
  serviceMocks.upsertBinding.mockReset().mockResolvedValue(sampleBinding);
  serviceMocks.removeBinding.mockReset().mockResolvedValue({ success: true });
  serviceMocks.directoryStatus.mockReset().mockResolvedValue({
    departments: 3,
    lastError: null,
    lastRunAt: '2026-09-16T04:00:00.000Z',
    state: 'ok',
    users: 12,
  });
  serviceMocks.syncDirectory.mockReset().mockResolvedValue({
    departments: 3,
    lastError: null,
    lastRunAt: '2026-09-16T04:00:00.000Z',
    state: 'ok',
    users: 12,
  });
  serviceMocks.testNotifyApp.mockReset().mockResolvedValue({
    errorCode: null,
    errorMessage: null,
    latencyMs: 9,
    ok: true,
    robotName: null,
  });
  serviceMocks.probeWorkspacePermissions.mockReset().mockResolvedValue({
    approval: { ok: true },
    calendar: { ok: true },
    todo: { ok: true },
  });
});

const callerFor = async (principal: 'auditor' | 'normal' | 'superAdmin') => {
  const contexts = await fixture.createContexts(db);
  return createCaller(contexts[principal] as never).imConnectors;
};

describe('admin.imConnectors permission gating', () => {
  it('denies list/get/upsert/test for a user without system permissions', async () => {
    const denied = await callerFor('normal');

    await expect(denied.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.get({ platform: 'dingtalk' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(
      denied.upsert({
        aiCardTemplateId: null,
        chatEnabled: true,
        clientId: 'app',
        clientSecret: { action: 'replace', value: 'secret' },
        enabled: true,
        idleNewTopicEnabled: true,
        idleNewTopicHours: 24,
        platform: 'dingtalk',
        pushEnabled: true,
        robotCode: 'robot',
        selectCardTemplateId: null,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.test({ platform: 'dingtalk' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.bindings.list({ platform: 'dingtalk' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(
      denied.bindings.upsert({
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        userId: 'user_admin',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(
      denied.bindings.remove({ platform: 'dingtalk', userId: 'user_admin' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.directoryStatus()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.syncDirectory()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.testNotifyApp()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.probeWorkspacePermissions()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    expect(serviceMocks.list).not.toHaveBeenCalled();
    expect(serviceMocks.upsert).not.toHaveBeenCalled();
    expect(serviceMocks.test).not.toHaveBeenCalled();
    expect(serviceMocks.listBindings).not.toHaveBeenCalled();
    expect(serviceMocks.upsertBinding).not.toHaveBeenCalled();
    expect(serviceMocks.removeBinding).not.toHaveBeenCalled();
  });

  it('allows SYSTEM_READ list/get but not SYSTEM_OPERATE upsert/test', async () => {
    const reader = await callerFor('auditor');

    await expect(reader.list()).resolves.toEqual({ items: [sampleView] });
    await expect(reader.get({ platform: 'dingtalk' })).resolves.toEqual(sampleView);
    await expect(
      reader.upsert({
        aiCardTemplateId: null,
        chatEnabled: true,
        clientId: 'app',
        clientSecret: { action: 'replace', value: 'secret' },
        enabled: true,
        idleNewTopicEnabled: true,
        idleNewTopicHours: 24,
        platform: 'dingtalk',
        pushEnabled: true,
        robotCode: 'robot',
        selectCardTemplateId: null,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(reader.test({ platform: 'dingtalk' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(reader.bindings.list({ platform: 'dingtalk' })).resolves.toEqual({
      hasMore: false,
      items: [sampleBinding],
      total: 1,
    });
    await expect(
      reader.bindings.upsert({
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        userId: 'user_admin',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(
      reader.bindings.remove({ platform: 'dingtalk', userId: 'user_admin' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(reader.directoryStatus()).resolves.toMatchObject({ state: 'ok', users: 12 });
    await expect(reader.syncDirectory()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(reader.testNotifyApp()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(reader.probeWorkspacePermissions()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    expect(serviceMocks.upsert).not.toHaveBeenCalled();
    expect(serviceMocks.test).not.toHaveBeenCalled();
    expect(serviceMocks.upsertBinding).not.toHaveBeenCalled();
    expect(serviceMocks.removeBinding).not.toHaveBeenCalled();
  });

  it('allows SYSTEM_OPERATE upsert and test for a super admin', async () => {
    const operator = await callerFor('superAdmin');

    await expect(operator.list()).resolves.toEqual({ items: [sampleView] });
    await expect(
      operator.upsert({
        aiCardTemplateId: null,
        chatEnabled: true,
        clientId: 'app',
        clientSecret: { action: 'replace', value: 'secret' },
        enabled: true,
        idleNewTopicEnabled: true,
        idleNewTopicHours: 24,
        platform: 'dingtalk',
        pushEnabled: true,
        reason: 'provision dingtalk',
        robotCode: 'robot',
        selectCardTemplateId: null,
      }),
    ).resolves.toMatchObject({ configured: true });
    await expect(operator.test({ platform: 'dingtalk' })).resolves.toMatchObject({ ok: true });
    await expect(operator.syncDirectory()).resolves.toMatchObject({ state: 'ok' });
    await expect(
      operator.testNotifyApp({ notifyAppKey: 'k', notifyAppSecret: 's' }),
    ).resolves.toMatchObject({ ok: true });
    await expect(operator.probeWorkspacePermissions()).resolves.toMatchObject({
      approval: { ok: true },
    });
    expect(serviceMocks.upsert).toHaveBeenCalled();
    expect(serviceMocks.test).toHaveBeenCalled();
    expect(serviceMocks.syncDirectory).toHaveBeenCalled();
    expect(serviceMocks.testNotifyApp).toHaveBeenCalled();
  });

  it('allows SYSTEM_OPERATE binding upsert/remove for a super admin', async () => {
    const operator = await callerFor('superAdmin');

    await expect(operator.bindings.list({ platform: 'dingtalk' })).resolves.toEqual({
      hasMore: false,
      items: [sampleBinding],
      total: 1,
    });
    await expect(
      operator.bindings.upsert({
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        userId: 'user_admin',
      }),
    ).resolves.toEqual(sampleBinding);
    await expect(
      operator.bindings.remove({ platform: 'dingtalk', userId: 'user_admin' }),
    ).resolves.toEqual({ success: true });
    expect(serviceMocks.upsertBinding).toHaveBeenCalled();
    expect(serviceMocks.removeBinding).toHaveBeenCalled();
  });

  it('rejects an overlong DingTalk userId before the service runs', async () => {
    const operator = await callerFor('superAdmin');

    await expect(
      operator.bindings.upsert({
        platform: 'dingtalk',
        platformUserId: 'x'.repeat(65),
        userId: 'user_admin',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(serviceMocks.upsertBinding).not.toHaveBeenCalled();
  });

  it('maps PLATFORM_USER_ALREADY_BOUND with the other user named in the error', async () => {
    serviceMocks.upsertBinding.mockRejectedValueOnce(
      new ImConnectorPlatformUserAlreadyBoundError({
        boundVia: 'link',
        email: 'alice@dingtalk.jiefakj.com',
        id: 'user_alice',
        name: 'Alice',
      }),
    );
    const operator = await callerFor('superAdmin');

    await expect(
      operator.bindings.upsert({
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        userId: 'user_admin',
      }),
    ).rejects.toMatchObject({
      cause: {
        data: {
          details: {
            boundUserEmail: 'alice@dingtalk.jiefakj.com',
            boundUserId: 'user_alice',
            boundUserName: 'Alice',
            boundVia: 'link',
          },
        },
      },
      code: 'CONFLICT',
      message: 'PLATFORM_USER_ALREADY_BOUND',
    });
  });
});
