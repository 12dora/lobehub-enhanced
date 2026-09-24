// @vitest-environment node
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { getTestDB } from '@/database/core/getTestDB';
import { platformAuditLogs, platformStatusSettings, users } from '@/database/schemas';
import { permissions, rolePermissions, roles, userRoles } from '@/database/schemas/rbac';
import type { LobeChatDatabase } from '@/database/type';
import { seedPlatformRoles } from '@/database/utils/seedPlatformRoles';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import * as runtimeBranding from '@/server/enterprise/services/branding/runtimeBranding';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type * as NotifyAppModule from '@/server/services/messenger/platforms/dingtalk/notifyApp';
import {
  resolveNotifyAppConfig,
  sendWorkNotice,
} from '@/server/services/messenger/platforms/dingtalk/notifyApp';
import { DEFAULT_STATUS_ALERT_SETTINGS } from '@/types/platform/statusAlerts';

import * as identity from '../../services/dingtalkWorkspace/identity';
import * as infraSnapshot from '../../services/infraSettings/snapshot';
import * as moduleSettings from '../../services/moduleSettings';
import { deletePlatformAuditLogsForTest } from '../../testing/deletePlatformAuditLogs';
import { seedLiveActorSession } from '../../testing/seedLiveActorSession';
import { adminSystemAlertsRouter } from './system.alerts';

vi.mock('@/server/services/messenger/platforms/dingtalk/notifyApp', async (importOriginal) => {
  const actual = await importOriginal<typeof NotifyAppModule>();
  return {
    ...actual,
    resolveNotifyAppConfig: vi.fn(async () => ({ agentId: '1', appKey: 'k', appSecret: 's' })),
    sendWorkNotice: vi.fn(async () => []),
  };
});

const dbHolder = vi.hoisted(() => ({ current: null as LobeChatDatabase | null }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => {
    if (!dbHolder.current) throw new Error('test db is not ready');
    return dbHolder.current;
  }),
}));

const db: LobeChatDatabase = await getTestDB();
dbHolder.current = db;
const createCaller = createCallerFactory(adminSystemAlertsRouter);
const ids = {
  banned: 'sa-alert-banned',
  bound: 'sa-alert-bound',
  operator: 'sa-alert-operator',
  reader: 'sa-alert-reader',
  unrelated: 'sa-alert-unrelated',
};
const roleNames = ['sa_alert_operator', 'sa_alert_reader'];
const secret = 'super-robot-secret';
const webhook = 'https://oapi.dingtalk.com/robot/send?access_token=super-token-value';

const encrypt = vi.fn(async (value: string) => `enc:${value}`);
const decrypt = vi.fn(async (value: string) => ({
  plaintext: value.startsWith('enc:') ? value.slice(4) : value,
  wasAuthentic: true,
}));

const cleanup = async () => {
  await db.delete(platformStatusSettings);
  await deletePlatformAuditLogsForTest(db, { actorUserIds: Object.values(ids) });
  const ownedRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.name, roleNames));
  if (ownedRoles.length > 0) {
    const roleIds = ownedRoles.map(({ id }) => id);
    await db.delete(userRoles).where(inArray(userRoles.roleId, roleIds));
    await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
    await db.delete(roles).where(inArray(roles.id, roleIds));
  }
  await db.delete(users).where(sql`${users.id} LIKE 'sa-alert-%'`);
};

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('ENABLE_DATABASE_OIDC', '1');
  vi.stubEnv('ENABLE_PLATFORM_ADMIN', '1');
  encrypt.mockClear();
  decrypt.mockClear();
  vi.spyOn(KeyVaultsGateKeeper, 'initWithEnvKey').mockResolvedValue({
    decrypt,
    encrypt,
  } as never);
  vi.spyOn(infraSnapshot, 'getInfraSnapshot').mockResolvedValue({
    mail: { kind: 'unconfigured' },
  } as never);
  vi.spyOn(moduleSettings, 'isModuleEnabled').mockResolvedValue(true);
  vi.spyOn(runtimeBranding, 'resolveServerRuntimeBranding').mockResolvedValue({
    name: '示例平台',
  } as never);
  vi.mocked(sendWorkNotice).mockClear();
  vi.mocked(sendWorkNotice).mockResolvedValue([]);
  vi.mocked(resolveNotifyAppConfig).mockResolvedValue({
    agentId: '1',
    appKey: 'k',
    appSecret: 's',
  });
  vi.spyOn(identity, 'resolveVerifiedDingtalkIdentity').mockImplementation(async (_db, userId) =>
    userId === ids.bound
      ? { name: '已绑定', staffId: 'staff-1', unionId: 'union-1' }
      : { error: 'DINGTALK_IDENTITY_UNBOUND' },
  );
  await cleanup();
  await db.insert(users).values(
    Object.values(ids).map((id) => ({
      banned: id === ids.banned,
      fullName: id === ids.bound ? '已绑定用户' : id === ids.banned ? '已停用用户' : id,
      id,
    })),
  );
  await seedPlatformRoles(db);
  await grant(ids.operator, 'sa_alert_operator', [
    PLATFORM_PERMISSIONS.SYSTEM_OPERATE,
    PLATFORM_PERMISSIONS.SYSTEM_READ,
  ]);
  await grant(ids.reader, 'sa_alert_reader', [PLATFORM_PERMISSIONS.SYSTEM_READ]);
});

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const grant = async (userId: string, roleName: string, codes: string[]) => {
  const [role] = await db
    .insert(roles)
    .values({ displayName: roleName, name: roleName })
    .returning();
  const granted = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, codes));
  await db
    .insert(rolePermissions)
    .values(granted.map(({ id }) => ({ permissionId: id, roleId: role.id })));
  await db.insert(userRoles).values({ roleId: role.id, userId, workspaceId: null });
};

const callerFor = async (userId: string) => {
  const sessionId = await seedLiveActorSession(db, { sessionId: `session-${userId}`, userId });
  const context = await createContextInner({
    authenticatedAt: new Date(),
    authMethod: 'better-auth',
    sessionId,
    userId,
  });
  return createCaller({ ...context, serverDB: db } as never);
};

const robotSettings = {
  ...DEFAULT_STATUS_ALERT_SETTINGS,
  channels: {
    ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
    dingtalkRobot: { enabled: true, keyword: '状态', webhookUrl: webhook },
    workNotice: {
      ...DEFAULT_STATUS_ALERT_SETTINGS.channels.workNotice,
      recipientMode: 'users' as const,
      userIds: [ids.bound],
    },
  },
};

describe('admin.system.alerts', () => {
  it('lets a reader load defaults and denies an unrelated user', async () => {
    const reader = await callerFor(ids.reader);
    const view = await reader.get();
    expect(view).toMatchObject({
      dingtalkRobotSecretSet: false,
      envDisabled: false,
      mailConfigured: false,
      notifyAppConfigured: true,
      revision: 0,
      settings: DEFAULT_STATUS_ALERT_SETTINGS,
      updatedAt: null,
    });
    expect(view.effectiveDingtalkApiDailyThreshold).toBeGreaterThan(0);

    const unrelated = await callerFor(ids.unrelated);
    await expect(unrelated.get()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(
      reader.update({ expectedRevision: 0, settings: DEFAULT_STATUS_ALERT_SETTINGS }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'PLATFORM_PERMISSION_DENIED' });
    await expect(reader.test({ channel: 'email' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
  });

  it('rejects a bad webhook, too many emails, an unknown role, and a missing user', async () => {
    const operator = await callerFor(ids.operator);
    await expect(
      operator.update({
        expectedRevision: 0,
        settings: {
          ...DEFAULT_STATUS_ALERT_SETTINGS,
          channels: {
            ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
            dingtalkRobot: {
              enabled: true,
              keyword: null,
              webhookUrl: 'https://example.com/hook',
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      operator.update({
        expectedRevision: 0,
        settings: {
          ...DEFAULT_STATUS_ALERT_SETTINGS,
          channels: {
            ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
            workNotice: {
              ...DEFAULT_STATUS_ALERT_SETTINGS.channels.workNotice,
              recipientMode: 'users',
              userIds: ['sa-alert-missing'],
            },
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '工作通知已启用，请至少选择一位接收人',
    });
  });

  it('stores an encrypted robot secret, never returns it, and audits without the token', async () => {
    const operator = await callerFor(ids.operator);
    const saved = await operator.update({
      expectedRevision: 0,
      robotSecret: { action: 'replace', value: secret },
      settings: robotSettings,
    });
    expect(saved.revision).toBe(1);
    expect(saved.dingtalkRobotSecretSet).toBe(true);
    expect(saved.settings.channels.dingtalkRobot.webhookUrl).toBeNull();
    expect(saved.dingtalkRobotWebhook.set).toBe(true);
    expect(saved.dingtalkRobotWebhook.hint).toBe(
      'https://oapi.dingtalk.com/robot/send?access_token=…alue',
    );
    expect(saved.recipientUsers).toEqual([
      {
        avatar: null,
        banned: false,
        dingtalkBound: true,
        id: ids.bound,
        name: '已绑定用户',
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(encrypt).toHaveBeenCalledWith(secret);
    expect(encrypt).toHaveBeenCalledWith(webhook);

    const [row] = await db.select().from(platformStatusSettings);
    expect(row?.robotSecret).toBe(`enc:${secret}`);
    expect(row?.robotWebhook).toBe(`enc:${webhook}`);
    expect(row?.config).toMatchObject({
      channels: { dingtalkRobot: { webhookUrl: null } },
    });

    const [log] = await db
      .select()
      .from(platformAuditLogs)
      .where(eq(platformAuditLogs.action, 'admin.system.alerts.update'));
    expect(log?.result).toBe('success');
    expect(JSON.stringify(log?.afterDiff)).not.toContain(secret);
    expect(JSON.stringify(log?.afterDiff)).not.toContain('super-token-value');
    expect(log?.afterDiff).toMatchObject({
      channels: { dingtalkRobot: { webhookSet: true, keywordSet: true } },
      signKeyAction: 'replace',
      webhookAction: 'replace',
    });

    const kept = await operator.update({
      expectedRevision: 1,
      robotSecret: { action: 'keep' },
      settings: robotSettings,
    });
    expect(kept.dingtalkRobotSecretSet).toBe(true);
    expect(encrypt).toHaveBeenCalledTimes(2);

    await expect(
      operator.update({
        expectedRevision: 1,
        settings: robotSettings,
      }),
    ).rejects.toMatchObject({ message: 'PLATFORM_REVISION_CONFLICT' });

    const cleared = await operator.update({
      expectedRevision: 2,
      robotSecret: { action: 'clear' },
      settings: robotSettings,
    });
    expect(cleared.dingtalkRobotSecretSet).toBe(false);
    expect(JSON.stringify(cleared)).not.toContain(secret);
  });

  it('tests a channel from stored settings and skips email when mail is not configured', async () => {
    const operator = await callerFor(ids.operator);
    await operator.update({
      expectedRevision: 0,
      settings: {
        ...robotSettings,
        channels: {
          ...robotSettings.channels,
          email: { enabled: true, recipients: ['ops@example.com'] },
        },
      },
    });

    const email = await operator.test({ channel: 'email' });
    expect(email).toEqual({ delivered: 0, error: '邮件服务未配置', ok: false });
    expect(JSON.stringify(email)).not.toContain(secret);

    const notice = await operator.test({ channel: 'workNotice' });
    expect(notice).toEqual({ delivered: 1, error: null, ok: true });
    expect(sendWorkNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.objectContaining({ title: '示例平台状态告警' }),
        staffIds: ['staff-1'],
      }),
    );
    const noticeBody = JSON.stringify(vi.mocked(sendWorkNotice).mock.calls);
    expect(noticeBody).not.toContain(secret);
    expect(noticeBody).not.toContain('super-token-value');

    const logs = await db
      .select()
      .from(platformAuditLogs)
      .where(eq(platformAuditLogs.action, 'admin.system.alerts.test'));
    expect(logs.map((item) => item.result).sort()).toEqual(['failure', 'success']);
  });

  it('replaces, keeps, and clears the robot webhook through robotWebhook', async () => {
    const operator = await callerFor(ids.operator);
    const enabled = {
      ...DEFAULT_STATUS_ALERT_SETTINGS,
      channels: {
        ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
        dingtalkRobot: { enabled: true, keyword: '状态', webhookUrl: null },
      },
    };
    const replaced = await operator.update({
      expectedRevision: 0,
      robotWebhook: { action: 'replace', value: webhook },
      settings: enabled,
    });
    expect(replaced.revision).toBe(1);
    expect(replaced.settings.channels.dingtalkRobot.webhookUrl).toBeNull();
    expect(replaced.dingtalkRobotWebhook).toEqual({
      hint: 'https://oapi.dingtalk.com/robot/send?access_token=…alue',
      set: true,
    });
    expect(encrypt).toHaveBeenCalledWith(webhook);
    const [row] = await db.select().from(platformStatusSettings);
    expect(row?.robotWebhook).toBe(`enc:${webhook}`);

    await expect(
      operator.update({
        expectedRevision: 0,
        robotWebhook: { action: 'clear' },
        settings: enabled,
      }),
    ).rejects.toMatchObject({ message: 'PLATFORM_REVISION_CONFLICT' });

    const kept = await operator.update({
      expectedRevision: 1,
      robotWebhook: { action: 'keep' },
      settings: enabled,
    });
    expect(kept.revision).toBe(2);
    expect(kept.dingtalkRobotWebhook.set).toBe(true);
    expect(encrypt).toHaveBeenCalledTimes(1);

    await expect(
      operator.update({
        expectedRevision: 2,
        robotWebhook: { action: 'clear' },
        settings: enabled,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '群机器人已启用，请填写 Webhook',
    });

    const cleared = await operator.update({
      expectedRevision: 2,
      robotWebhook: { action: 'clear' },
      settings: {
        ...enabled,
        channels: {
          ...enabled.channels,
          dingtalkRobot: { enabled: false, keyword: null, webhookUrl: null },
        },
      },
    });
    expect(cleared.dingtalkRobotWebhook).toEqual({ hint: null, set: false });
    const [clearedRow] = await db.select().from(platformStatusSettings);
    expect(clearedRow?.robotWebhook).toBeNull();
    const [log] = await db
      .select()
      .from(platformAuditLogs)
      .where(eq(platformAuditLogs.action, 'admin.system.alerts.update'))
      .orderBy(desc(platformAuditLogs.createdAt));
    expect(log?.afterDiff).toMatchObject({ webhookAction: 'clear' });
  });

  it('lists banned recipients and refuses a notice only they would receive', async () => {
    const operator = await callerFor(ids.operator);
    const usersMode = (userIds: string[]) => ({
      ...DEFAULT_STATUS_ALERT_SETTINGS,
      channels: {
        ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
        workNotice: {
          enabled: true,
          recipientMode: 'users' as const,
          roles: [],
          userIds,
        },
      },
    });
    await expect(
      operator.update({
        expectedRevision: 0,
        settings: usersMode([ids.banned]),
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '工作通知已启用，请至少选择一位接收人',
    });

    const saved = await operator.update({
      expectedRevision: 0,
      settings: usersMode([ids.banned, ids.bound]),
    });
    expect(saved.settings.channels.workNotice.userIds).toEqual([ids.banned, ids.bound]);
    expect(saved.recipientUsers).toEqual([
      {
        avatar: null,
        banned: true,
        dingtalkBound: false,
        id: ids.banned,
        name: '已停用用户',
      },
      {
        avatar: null,
        banned: false,
        dingtalkBound: true,
        id: ids.bound,
        name: '已绑定用户',
      },
    ]);
  });
});
