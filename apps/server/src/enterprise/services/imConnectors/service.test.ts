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

vi.mock('./stats', () => ({
  getImConnectorStats,
}));

vi.mock('./status', () => ({
  readImConnectorStatus,
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
        settings: expect.objectContaining({ robotCode: 'ding-robot' }),
      }),
    );
    expect(vi.mocked(SystemBotProviderModel.update).mock.calls[0]?.[2]).not.toHaveProperty('credentials');
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
          credentialAction: 'kept',
          enabled: true,
          robotCode: 'ding-robot',
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
});
