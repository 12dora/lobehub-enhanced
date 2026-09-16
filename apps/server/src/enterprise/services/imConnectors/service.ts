import { createHash } from 'node:crypto';

import { invalidateMessengerConfigCache } from '@/config/messenger';
import type { DecryptedSystemBotProvider } from '@/database/models/systemBotProvider';
import { SystemBotProviderModel } from '@/database/models/systemBotProvider';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type {
  AdminImConnectorBindingItem,
  AdminImConnectorBindingsListInput,
  AdminImConnectorBindingsListOutput,
  AdminImConnectorBindingsRemoveInput,
  AdminImConnectorBindingsRemoveOutput,
  AdminImConnectorBindingsUpsertInput,
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
  DingTalkConnectorSettings,
  ImConnectorPlatform,
} from '../../contracts/adminImConnectors';
import {
  dingTalkConnectorSettingsSchema,
  IM_CONNECTOR_IDLE_HOURS_DEFAULT,
  imConnectorPlatformSchema,
} from '../../contracts/adminImConnectors';
import { AUDIT_ACTION } from '../audit/auditActionCatalog';
import { InfraSettingsSecretRequiredError } from '../infraSettings/errors';
import { PlatformAuditService } from '../platformAudit';
import {
  listImConnectorBindings,
  removeImConnectorBinding,
  upsertImConnectorBinding,
} from './bindings';
import { probeDingTalkCredentials } from './dingtalkProbe';
import { lookupDingTalkStaff } from './dingtalkStaffLookup';
import { getImConnectorStats } from './stats';
import { readImConnectorStatus } from './status';

export const IM_CONNECTOR_PLATFORMS = imConnectorPlatformSchema.options;
export const IM_CONNECTOR_CONNECTION_MODE = 'websocket';
export const IM_CONNECTOR_AUDIT_TARGET_TYPE = 'im_connector' as const;

const DEFAULT_SETTINGS: DingTalkConnectorSettings = {
  agentId: null,
  aiCardTemplateId: null,
  chatEnabled: true,
  corpId: null,
  idleNewTopicEnabled: true,
  idleNewTopicHours: IM_CONNECTOR_IDLE_HOURS_DEFAULT,
  pushEnabled: true,
  robotCode: '',
  selectCardTemplateId: null,
};

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const pickClientSecret = (credentials: Record<string, unknown> | undefined): string | null => {
  const value = credentials?.clientSecret;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const fingerprintClientSecret = (secret: string): string =>
  `sha256:${createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8)}`;

const parseDingTalkSettings = (
  raw: Record<string, unknown> | undefined,
): DingTalkConnectorSettings => {
  const parsed = dingTalkConnectorSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return {
    ...DEFAULT_SETTINGS,
    agentId: emptyToNull(typeof raw?.agentId === 'string' ? raw.agentId : null),
    aiCardTemplateId: emptyToNull(
      typeof raw?.aiCardTemplateId === 'string' ? raw.aiCardTemplateId : null,
    ),
    chatEnabled:
      typeof raw?.chatEnabled === 'boolean' ? raw.chatEnabled : DEFAULT_SETTINGS.chatEnabled,
    corpId: emptyToNull(typeof raw?.corpId === 'string' ? raw.corpId : null),
    idleNewTopicEnabled:
      typeof raw?.idleNewTopicEnabled === 'boolean'
        ? raw.idleNewTopicEnabled
        : DEFAULT_SETTINGS.idleNewTopicEnabled,
    idleNewTopicHours:
      typeof raw?.idleNewTopicHours === 'number'
        ? raw.idleNewTopicHours
        : DEFAULT_SETTINGS.idleNewTopicHours,
    pushEnabled:
      typeof raw?.pushEnabled === 'boolean' ? raw.pushEnabled : DEFAULT_SETTINGS.pushEnabled,
    robotCode: typeof raw?.robotCode === 'string' ? raw.robotCode : '',
    selectCardTemplateId: emptyToNull(
      typeof raw?.selectCardTemplateId === 'string' ? raw.selectCardTemplateId : null,
    ),
  };
};

const settingsFromUpsert = (input: AdminImConnectorUpsertInput): DingTalkConnectorSettings =>
  dingTalkConnectorSettingsSchema.parse({
    agentId: emptyToNull(input.agentId ?? null),
    aiCardTemplateId: emptyToNull(input.aiCardTemplateId),
    chatEnabled: input.chatEnabled,
    corpId: emptyToNull(input.corpId ?? null),
    idleNewTopicEnabled: input.idleNewTopicEnabled,
    idleNewTopicHours: input.idleNewTopicHours,
    pushEnabled: input.pushEnabled,
    robotCode: input.robotCode,
    selectCardTemplateId: emptyToNull(input.selectCardTemplateId),
  });

const redisClient = () => getAgentRuntimeRedisClient();

const unconfiguredView = async (
  db: LobeChatDatabase | Transaction,
  platform: ImConnectorPlatform,
): Promise<AdminImConnectorView> => {
  const [stats, status] = await Promise.all([
    getImConnectorStats({ db, platform, redis: redisClient() }),
    readImConnectorStatus({ platform, redis: redisClient(), rowDisabled: false }),
  ]);
  return {
    agentId: DEFAULT_SETTINGS.agentId,
    aiCardTemplateId: DEFAULT_SETTINGS.aiCardTemplateId,
    chatEnabled: DEFAULT_SETTINGS.chatEnabled,
    clientId: null,
    clientSecretFingerprint: null,
    configured: false,
    corpId: DEFAULT_SETTINGS.corpId,
    enabled: false,
    hasClientSecret: false,
    idleNewTopicEnabled: DEFAULT_SETTINGS.idleNewTopicEnabled,
    idleNewTopicHours: DEFAULT_SETTINGS.idleNewTopicHours,
    platform,
    pushEnabled: DEFAULT_SETTINGS.pushEnabled,
    robotCode: null,
    selectCardTemplateId: DEFAULT_SETTINGS.selectCardTemplateId,
    stats,
    status,
    updatedAt: null,
  };
};

const toView = async (
  db: LobeChatDatabase | Transaction,
  platform: ImConnectorPlatform,
  row: DecryptedSystemBotProvider | null,
): Promise<AdminImConnectorView> => {
  if (!row) return unconfiguredView(db, platform);

  const settings = parseDingTalkSettings(row.settings);
  const secret = pickClientSecret(row.credentials);
  const rowDisabled = !row.enabled;
  const [stats, status] = await Promise.all([
    getImConnectorStats({ db, platform, redis: redisClient() }),
    readImConnectorStatus({ platform, redis: redisClient(), rowDisabled }),
  ]);

  return {
    agentId: emptyToNull(settings.agentId),
    aiCardTemplateId: emptyToNull(settings.aiCardTemplateId),
    chatEnabled: settings.chatEnabled,
    clientId: row.applicationId ?? null,
    clientSecretFingerprint: secret ? fingerprintClientSecret(secret) : null,
    configured: true,
    corpId: emptyToNull(settings.corpId),
    enabled: row.enabled,
    hasClientSecret: Boolean(secret),
    idleNewTopicEnabled: settings.idleNewTopicEnabled,
    idleNewTopicHours: settings.idleNewTopicHours,
    platform,
    pushEnabled: settings.pushEnabled,
    robotCode: emptyToNull(settings.robotCode),
    selectCardTemplateId: emptyToNull(settings.selectCardTemplateId),
    stats,
    status,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
};

export class ImConnectorsAdminService {
  constructor(private readonly db: LobeChatDatabase) {}

  list = async (): Promise<{ items: AdminImConnectorView[] }> => {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const items = await Promise.all(
      IM_CONNECTOR_PLATFORMS.map(async (platform) => {
        const row = await SystemBotProviderModel.findByPlatform(this.db, platform, gateKeeper);
        return toView(this.db, platform, row);
      }),
    );
    return { items };
  };

  get = async (platform: ImConnectorPlatform): Promise<AdminImConnectorView> => {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const row = await SystemBotProviderModel.findByPlatform(this.db, platform, gateKeeper);
    return toView(this.db, platform, row);
  };

  upsert = async (params: {
    actorUserId: string;
    input: AdminImConnectorUpsertInput;
  }): Promise<AdminImConnectorView> => {
    const { input } = params;
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const replacing = input.clientSecret.action === 'replace';
    const replacementSecret =
      input.clientSecret.action === 'replace' ? input.clientSecret.value : undefined;
    const settings = settingsFromUpsert(input);

    await this.db.transaction(async (tx) => {
      const existing = await SystemBotProviderModel.findByPlatform(tx, input.platform, gateKeeper);
      const storedSecret = pickClientSecret(existing?.credentials);
      const nextSecret = replacing ? replacementSecret : storedSecret;

      if (!replacing && !storedSecret) {
        throw new InfraSettingsSecretRequiredError('clientSecret');
      }
      if (input.enabled && !nextSecret) {
        throw new InfraSettingsSecretRequiredError('clientSecret');
      }

      if (existing && !replacing) {
        await SystemBotProviderModel.update(tx, existing.id, {
          applicationId: input.clientId,
          connectionMode: IM_CONNECTOR_CONNECTION_MODE,
          enabled: input.enabled,
          settings,
        });
      } else {
        if (!nextSecret) {
          throw new InfraSettingsSecretRequiredError('clientSecret');
        }
        await SystemBotProviderModel.upsertByPlatform(
          tx,
          {
            applicationId: input.clientId,
            connectionMode: IM_CONNECTOR_CONNECTION_MODE,
            credentials: { clientSecret: nextSecret },
            enabled: input.enabled,
            platform: input.platform,
            settings,
          },
          gateKeeper,
        );
      }

      await new PlatformAuditService(tx).append({
        action: AUDIT_ACTION.SYSTEM_IM_CONNECTOR_UPDATE,
        actorUserId: params.actorUserId,
        afterDiff: {
          agentId: settings.agentId,
          aiCardTemplateId: settings.aiCardTemplateId,
          chatEnabled: settings.chatEnabled,
          clientId: input.clientId,
          corpId: settings.corpId,
          rotation: replacing ? 'replaced' : 'kept',
          enabled: input.enabled,
          idleNewTopicEnabled: settings.idleNewTopicEnabled,
          idleNewTopicHours: settings.idleNewTopicHours,
          platform: input.platform,
          pushEnabled: settings.pushEnabled,
          robotCode: settings.robotCode,
          selectCardTemplateId: settings.selectCardTemplateId,
        },
        reason: input.reason ?? null,
        result: 'success',
        targetId: input.platform,
        targetType: IM_CONNECTOR_AUDIT_TARGET_TYPE,
      });
    });

    // `dingtalk` is being added to MessengerPlatform by another agent; the function exists today.
    invalidateMessengerConfigCache('dingtalk' as never);

    const row = await SystemBotProviderModel.findByPlatform(this.db, input.platform, gateKeeper);
    return toView(this.db, input.platform, row);
  };

  test = async (input: AdminImConnectorTestInput): Promise<AdminImConnectorTestOutput> => {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const existing = await SystemBotProviderModel.findByPlatform(
      this.db,
      input.platform,
      gateKeeper,
    );
    const clientId = input.clientId?.trim() || existing?.applicationId?.trim() || null;
    const clientSecret = input.clientSecret?.trim() || pickClientSecret(existing?.credentials);

    if (!clientId || !clientSecret) {
      return {
        errorCode: 'missing_credentials',
        errorMessage: 'Client ID and Client Secret are required',
        latencyMs: null,
        ok: false,
        robotName: null,
      };
    }

    return probeDingTalkCredentials({ clientId, clientSecret });
  };

  listBindings = (
    input: AdminImConnectorBindingsListInput,
  ): Promise<AdminImConnectorBindingsListOutput> => listImConnectorBindings(this.db, input);

  upsertBinding = async (params: {
    actorUserId: string;
    input: AdminImConnectorBindingsUpsertInput;
  }): Promise<AdminImConnectorBindingItem> => {
    const { input } = params;
    const typedUsername = emptyToNull(input.platformUsername);
    const contact = typedUsername
      ? null
      : await this.lookupDingTalkStaff(input.platform, input.platformUserId);
    const platformUsername = typedUsername ?? emptyToNull(contact?.name);

    return this.db.transaction(async (tx) => {
      const { beforeDiff, item } = await upsertImConnectorBinding(tx, {
        force: input.force,
        platform: input.platform,
        platformUserId: input.platformUserId,
        platformUsername,
        userId: input.userId,
      });

      await new PlatformAuditService(tx).append({
        action: AUDIT_ACTION.SYSTEM_IM_CONNECTOR_UPDATE,
        actorUserId: params.actorUserId,
        afterDiff: {
          op: 'binding.upsert',
          platform: input.platform,
          platformUserId: item.platformUserId,
          platformUsername: item.platformUsername,
          source: item.source,
          userEmail: item.userEmail,
          userId: item.userId,
          userName: item.userName,
        },
        beforeDiff,
        reason: input.reason ?? null,
        result: 'success',
        targetId: input.platform,
        targetType: IM_CONNECTOR_AUDIT_TARGET_TYPE,
      });

      return item;
    });
  };

  removeBinding = async (params: {
    actorUserId: string;
    input: AdminImConnectorBindingsRemoveInput;
  }): Promise<AdminImConnectorBindingsRemoveOutput> => {
    const { input } = params;
    await this.db.transaction(async (tx) => {
      const { before } = await removeImConnectorBinding(tx, {
        platform: input.platform,
        userId: input.userId,
      });

      await new PlatformAuditService(tx).append({
        action: AUDIT_ACTION.SYSTEM_IM_CONNECTOR_UPDATE,
        actorUserId: params.actorUserId,
        afterDiff: {
          op: 'binding.remove',
          platform: input.platform,
          userId: input.userId,
        },
        beforeDiff: before
          ? {
              platformUserId: before.platformUserId,
              platformUsername: before.platformUsername,
              source: before.source,
              userEmail: before.userEmail,
              userName: before.userName,
            }
          : null,
        reason: input.reason ?? null,
        result: 'success',
        targetId: input.platform,
        targetType: IM_CONNECTOR_AUDIT_TARGET_TYPE,
      });
    });

    return { success: true };
  };

  private lookupDingTalkStaff = async (platform: ImConnectorPlatform, staffId: string) => {
    if (platform !== 'dingtalk') return null;
    try {
      return lookupDingTalkStaff(staffId);
    } catch (error) {
      console.error('[admin.imConnectors.bindings.upsert] staff lookup failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    }
  };
}
