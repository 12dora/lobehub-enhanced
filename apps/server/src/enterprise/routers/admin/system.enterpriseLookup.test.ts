// @vitest-environment node
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { getTestDB } from '@/database/core/getTestDB';
import {
  permissions,
  platformAuditLogs,
  platformInfraSettings,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { seedPlatformRoles } from '@/database/utils/seedPlatformRoles';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import type { QccCategory } from '@/types/platform/enterpriseLookup';

import { ADMIN_REAUTH_MAX_AGE_MS } from '../../contracts/adminUsers';
import { probeProvider } from '../../services/enterpriseLookup/mcpClient';
import { deletePlatformAuditLogsForTest } from '../../testing/deletePlatformAuditLogs';
import { seedLiveActorSession } from '../../testing/seedLiveActorSession';
import { adminRouter } from '../admin';

const db: LobeChatDatabase = await getTestDB();
const createCaller = createCallerFactory(adminRouter);
const ids = { operator: 'el-a1-system-operator', reader: 'el-a1-system-reader' };
const roleName = 'el_a1_enterprise_lookup_operator';
const readerRoleName = 'el_a1_system_unrelated_reader';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => db) }));
vi.mock('../../services/enterpriseLookup/mcpClient', () => ({
  invalidateEnterpriseLookupToolsCache: vi.fn(),
  probeProvider: vi.fn(async () => ({ ok: true, toolCount: 4 })),
}));
vi.mock('@/server/services/sandbox/factory', () => ({
  rebuildSandboxProviderFromSettings: vi.fn(async () => undefined),
}));

const cleanup = async () => {
  await db.delete(platformInfraSettings);
  await deletePlatformAuditLogsForTest(db, { actorUserIds: Object.values(ids) });
  const ownedRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.name, [readerRoleName, roleName]));
  if (ownedRoles.length > 0) {
    const roleIds = ownedRoles.map(({ id }) => id);
    await db.delete(userRoles).where(inArray(userRoles.roleId, roleIds));
    await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
    await db.delete(roles).where(inArray(roles.id, roleIds));
  }
  await db.delete(users).where(sql`${users.id} LIKE 'el-a1-system-%'`);
};

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('ENABLE_DATABASE_OIDC', '1');
  vi.stubEnv('ENABLE_PLATFORM_ADMIN', '1');
  vi.mocked(probeProvider).mockReset();
  vi.mocked(probeProvider).mockResolvedValue({ ok: true, toolCount: 4 });
  await cleanup();
  await db.insert(users).values(Object.values(ids).map((id) => ({ id })));
  await seedPlatformRoles(db);
  const [role] = await db
    .insert(roles)
    .values({ displayName: roleName, name: roleName })
    .returning();
  const grantedPermissions = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      inArray(permissions.code, [
        PLATFORM_PERMISSIONS.OIDC_PUBLISH,
        PLATFORM_PERMISSIONS.SYSTEM_OPERATE,
        PLATFORM_PERMISSIONS.SYSTEM_READ,
      ]),
    );
  await db
    .insert(rolePermissions)
    .values(grantedPermissions.map(({ id }) => ({ permissionId: id, roleId: role.id })));
  await db.insert(userRoles).values({ roleId: role.id, userId: ids.operator, workspaceId: null });
  const [readerRole] = await db
    .insert(roles)
    .values({ displayName: readerRoleName, name: readerRoleName })
    .returning();
  const [readerPermission] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.code, PLATFORM_PERMISSIONS.AUDIT_READ));
  await db
    .insert(rolePermissions)
    .values({ permissionId: readerPermission.id, roleId: readerRole.id });
  await db
    .insert(userRoles)
    .values({ roleId: readerRole.id, userId: ids.reader, workspaceId: null });
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllEnvs();
});

const callerFor = async (userId: string, authenticatedAt = new Date()) => {
  const sessionId = await seedLiveActorSession(db, { sessionId: `session-${userId}`, userId });
  const context = await createContextInner({
    authenticatedAt,
    authMethod: 'better-auth',
    sessionId,
    userId,
  });
  return createCaller({ ...context, serverDB: db } as never).system;
};

const enableQcc = {
  dailyLimitPerUser: 50,
  defaultProvider: 'qcc' as const,
  fallbackEnabled: true,
  qcc: {
    apiKey: { action: 'replace' as const, value: 'qcc-super-secret' },
    categories: ['company', 'risk'] as QccCategory[],
    enabled: true,
  },
  tianyancha: { enabled: false },
};

describe('admin.system enterprise lookup settings', () => {
  it('lets a system operator load defaults and denies an unrelated reader', async () => {
    const operator = await callerFor(ids.operator);
    await expect(operator.getEnterpriseLookupSettings()).resolves.toMatchObject({
      config: {
        dailyLimitPerUser: 50,
        defaultProvider: 'qcc',
        fallbackEnabled: true,
        qcc: { apiKeyStored: false, enabled: false },
        tianyancha: { apiKeyStored: false, enabled: false },
      },
      revision: 0,
      status: 'not_configured',
    });

    const reader = await callerFor(ids.reader);
    await expect(reader.getEnterpriseLookupSettings()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(
      reader.updateEnterpriseLookupSettings({
        config: enableQcc,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
  });

  it('rejects enabling a provider without a stored secret', async () => {
    const operator = await callerFor(ids.operator);
    await expect(
      operator.updateEnterpriseLookupSettings({
        config: {
          ...enableQcc,
          qcc: { ...enableQcc.qcc, apiKey: { action: 'keep' } },
        },
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/qcc\.apiKey required|PLATFORM_INVALID_INPUT/),
    });
  });

  it('persists via CAS, fingerprints the key, and redacts the audit afterDiff', async () => {
    vi.stubEnv('PLATFORM_MASTER_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('PLATFORM_KEY_PROVIDER', 'env');
    const operator = await callerFor(ids.operator);
    const result = await operator.updateEnterpriseLookupSettings({
      config: enableQcc,
      expectedRevision: 0,
    });
    expect(result).toMatchObject({
      config: {
        defaultProvider: 'qcc',
        qcc: {
          apiKeyStored: true,
          enabled: true,
        },
        tianyancha: { apiKeyStored: false, enabled: false },
      },
      revision: 1,
      status: 'configured',
    });
    expect(result.config.qcc.apiKeyFingerprint).toMatch(/^sha256:[0-9a-f]{8}$/);
    expect(JSON.stringify(result)).not.toContain('qcc-super-secret');

    const logs = await db.select().from(platformAuditLogs);
    expect(logs).toContainEqual(
      expect.objectContaining({
        action: 'system.infra.enterprise_lookup.update',
        result: 'success',
        targetId: 'enterprise_lookup',
        targetType: 'infra_settings',
      }),
    );
    expect(JSON.stringify(logs)).not.toContain('qcc-super-secret');
    expect(JSON.stringify(logs)).not.toContain('apiKeyCiphertext');

    await expect(
      operator.updateEnterpriseLookupSettings({
        config: { ...enableQcc, qcc: { ...enableQcc.qcc, apiKey: { action: 'keep' } } },
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('requires recent reauth for updateEnterpriseLookupSettings', async () => {
    const operator = await callerFor(
      ids.operator,
      new Date(Date.now() - ADMIN_REAUTH_MAX_AGE_MS - 1000),
    );
    await expect(
      operator.updateEnterpriseLookupSettings({
        config: enableQcc,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'ADMIN_REAUTH_REQUIRED' });
  });

  it('probes with a draft key and does not persist it', async () => {
    vi.stubEnv('PLATFORM_MASTER_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('PLATFORM_KEY_PROVIDER', 'env');
    const operator = await callerFor(ids.operator);
    await expect(
      operator.testEnterpriseLookupProvider({
        draft: { apiKey: 'draft-qcc-key' },
        provider: 'qcc',
      }),
    ).resolves.toEqual({ ok: true, toolCount: 4 });
    expect(probeProvider).toHaveBeenCalledWith('qcc', 'draft-qcc-key');

    const settings = await operator.getEnterpriseLookupSettings();
    expect(settings.status).toBe('not_configured');
    expect(settings.config.qcc.apiKeyStored).toBe(false);
  });

  it('returns not_configured when no draft or stored key exists', async () => {
    const operator = await callerFor(ids.operator);
    await expect(
      operator.testEnterpriseLookupProvider({ provider: 'tianyancha' }),
    ).resolves.toEqual({ ok: false, reason: 'not_configured' });
    expect(probeProvider).not.toHaveBeenCalled();
  });
});
