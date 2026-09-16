// @vitest-environment node
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemBotProviderModel } from '@/database/models/systemBotProvider';
import type { LobeChatDatabase } from '@/database/type';

import { InfraSettingsSecretRequiredError } from '../infraSettings/errors';
import { fingerprintClientSecret, ImConnectorsAdminService } from './service';

const invalidateMessengerConfigCache = vi.hoisted(() => vi.fn());
const appendAudit = vi.hoisted(() => vi.fn());
const probeDingTalkCredentials = vi.hoisted(() => vi.fn());
const lookupDingTalkStaff = vi.hoisted(() => vi.fn());
const upsertImConnectorBinding = vi.hoisted(() => vi.fn());
const removeImConnectorBinding = vi.hoisted(() => vi.fn());
const listImConnectorBindings = vi.hoisted(() => vi.fn());
const readDingTalkDirectoryStatus = vi.hoisted(() => vi.fn());
const syncDingTalkDirectory = vi.hoisted(() => vi.fn());
const probeNotifyAppToken = vi.hoisted(() => vi.fn());
const readNotifyAppFromProviderRow = vi.hoisted(() => vi.fn());
const getImConnectorStats = vi.hoisted(() =>
  vi.fn(async () => ({ linkedUsers: 2, messages7d: 7, pushes7d: 1 })),
);
const readImConnectorStatus = vi.hoisted(() =>
  vi.fn(async () => ({
    connectedAt: null,
    lastError: null,
    lastErrorAt: null,
    lastEventAt: null,
    state: 'unknown' as const,
  })),
);
const initWithEnvKey = vi.hoisted(() =>
  vi.fn(async () => ({
    decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
    encrypt: async (plaintext: string) => plaintext,
  })),
);

vi.mock('@/config/messenger', () => ({
  invalidateMessengerConfigCache,
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey },
}));

vi.mock('../platformAudit', () => ({
  PlatformAuditService: class {
    append = appendAudit;
  },
}));

vi.mock('./dingtalkProbe', () => ({
  probeDingTalkCredentials,
}));

vi.mock('./dingtalkStaffLookup', () => ({
  lookupDingTalkStaff,
}));

vi.mock('./bindings', () => ({
  listImConnectorBindings,
  removeImConnectorBinding,
  upsertImConnectorBinding,
}));

vi.mock('./stats', () => ({
  getImConnectorStats,
}));

vi.mock('./status', () => ({
  readImConnectorStatus,
}));

vi.mock('../dingtalkDirectory/sync', () => ({
  readDingTalkDirectoryStatus,
  syncDingTalkDirectory,
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/notifyApp', () => ({
  probeNotifyAppToken,
  readNotifyAppFromProviderRow,
}));

const SECRET = 'dingtalk-client-secret';
const REPLACED_SECRET = 'replaced-secret-value';

const upsertInput = {
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'ding-app-key',
  clientSecret: { action: 'keep' as const },
  enabled: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  platform: 'dingtalk' as const,
  pushEnabled: true,
  reason: 'enable dingtalk connector',
  robotCode: 'ding-robot',
  selectCardTemplateId: null,
};

const existingRow = {
  applicationId: 'ding-app-key',
  connectionMode: 'websocket',
  credentials: { clientSecret: SECRET },
  enabled: true,
  id: 'row-1',
  platform: 'dingtalk',
  settings: {
    aiCardTemplateId: null,
    chatEnabled: true,
    idleNewTopicEnabled: true,
    idleNewTopicHours: 24,
    pushEnabled: true,
    robotCode: 'ding-robot',
    selectCardTemplateId: null,
  },
  updatedAt: new Date('2026-09-15T04:00:00.000Z'),
};

const createDb = () => {
  const db = {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db as unknown as LobeChatDatabase & { transaction: ReturnType<typeof vi.fn> };
};

describe('ImConnectorsAdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendAudit.mockResolvedValue({ id: 'audit-1' });
    probeDingTalkCredentials.mockResolvedValue({
      errorCode: null,
      errorMessage: null,
      latencyMs: 12,
      ok: true,
      robotName: null,
    });
    lookupDingTalkStaff.mockResolvedValue(null);
    upsertImConnectorBinding.mockResolvedValue({
      beforeDiff: null,
      item: {
        createdAt: '2026-09-16T00:00:00.000Z',
        platformUserId: 'staff_1',
        platformUsername: 'Admin',
        source: 'manual',
        userEmail: 'admin@jiefakj.com',
        userId: 'user_admin',
        userName: 'Break Glass',
      },
    });
    removeImConnectorBinding.mockResolvedValue({
      before: {
        createdAt: '2026-09-16T00:00:00.000Z',
        platformUserId: 'staff_1',
        platformUsername: 'Admin',
        source: 'manual',
        userEmail: 'admin@jiefakj.com',
        userId: 'user_admin',
        userName: 'Break Glass',
      },
      success: true,
    });
    listImConnectorBindings.mockResolvedValue({ hasMore: false, items: [], total: 0 });
    readDingTalkDirectoryStatus.mockResolvedValue({
      departments: 2,
      lastError: null,
      lastRunAt: '2026-09-16T04:00:00.000Z',
      state: 'ok',
      users: 9,
    });
    syncDingTalkDirectory.mockResolvedValue({ departments: 2, durationMs: 12, users: 9 });
    probeNotifyAppToken.mockResolvedValue({
      errorCode: null,
      errorMessage: null,
      latencyMs: 7,
      ok: true,
      robotName: null,
    });
    readNotifyAppFromProviderRow.mockReturnValue({
      agentId: '9',
      appKey: 'notify-key',
      appSecret: 'notify-secret',
    });
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue(existingRow as never);
    vi.spyOn(SystemBotProviderModel, 'update').mockResolvedValue(existingRow as never);
    vi.spyOn(SystemBotProviderModel, 'upsertByPlatform').mockResolvedValue(existingRow as never);
  });

  it('fingerprints the stored secret as sha256: + first 8 hex chars', async () => {
    const service = new ImConnectorsAdminService(createDb());
    const view = await service.get('dingtalk');
    const expected = `sha256:${createHash('sha256').update(SECRET, 'utf8').digest('hex').slice(0, 8)}`;

    expect(fingerprintClientSecret(SECRET)).toBe(expected);
    expect(view.clientSecretFingerprint).toBe(expected);
    expect(view.hasClientSecret).toBe(true);
    expect(JSON.stringify(view)).not.toContain(SECRET);
  });

  it('keeps the stored secret on upsert and does not re-encrypt credentials', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);

    await service.upsert({ actorUserId: 'operator-1', input: upsertInput });

    expect(SystemBotProviderModel.update).toHaveBeenCalledWith(
      db,
      'row-1',
      expect.objectContaining({
        applicationId: 'ding-app-key',
        connectionMode: 'websocket',
        enabled: true,
        settings: expect.objectContaining({ corpId: null, robotCode: 'ding-robot' }),
      }),
      expect.anything(),
    );
    expect(
      vi.mocked(SystemBotProviderModel.update).mock.calls[0]?.[2]?.credentials,
    ).toBeUndefined();
    expect(SystemBotProviderModel.upsertByPlatform).not.toHaveBeenCalled();
    expect(invalidateMessengerConfigCache).toHaveBeenCalledWith('dingtalk');
  });

  it('replaces the secret through upsertByPlatform', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue({
      ...existingRow,
      credentials: { clientSecret: REPLACED_SECRET },
    } as never);

    await service.upsert({
      actorUserId: 'operator-1',
      input: {
        ...upsertInput,
        clientSecret: { action: 'replace', value: REPLACED_SECRET },
      },
    });

    expect(SystemBotProviderModel.upsertByPlatform).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        applicationId: 'ding-app-key',
        connectionMode: 'websocket',
        credentials: { clientSecret: REPLACED_SECRET },
        enabled: true,
        platform: 'dingtalk',
      }),
      expect.anything(),
    );
    expect(SystemBotProviderModel.update).not.toHaveBeenCalled();
  });

  it('creates a new row via upsertByPlatform on first-time replace', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);
    const createdRow = {
      ...existingRow,
      credentials: { clientSecret: REPLACED_SECRET },
    };
    vi.mocked(SystemBotProviderModel.findByPlatform)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(createdRow as never);

    await service.upsert({
      actorUserId: 'operator-1',
      input: {
        ...upsertInput,
        clientSecret: { action: 'replace', value: REPLACED_SECRET },
      },
    });

    expect(SystemBotProviderModel.upsertByPlatform).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        applicationId: 'ding-app-key',
        connectionMode: 'websocket',
        credentials: { clientSecret: REPLACED_SECRET },
        enabled: true,
        platform: 'dingtalk',
      }),
      expect.anything(),
    );
    expect(SystemBotProviderModel.update).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.im_connector.update',
        afterDiff: expect.objectContaining({ rotation: 'replaced' }),
        targetId: 'dingtalk',
        targetType: 'im_connector',
      }),
    );
    expect(invalidateMessengerConfigCache).toHaveBeenCalledWith('dingtalk');
  });

  it('rejects enabling without a stored or replaced secret', async () => {
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue(null);
    const service = new ImConnectorsAdminService(createDb());

    await expect(
      service.upsert({ actorUserId: 'operator-1', input: { ...upsertInput, enabled: true } }),
    ).rejects.toBeInstanceOf(InfraSettingsSecretRequiredError);
    expect(invalidateMessengerConfigCache).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });

  it('writes an audit row with replaced|kept and never the secret', async () => {
    const service = new ImConnectorsAdminService(createDb());

    await service.upsert({ actorUserId: 'operator-1', input: upsertInput });

    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.im_connector.update',
        actorUserId: 'operator-1',
        afterDiff: expect.objectContaining({
          clientId: 'ding-app-key',
          enabled: true,
          robotCode: 'ding-robot',
          rotation: 'kept',
        }),
        reason: 'enable dingtalk connector',
        result: 'success',
        targetId: 'dingtalk',
        targetType: 'im_connector',
      }),
    );
    const payload = JSON.stringify(appendAudit.mock.calls[0]?.[0]);
    expect(payload).not.toContain(SECRET);
    expect(payload).not.toMatch(/dingtalk-client-secret/);
  });

  it('maps missing credentials on test to missing_credentials', async () => {
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue(null);
    const service = new ImConnectorsAdminService(createDb());

    const result = await service.test({ platform: 'dingtalk' });

    expect(result).toEqual({
      errorCode: 'missing_credentials',
      errorMessage: 'Client ID and Client Secret are required',
      latencyMs: null,
      ok: false,
      robotName: null,
    });
    expect(probeDingTalkCredentials).not.toHaveBeenCalled();
  });

  it('uses stored secret when test input omits credentials', async () => {
    const service = new ImConnectorsAdminService(createDb());

    await service.test({ platform: 'dingtalk' });

    expect(probeDingTalkCredentials).toHaveBeenCalledWith({
      clientId: 'ding-app-key',
      clientSecret: SECRET,
    });
  });

  it('passes corpId through upsert settings and the view', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue({
      ...existingRow,
      settings: { ...existingRow.settings, corpId: 'ding42' },
    } as never);

    const view = await service.upsert({
      actorUserId: 'operator-1',
      input: { ...upsertInput, corpId: 'ding42' },
    });

    expect(SystemBotProviderModel.update).toHaveBeenCalledWith(
      db,
      'row-1',
      expect.objectContaining({
        settings: expect.objectContaining({ corpId: 'ding42', robotCode: 'ding-robot' }),
      }),
      expect.anything(),
    );
    expect(view.corpId).toBe('ding42');
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterDiff: expect.objectContaining({ corpId: 'ding42' }),
      }),
    );
  });

  it('passes agentId through upsert settings and the view', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue({
      ...existingRow,
      settings: { ...existingRow.settings, agentId: '4617854000' },
    } as never);

    const view = await service.upsert({
      actorUserId: 'operator-1',
      input: { ...upsertInput, agentId: '4617854000' },
    });

    expect(SystemBotProviderModel.update).toHaveBeenCalledWith(
      db,
      'row-1',
      expect.objectContaining({
        settings: expect.objectContaining({ agentId: '4617854000', robotCode: 'ding-robot' }),
      }),
      expect.anything(),
    );
    expect(view.agentId).toBe('4617854000');
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterDiff: expect.objectContaining({ agentId: '4617854000' }),
      }),
    );
  });

  it('persists notify-app settings and secret without leaking the secret', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);
    const notifySecret = 'notify-app-secret';
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue({
      ...existingRow,
      credentials: { clientSecret: SECRET, notifyAppSecret: notifySecret },
      settings: {
        ...existingRow.settings,
        notifyAgentId: '4617854000',
        notifyAppKey: 'notify-app-key',
      },
    } as never);

    const view = await service.upsert({
      actorUserId: 'operator-1',
      input: {
        ...upsertInput,
        notifyAgentId: '4617854000',
        notifyAppKey: 'notify-app-key',
        notifyAppSecret: { action: 'replace', value: notifySecret },
      },
    });

    expect(SystemBotProviderModel.update).toHaveBeenCalledWith(
      db,
      'row-1',
      expect.objectContaining({
        credentials: { clientSecret: SECRET, notifyAppSecret: notifySecret },
        settings: expect.objectContaining({
          notifyAgentId: '4617854000',
          notifyAppKey: 'notify-app-key',
        }),
      }),
      expect.anything(),
    );
    expect(view.notifyAppKey).toBe('notify-app-key');
    expect(view.notifyAgentId).toBe('4617854000');
    expect(view.notifyAppSecretSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain(notifySecret);
    expect(JSON.stringify(appendAudit.mock.calls[0]?.[0])).not.toContain(notifySecret);
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterDiff: expect.objectContaining({
          notifyAgentId: '4617854000',
          notifyAppKey: 'notify-app-key',
          notifyAppSecretRotation: 'replace',
        }),
      }),
    );
  });

  it('keeps the stored notify-app secret when clientSecret is replaced', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);
    const notifySecret = 'notify-app-secret';
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValue({
      ...existingRow,
      credentials: { clientSecret: SECRET, notifyAppSecret: notifySecret },
    } as never);

    await service.upsert({
      actorUserId: 'operator-1',
      input: {
        ...upsertInput,
        clientSecret: { action: 'replace', value: REPLACED_SECRET },
      },
    });

    expect(SystemBotProviderModel.upsertByPlatform).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        credentials: { clientSecret: REPLACED_SECRET, notifyAppSecret: notifySecret },
      }),
      expect.anything(),
    );
  });

  it('writes a binding.upsert audit row and never the connector secret', async () => {
    const service = new ImConnectorsAdminService(createDb());

    await service.upsertBinding({
      actorUserId: 'operator-1',
      input: {
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        platformUsername: 'Admin',
        reason: 'bind break-glass admin',
        userId: 'user_admin',
      },
    });

    expect(upsertImConnectorBinding).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        platformUsername: 'Admin',
        userId: 'user_admin',
      }),
    );
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.im_connector.update',
        actorUserId: 'operator-1',
        afterDiff: expect.objectContaining({
          op: 'binding.upsert',
          platform: 'dingtalk',
          platformUserId: 'staff_1',
          source: 'manual',
          userId: 'user_admin',
        }),
        beforeDiff: null,
        reason: 'bind break-glass admin',
        result: 'success',
        targetId: 'dingtalk',
        targetType: 'im_connector',
      }),
    );
    expect(JSON.stringify(appendAudit.mock.calls[0]?.[0])).not.toContain(SECRET);
    expect(lookupDingTalkStaff).not.toHaveBeenCalled();
  });

  it('forwards force and beforeDiff (displaced link / previous platformUserId) to audit', async () => {
    upsertImConnectorBinding.mockResolvedValueOnce({
      beforeDiff: {
        displaced: {
          boundVia: 'link',
          platformUserId: 'staff_shared',
          platformUsername: 'Alice',
          source: 'auto',
          userEmail: 'alice@dingtalk.jiefakj.com',
          userId: 'user_alice',
          userName: 'Alice',
        },
        previousPlatformUserId: 'staff_old',
        previousPlatformUsername: null,
        previousSource: 'auto',
      },
      item: {
        createdAt: '2026-09-16T00:00:00.000Z',
        platformUserId: 'staff_shared',
        platformUsername: 'Admin',
        source: 'manual',
        userEmail: 'admin@jiefakj.com',
        userId: 'user_admin',
        userName: 'Break Glass',
      },
    });
    const service = new ImConnectorsAdminService(createDb());

    await service.upsertBinding({
      actorUserId: 'operator-1',
      input: {
        force: true,
        platform: 'dingtalk',
        platformUserId: 'staff_shared',
        userId: 'user_admin',
      },
    });

    expect(upsertImConnectorBinding).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ force: true, platformUserId: 'staff_shared' }),
    );
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeDiff: expect.objectContaining({
          displaced: expect.objectContaining({ boundVia: 'link', userId: 'user_alice' }),
          previousPlatformUserId: 'staff_old',
        }),
      }),
    );
  });

  it('looks up DingTalk staff to fill platformUsername when the admin omitted it', async () => {
    lookupDingTalkStaff.mockResolvedValueOnce({ name: 'Corp Alice' });
    upsertImConnectorBinding.mockResolvedValueOnce({
      beforeDiff: null,
      item: {
        createdAt: '2026-09-16T00:00:00.000Z',
        platformUserId: 'staff_9',
        platformUsername: 'Corp Alice',
        source: 'manual',
        userEmail: 'admin@jiefakj.com',
        userId: 'user_admin',
        userName: 'Break Glass',
      },
    });
    const service = new ImConnectorsAdminService(createDb());

    await service.upsertBinding({
      actorUserId: 'operator-1',
      input: { platform: 'dingtalk', platformUserId: 'staff_9', userId: 'user_admin' },
    });

    expect(lookupDingTalkStaff).toHaveBeenCalledWith('staff_9');
    expect(upsertImConnectorBinding).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ platformUsername: 'Corp Alice' }),
    );
  });

  it('writes a binding.remove audit row', async () => {
    const service = new ImConnectorsAdminService(createDb());

    await expect(
      service.removeBinding({
        actorUserId: 'operator-1',
        input: { platform: 'dingtalk', userId: 'user_admin' },
      }),
    ).resolves.toEqual({ success: true });

    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.im_connector.update',
        afterDiff: expect.objectContaining({ op: 'binding.remove', userId: 'user_admin' }),
        beforeDiff: expect.objectContaining({ platformUserId: 'staff_1', source: 'manual' }),
        targetType: 'im_connector',
      }),
    );
  });

  it('returns directoryStatus from Redis/model', async () => {
    const service = new ImConnectorsAdminService(createDb());
    await expect(service.directoryStatus()).resolves.toEqual({
      departments: 2,
      lastError: null,
      lastRunAt: '2026-09-16T04:00:00.000Z',
      state: 'ok',
      users: 9,
    });
  });

  it('syncDirectory runs sync then returns the status', async () => {
    const db = createDb();
    const service = new ImConnectorsAdminService(db);
    await expect(service.syncDirectory()).resolves.toMatchObject({ state: 'ok', users: 9 });
    expect(syncDingTalkDirectory).toHaveBeenCalledWith(db);
    expect(readDingTalkDirectoryStatus).toHaveBeenCalledWith(db);
  });

  it('testNotifyApp uses stored notify credentials when the form omits them', async () => {
    const service = new ImConnectorsAdminService(createDb());
    await expect(service.testNotifyApp()).resolves.toMatchObject({ ok: true });
    expect(probeNotifyAppToken).toHaveBeenCalledWith({
      appKey: 'notify-key',
      appSecret: 'notify-secret',
    });
  });

  it('testNotifyApp maps missing notify credentials', async () => {
    readNotifyAppFromProviderRow.mockReturnValueOnce(null);
    vi.spyOn(SystemBotProviderModel, 'findByPlatform').mockResolvedValueOnce(null);
    const service = new ImConnectorsAdminService(createDb());
    await expect(service.testNotifyApp()).resolves.toEqual({
      errorCode: 'missing_credentials',
      errorMessage: 'Notify AppKey and AppSecret are required',
      latencyMs: null,
      ok: false,
      robotName: null,
    });
    expect(probeNotifyAppToken).not.toHaveBeenCalled();
  });
});
