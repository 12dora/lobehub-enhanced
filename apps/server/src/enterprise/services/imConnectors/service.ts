import { createHash } from 'node:crypto';

import { invalidateMessengerConfigCache } from '@/config/messenger';
import { DingtalkPersonalAuthorizationModel } from '@/database/models/dingtalkPersonalAuthorization';
import type { DecryptedSystemBotProvider } from '@/database/models/systemBotProvider';
import { SystemBotProviderModel } from '@/database/models/systemBotProvider';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import {
  getDingtalkPersonalConfig,
  invalidateDingtalkPersonalConfig,
} from '@/server/enterprise/services/dingtalkPersonal';
import {
  applyAutomationTierChange,
  notifyAutomationTierTruncation,
} from '@/server/enterprise/services/dingtalkWorkspace/approvalRules';
import {
  invalidateDingtalkWorkspaceCapabilities,
  probeWorkspacePermissions as probeDingtalkWorkspacePermissions,
} from '@/server/enterprise/services/dingtalkWorkspace/capabilities';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  invalidateNotifyAppToken,
  probeNotifyAppToken,
  readNotifyAppFromProviderRow,
} from '@/server/services/messenger/platforms/dingtalk/notifyApp';

import type {
  AdminImConnectorBindingItem,
  AdminImConnectorBindingsListInput,
  AdminImConnectorBindingsListOutput,
  AdminImConnectorBindingsRemoveInput,
  AdminImConnectorBindingsRemoveOutput,
  AdminImConnectorBindingsUpsertInput,
  AdminImConnectorProbeWorkspacePermissionsOutput,
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
  DingTalkConnectorSettings,
  ImConnectorPlatform,
} from '../../contracts/adminImConnectors';
import {
  APPROVAL_AUTOMATION_TIER_DEFAULT,
  DINGTALK_ROBOT_DISPLAY_NAME_MAX,
  dingTalkConnectorSettingsSchema,
  IM_CONNECTOR_IDLE_HOURS_DEFAULT,
  imConnectorPlatformSchema,
} from '../../contracts/adminImConnectors';
import { AUDIT_ACTION } from '../audit/auditActionCatalog';
import type { DingTalkDirectoryStatus } from '../dingtalkDirectory/sync';
import {
  DIRECTORY_SYNC_LOCK_FAILED,
  readDingTalkDirectoryStatus,
  runGuardedDirectorySync,
} from '../dingtalkDirectory/sync';
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

/** Shown when the admin sync cannot take the Redis lock. Not a running walk. */
export const DIRECTORY_SYNC_LOCK_FAILED_ERROR = '同步未启动：缓存服务暂时不可用，请稍后重试';

export const IM_CONNECTOR_PLATFORMS = imConnectorPlatformSchema.options;
export const IM_CONNECTOR_CONNECTION_MODE = 'websocket';
export const IM_CONNECTOR_AUDIT_TARGET_TYPE = 'im_connector' as const;

const DEFAULT_SETTINGS: DingTalkConnectorSettings = {
  approvalAutomationTier: APPROVAL_AUTOMATION_TIER_DEFAULT,
  agentId: null,
  aiCardTemplateId: null,
  chatEnabled: true,
  corpId: null,
  idleNewTopicEnabled: true,
  idleNewTopicHours: IM_CONNECTOR_IDLE_HOURS_DEFAULT,
  notifyAgentId: null,
  notifyAppKey: null,
  notifyRobotEnabled: true,
  notifyWorkNoticeEnabled: true,
  pushEnabled: true,
  robotCode: '',
  robotDisplayName: '',
  selectCardTemplateId: null,
  personalChatEnabled: false,
  personalDataEnabled: false,
  personalDocsEnabled: false,
  personalReportEnabled: false,
  personalSheetsEnabled: false,
  personalTodoEnabled: false,
  personalWriteEnabled: false,
  workspaceApprovalEnabled: false,
  workspaceCalendarEnabled: false,
  workspaceTodoEnabled: false,
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

const pickNotifyAppSecret = (credentials: Record<string, unknown> | undefined): string | null => {
  const value = credentials?.notifyAppSecret;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

const mergeConnectorCredentials = (params: {
  clientSecret: string;
  existing?: Record<string, unknown>;
  notifyAppSecret: { action: 'clear' | 'keep' | 'replace'; value?: string } | undefined;
}): Record<string, unknown> => {
  const credentials: Record<string, unknown> = { clientSecret: params.clientSecret };
  const action = params.notifyAppSecret?.action ?? 'keep';
  if (action === 'replace' && params.notifyAppSecret?.value) {
    credentials.notifyAppSecret = params.notifyAppSecret.value;
  } else if (action === 'keep') {
    const stored = pickNotifyAppSecret(params.existing);
    if (stored) credentials.notifyAppSecret = stored;
  }
  return credentials;
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
    approvalAutomationTier:
      raw?.approvalAutomationTier === 'off' ||
      raw?.approvalAutomationTier === 'strict' ||
      raw?.approvalAutomationTier === 'moderate' ||
      raw?.approvalAutomationTier === 'relaxed'
        ? raw.approvalAutomationTier
        : DEFAULT_SETTINGS.approvalAutomationTier,
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
    notifyAgentId: emptyToNull(typeof raw?.notifyAgentId === 'string' ? raw.notifyAgentId : null),
    notifyAppKey: emptyToNull(typeof raw?.notifyAppKey === 'string' ? raw.notifyAppKey : null),
    notifyRobotEnabled:
      typeof raw?.notifyRobotEnabled === 'boolean'
        ? raw.notifyRobotEnabled
        : DEFAULT_SETTINGS.notifyRobotEnabled,
    notifyWorkNoticeEnabled:
      typeof raw?.notifyWorkNoticeEnabled === 'boolean'
        ? raw.notifyWorkNoticeEnabled
        : DEFAULT_SETTINGS.notifyWorkNoticeEnabled,
    pushEnabled:
      typeof raw?.pushEnabled === 'boolean' ? raw.pushEnabled : DEFAULT_SETTINGS.pushEnabled,
    robotCode: typeof raw?.robotCode === 'string' ? raw.robotCode : '',
    robotDisplayName:
      typeof raw?.robotDisplayName === 'string'
        ? raw.robotDisplayName.trim().slice(0, DINGTALK_ROBOT_DISPLAY_NAME_MAX)
        : DEFAULT_SETTINGS.robotDisplayName,
    selectCardTemplateId: emptyToNull(
      typeof raw?.selectCardTemplateId === 'string' ? raw.selectCardTemplateId : null,
    ),
    personalChatEnabled:
      typeof raw?.personalChatEnabled === 'boolean'
        ? raw.personalChatEnabled
        : DEFAULT_SETTINGS.personalChatEnabled,
    personalDataEnabled:
      typeof raw?.personalDataEnabled === 'boolean'
        ? raw.personalDataEnabled
        : DEFAULT_SETTINGS.personalDataEnabled,
    personalDocsEnabled:
      typeof raw?.personalDocsEnabled === 'boolean'
        ? raw.personalDocsEnabled
        : DEFAULT_SETTINGS.personalDocsEnabled,
    personalReportEnabled:
      typeof raw?.personalReportEnabled === 'boolean'
        ? raw.personalReportEnabled
        : DEFAULT_SETTINGS.personalReportEnabled,
    personalSheetsEnabled:
      typeof raw?.personalSheetsEnabled === 'boolean'
        ? raw.personalSheetsEnabled
        : DEFAULT_SETTINGS.personalSheetsEnabled,
    personalTodoEnabled:
      typeof raw?.personalTodoEnabled === 'boolean'
        ? raw.personalTodoEnabled
        : DEFAULT_SETTINGS.personalTodoEnabled,
    personalWriteEnabled:
      typeof raw?.personalWriteEnabled === 'boolean'
        ? raw.personalWriteEnabled
        : DEFAULT_SETTINGS.personalWriteEnabled,
    workspaceApprovalEnabled:
      typeof raw?.workspaceApprovalEnabled === 'boolean'
        ? raw.workspaceApprovalEnabled
        : DEFAULT_SETTINGS.workspaceApprovalEnabled,
    workspaceCalendarEnabled:
      typeof raw?.workspaceCalendarEnabled === 'boolean'
        ? raw.workspaceCalendarEnabled
        : DEFAULT_SETTINGS.workspaceCalendarEnabled,
    workspaceTodoEnabled:
      typeof raw?.workspaceTodoEnabled === 'boolean'
        ? raw.workspaceTodoEnabled
        : DEFAULT_SETTINGS.workspaceTodoEnabled,
  };
};

const settingsFromUpsert = (
  input: AdminImConnectorUpsertInput,
  previous?: DingTalkConnectorSettings,
): DingTalkConnectorSettings =>
  dingTalkConnectorSettingsSchema.parse({
    approvalAutomationTier: input.approvalAutomationTier ?? APPROVAL_AUTOMATION_TIER_DEFAULT,
    agentId: emptyToNull(input.agentId ?? null),
    aiCardTemplateId: emptyToNull(input.aiCardTemplateId),
    chatEnabled: input.chatEnabled,
    corpId: emptyToNull(input.corpId ?? null),
    idleNewTopicEnabled: input.idleNewTopicEnabled,
    idleNewTopicHours: input.idleNewTopicHours,
    notifyAgentId: emptyToNull(input.notifyAgentId ?? null),
    notifyAppKey: emptyToNull(input.notifyAppKey ?? null),
    notifyRobotEnabled: input.notifyRobotEnabled ?? true,
    notifyWorkNoticeEnabled: input.notifyWorkNoticeEnabled ?? true,
    pushEnabled: input.pushEnabled,
    robotCode: input.robotCode,
    // Omit keeps the stored name. `null` / `''` is an explicit clear (the
    // admin card sends `null` for an empty 机器人名称 field).
    robotDisplayName:
      input.robotDisplayName === undefined
        ? (previous?.robotDisplayName ?? '')
        : (input.robotDisplayName ?? '').trim(),
    selectCardTemplateId: emptyToNull(input.selectCardTemplateId),
    personalChatEnabled: input.personalChatEnabled ?? false,
    personalDataEnabled: input.personalDataEnabled ?? false,
    personalDocsEnabled: input.personalDocsEnabled ?? false,
    personalReportEnabled: input.personalReportEnabled ?? false,
    personalSheetsEnabled: input.personalSheetsEnabled ?? false,
    personalTodoEnabled: input.personalTodoEnabled ?? false,
    personalWriteEnabled: input.personalWriteEnabled ?? false,
    workspaceApprovalEnabled: input.workspaceApprovalEnabled ?? false,
    workspaceCalendarEnabled: input.workspaceCalendarEnabled ?? false,
    workspaceTodoEnabled: input.workspaceTodoEnabled ?? false,
  });

const redisClient = () => getAgentRuntimeRedisClient();

/** Fail closed: a missing broker module or authorization table must not blank the connector page. */
const loadDingtalkPersonalSummary = async (
  db: LobeChatDatabase | Transaction,
): Promise<AdminImConnectorView['personal']> => {
  const [brokerConfigured, authorizedCount] = await Promise.all([
    getDingtalkPersonalConfig()
      .then((config) => config.brokerConfigured === true)
      .catch(() => false),
    DingtalkPersonalAuthorizationModel.countActive(db as LobeChatDatabase)
      .then((count) => (Number.isInteger(count) && count >= 0 ? count : 0))
      .catch(() => 0),
  ]);
  return { authorizedCount, brokerConfigured };
};

const unconfiguredView = async (
  db: LobeChatDatabase | Transaction,
  platform: ImConnectorPlatform,
): Promise<AdminImConnectorView> => {
  const [stats, status, personal] = await Promise.all([
    getImConnectorStats({ db, platform, redis: redisClient() }),
    readImConnectorStatus({ platform, redis: redisClient(), rowDisabled: false }),
    loadDingtalkPersonalSummary(db),
  ]);
  return {
    approvalAutomationTier: DEFAULT_SETTINGS.approvalAutomationTier,
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
    notifyAgentId: DEFAULT_SETTINGS.notifyAgentId,
    notifyAppKey: DEFAULT_SETTINGS.notifyAppKey,
    notifyAppSecretSet: false,
    notifyRobotEnabled: DEFAULT_SETTINGS.notifyRobotEnabled,
    notifyWorkNoticeEnabled: DEFAULT_SETTINGS.notifyWorkNoticeEnabled,
    platform,
    personal,
    personalChatEnabled: DEFAULT_SETTINGS.personalChatEnabled,
    personalDataEnabled: DEFAULT_SETTINGS.personalDataEnabled,
    personalDocsEnabled: DEFAULT_SETTINGS.personalDocsEnabled,
    personalReportEnabled: DEFAULT_SETTINGS.personalReportEnabled,
    personalSheetsEnabled: DEFAULT_SETTINGS.personalSheetsEnabled,
    personalTodoEnabled: DEFAULT_SETTINGS.personalTodoEnabled,
    personalWriteEnabled: DEFAULT_SETTINGS.personalWriteEnabled,
    pushEnabled: DEFAULT_SETTINGS.pushEnabled,
    robotCode: null,
    robotDisplayName: DEFAULT_SETTINGS.robotDisplayName,
    selectCardTemplateId: DEFAULT_SETTINGS.selectCardTemplateId,
    stats,
    status,
    updatedAt: null,
    workspaceApprovalEnabled: DEFAULT_SETTINGS.workspaceApprovalEnabled,
    workspaceCalendarEnabled: DEFAULT_SETTINGS.workspaceCalendarEnabled,
    workspaceTodoEnabled: DEFAULT_SETTINGS.workspaceTodoEnabled,
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
  const [stats, status, personal] = await Promise.all([
    getImConnectorStats({ db, platform, redis: redisClient() }),
    readImConnectorStatus({ platform, redis: redisClient(), rowDisabled }),
    loadDingtalkPersonalSummary(db),
  ]);

  return {
    approvalAutomationTier: settings.approvalAutomationTier,
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
    notifyAgentId: emptyToNull(settings.notifyAgentId),
    notifyAppKey: emptyToNull(settings.notifyAppKey),
    notifyAppSecretSet: Boolean(pickNotifyAppSecret(row.credentials)),
    notifyRobotEnabled: settings.notifyRobotEnabled,
    notifyWorkNoticeEnabled: settings.notifyWorkNoticeEnabled,
    platform,
    personal,
    personalChatEnabled: settings.personalChatEnabled,
    personalDataEnabled: settings.personalDataEnabled,
    personalDocsEnabled: settings.personalDocsEnabled,
    personalReportEnabled: settings.personalReportEnabled,
    personalSheetsEnabled: settings.personalSheetsEnabled,
    personalTodoEnabled: settings.personalTodoEnabled,
    personalWriteEnabled: settings.personalWriteEnabled,
    pushEnabled: settings.pushEnabled,
    robotCode: emptyToNull(settings.robotCode),
    robotDisplayName: settings.robotDisplayName,
    selectCardTemplateId: emptyToNull(settings.selectCardTemplateId),
    stats,
    status,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    workspaceApprovalEnabled: settings.workspaceApprovalEnabled,
    workspaceCalendarEnabled: settings.workspaceCalendarEnabled,
    workspaceTodoEnabled: settings.workspaceTodoEnabled,
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
    const notifySecretAction = input.notifyAppSecret?.action ?? 'keep';
    const notifySecretMutates = notifySecretAction === 'replace' || notifySecretAction === 'clear';
    let prevTier = APPROVAL_AUTOMATION_TIER_DEFAULT;
    let truncationNotify: Awaited<ReturnType<typeof applyAutomationTierChange>>['rows'] = [];

    await this.db.transaction(async (tx) => {
      const existing = await SystemBotProviderModel.findByPlatform(tx, input.platform, gateKeeper);
      const previousSettings = parseDingTalkSettings(existing?.settings);
      prevTier = previousSettings.approvalAutomationTier;
      const settings = settingsFromUpsert(input, previousSettings);
      const storedSecret = pickClientSecret(existing?.credentials);
      const nextSecret = replacing ? replacementSecret : storedSecret;

      if (!replacing && !storedSecret) {
        throw new InfraSettingsSecretRequiredError('clientSecret');
      }
      if (input.enabled && !nextSecret) {
        throw new InfraSettingsSecretRequiredError('clientSecret');
      }

      if (existing && !replacing) {
        await SystemBotProviderModel.update(
          tx,
          existing.id,
          {
            applicationId: input.clientId,
            connectionMode: IM_CONNECTOR_CONNECTION_MODE,
            credentials: notifySecretMutates
              ? mergeConnectorCredentials({
                  clientSecret: nextSecret!,
                  existing: existing.credentials,
                  notifyAppSecret: input.notifyAppSecret,
                })
              : undefined,
            enabled: input.enabled,
            settings,
          },
          gateKeeper,
        );
      } else {
        if (!nextSecret) {
          throw new InfraSettingsSecretRequiredError('clientSecret');
        }
        await SystemBotProviderModel.upsertByPlatform(
          tx,
          {
            applicationId: input.clientId,
            connectionMode: IM_CONNECTOR_CONNECTION_MODE,
            credentials: mergeConnectorCredentials({
              clientSecret: nextSecret,
              existing: existing?.credentials,
              notifyAppSecret: input.notifyAppSecret,
            }),
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
          approvalAutomationTier: settings.approvalAutomationTier,
          agentId: settings.agentId,
          aiCardTemplateId: settings.aiCardTemplateId,
          chatEnabled: settings.chatEnabled,
          clientId: input.clientId,
          corpId: settings.corpId,
          enabled: input.enabled,
          idleNewTopicEnabled: settings.idleNewTopicEnabled,
          idleNewTopicHours: settings.idleNewTopicHours,
          notifyAgentId: settings.notifyAgentId,
          notifyAppKey: settings.notifyAppKey,
          notifyAppSecretRotation: notifySecretAction,
          notifyRobotEnabled: settings.notifyRobotEnabled,
          notifyWorkNoticeEnabled: settings.notifyWorkNoticeEnabled,
          platform: input.platform,
          pushEnabled: settings.pushEnabled,
          robotCode: settings.robotCode,
          robotDisplayName: settings.robotDisplayName,
          rotation: replacing ? 'replaced' : 'kept',
          selectCardTemplateId: settings.selectCardTemplateId,
          personalChatEnabled: settings.personalChatEnabled,
          personalDataEnabled: settings.personalDataEnabled,
          personalDocsEnabled: settings.personalDocsEnabled,
          personalReportEnabled: settings.personalReportEnabled,
          personalSheetsEnabled: settings.personalSheetsEnabled,
          personalTodoEnabled: settings.personalTodoEnabled,
          personalWriteEnabled: settings.personalWriteEnabled,
          workspaceApprovalEnabled: settings.workspaceApprovalEnabled,
          workspaceCalendarEnabled: settings.workspaceCalendarEnabled,
          workspaceTodoEnabled: settings.workspaceTodoEnabled,
        },
        reason: input.reason ?? null,
        result: 'success',
        targetId: input.platform,
        targetType: IM_CONNECTOR_AUDIT_TARGET_TYPE,
      });

      // Truncate in the same transaction as the connector upsert so a failed
      // apply rolls the tier back. Work notices are sent after commit so a
      // down notify app cannot hold the row locks.
      if (settings.approvalAutomationTier === 'strict') {
        const applied = await applyAutomationTierChange(
          tx,
          prevTier,
          settings.approvalAutomationTier,
        );
        truncationNotify = applied.rows;
      }
    });

    invalidateMessengerConfigCache('dingtalk');
    invalidateDingtalkWorkspaceCapabilities();
    invalidateDingtalkPersonalConfig();
    await invalidateNotifyAppToken();
    if (truncationNotify.length > 0) {
      await notifyAutomationTierTruncation(truncationNotify);
    }

    const row = await SystemBotProviderModel.findByPlatform(this.db, input.platform, gateKeeper);
    return toView(this.db, input.platform, row);
  };

  probeWorkspacePermissions = (): Promise<AdminImConnectorProbeWorkspacePermissionsOutput> =>
    probeDingtalkWorkspacePermissions();

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

  directoryStatus = (): Promise<DingTalkDirectoryStatus> => readDingTalkDirectoryStatus(this.db);

  syncDirectory = async (): Promise<DingTalkDirectoryStatus> => {
    try {
      const result = await runGuardedDirectorySync(this.db);
      if (result === DIRECTORY_SYNC_LOCK_FAILED) {
        const status = await readDingTalkDirectoryStatus(this.db);
        return {
          ...status,
          lastError: DIRECTORY_SYNC_LOCK_FAILED_ERROR,
          state: 'error',
        };
      }
      if (result === null) {
        const status = await readDingTalkDirectoryStatus(this.db);
        return { ...status, state: 'running' };
      }
    } catch (error) {
      console.error('[admin.imConnectors.syncDirectory] failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    return readDingTalkDirectoryStatus(this.db);
  };

  testNotifyApp = async (input?: {
    notifyAppKey?: string;
    notifyAppSecret?: string;
  }): Promise<AdminImConnectorTestOutput> => {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const existing = await SystemBotProviderModel.findByPlatform(this.db, 'dingtalk', gateKeeper);
    const stored = existing
      ? readNotifyAppFromProviderRow({
          credentials: existing.credentials,
          settings: existing.settings,
        })
      : null;
    const appKey = input?.notifyAppKey?.trim() || stored?.appKey || null;
    const appSecret = input?.notifyAppSecret?.trim() || stored?.appSecret || null;

    if (!appKey || !appSecret) {
      return {
        errorCode: 'missing_credentials',
        errorMessage: 'Notify AppKey and AppSecret are required',
        latencyMs: null,
        ok: false,
        robotName: null,
      };
    }

    return probeNotifyAppToken({ appKey, appSecret });
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
