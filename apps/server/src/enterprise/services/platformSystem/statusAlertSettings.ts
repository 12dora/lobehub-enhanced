import { inArray } from 'drizzle-orm';

import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';
import type { PlatformModuleId } from '@/const/platform/modules';
import { PlatformRevisionConflictError } from '@/database/models/platform/errors';
import {
  PLATFORM_STATUS_SETTINGS_ID,
  type PlatformStatusSettingsItem,
  PlatformStatusSettingsModel,
} from '@/database/models/platform/statusSettings';
import { inTransaction } from '@/database/repositories/platform/tx';
import { users } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { throwEnterpriseError } from '@/server/enterprise/guards/enterpriseErrors';
import type { AuditAction } from '@/server/enterprise/services/audit/auditActionCatalog';
import { readDingtalkApiDailyAlertThreshold } from '@/server/enterprise/services/dingtalkWorkspace/apiCallStats';
import { resolveVerifiedDingtalkIdentity } from '@/server/enterprise/services/dingtalkWorkspace/identity';
import { getInfraSnapshot } from '@/server/enterprise/services/infraSettings/snapshot';
import { isModuleEnabled } from '@/server/enterprise/services/moduleSettings';
import { PlatformAuditService } from '@/server/enterprise/services/platformAudit';
import { resolveNotifyAppConfig } from '@/server/services/messenger/platforms/dingtalk/notifyApp';
import {
  DEFAULT_STATUS_ALERT_SETTINGS,
  dingtalkRobotWebhookHint,
  normalizeStatusAlertSettings,
  readStatusAlertWebhookUrl,
  type StatusAlertRobotSecretInput,
  type StatusAlertRobotWebhookInput,
  type StatusAlertSettings,
  stripStatusAlertWebhookUrl,
} from '@/types/platform/statusAlerts';

import type { AdminStatusAlertsView } from '../../contracts/adminSystem/alerts';

export const STATUS_ALERT_SETTINGS_CACHE_MS = 30_000;

export interface StatusAlertRuntime {
  robotSecret: string | null;
  /** Decrypted webhook. Null when unset. Never returned on the admin view. */
  robotWebhook: string | null;
  settings: StatusAlertSettings;
}

const ALERTS_UPDATE_ACTION = 'admin.system.alerts.update' as AuditAction;

let cached: { loadedAt: number; value: StatusAlertRuntime } | undefined;

export const invalidateStatusAlertSettingsCache = (): void => {
  cached = undefined;
};

export const resetStatusAlertSettingsCacheForTest = (): void => {
  cached = undefined;
};

export const resolveDingtalkApiAlertThreshold = (
  settings: Pick<StatusAlertSettings, 'dingtalkApiDailyThreshold'>,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): number =>
  settings.dingtalkApiDailyThreshold === null
    ? readDingtalkApiDailyAlertThreshold(env)
    : settings.dingtalkApiDailyThreshold;

const displayName = (user: {
  email: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}): string => user.fullName?.trim() || user.username?.trim() || user.email?.trim() || user.id;

export const isStatusAlertMailConfigured = async (): Promise<boolean> => {
  try {
    const snapshot = await getInfraSnapshot();
    return snapshot.mail.kind === 'smtp' || snapshot.mail.kind === 'resend';
  } catch (error) {
    console.warn('[status-alert] mail config read failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return false;
  }
};

export const isStatusAlertNotifyAppConfigured = async (): Promise<boolean> => {
  try {
    const [config, moduleOn] = await Promise.all([
      resolveNotifyAppConfig(),
      isModuleEnabled('dingtalkNotify' satisfies PlatformModuleId),
    ]);
    return Boolean(config) && moduleOn;
  } catch (error) {
    console.warn('[status-alert] notify app config read failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return false;
  }
};

const decryptRobotSecret = async (ciphertext: string): Promise<string | null> => {
  try {
    const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const opened = await gateKeeper.decrypt(ciphertext);
    const plaintext = opened.plaintext.trim();
    return plaintext.length > 0 ? plaintext : null;
  } catch (error) {
    console.error('[status-alert] robot secret decrypt failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }
};

export const encryptRobotSecret = async (plaintext: string): Promise<string> => {
  const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return gateKeeper.encrypt(plaintext);
};

const migratePlaintextWebhook = async (
  db: LobeChatDatabase | Transaction,
  row: PlatformStatusSettingsItem | null,
): Promise<{ plaintext: string | null; row: PlatformStatusSettingsItem | null }> => {
  const plaintext = row?.robotWebhook ? null : readStatusAlertWebhookUrl(row?.config);
  if (!row || !plaintext) return { plaintext, row };
  try {
    const ciphertext = await encryptRobotSecret(plaintext);
    const migrated = await new PlatformStatusSettingsModel(db).adoptRobotWebhook({
      ciphertext,
      config: stripStatusAlertWebhookUrl(row.config),
    });
    return { plaintext: null, row: migrated ?? row };
  } catch (error) {
    console.error('[status-alert] robot webhook encrypt failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return { plaintext, row };
  }
};

export const loadStatusAlertRuntime = async (
  db: LobeChatDatabase | Transaction,
): Promise<StatusAlertRuntime> => {
  const loaded = await new PlatformStatusSettingsModel(db).get();
  const migrated = await migratePlaintextWebhook(db, loaded);
  const settings = normalizeStatusAlertSettings(migrated.row?.config ?? {});
  const robotSecret = migrated.row?.robotSecret
    ? await decryptRobotSecret(migrated.row.robotSecret)
    : null;
  const robotWebhook = migrated.row?.robotWebhook
    ? await decryptRobotSecret(migrated.row.robotWebhook)
    : migrated.plaintext;
  return { robotSecret, robotWebhook, settings };
};

/** Worker read. Failures are not cached. */
export const readCachedStatusAlertRuntime = async (): Promise<StatusAlertRuntime> => {
  const now = Date.now();
  if (cached && now - cached.loadedAt < STATUS_ALERT_SETTINGS_CACHE_MS) return cached.value;
  const { getServerDB } = await import('@/database/core/db-adaptor');
  const value = await loadStatusAlertRuntime(await getServerDB());
  cached = { loadedAt: now, value };
  return value;
};

/** Existing users, in the submitted order. Banned accounts stay in the list. */
export const retainExistingStatusAlertUsers = async (
  db: LobeChatDatabase | Transaction,
  userIds: readonly string[],
): Promise<{ banned: boolean; id: string }[]> => {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ banned: users.banned, id: users.id })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  const byId = new Map(rows.map((row) => [row.id, row.banned === true]));
  const retained: { banned: boolean; id: string }[] = [];
  for (const id of userIds) {
    const banned = byId.get(id);
    if (banned === undefined) continue;
    retained.push({ banned, id });
  }
  return retained;
};

/** Drop ids that no longer exist. Order of the remaining ids is preserved. */
export const retainExistingStatusAlertUserIds = async (
  db: LobeChatDatabase | Transaction,
  userIds: readonly string[],
): Promise<string[]> => (await retainExistingStatusAlertUsers(db, userIds)).map((row) => row.id);

export const assertStatusAlertChannelRecipients = (params: {
  /**
   * Users-mode recipients that exist and are not banned.
   * Omitted falls back to `userIds.length` (deleted ids already removed).
   */
  deliverableUserCount?: number;
  settings: StatusAlertSettings;
  webhookAvailable: boolean;
}): void => {
  const workNotice = params.settings.channels.workNotice;
  if (workNotice.enabled && workNotice.recipientMode === 'roles' && workNotice.roles.length === 0) {
    throwEnterpriseError({
      code: PLATFORM_ERROR_CODES.PLATFORM_INVALID_INPUT,
      details: { field: 'channels.workNotice.roles' },
      httpCode: 'BAD_REQUEST',
      message: '工作通知已启用，请至少选择一个管理员角色',
    });
  }
  const deliverableUsers = params.deliverableUserCount ?? workNotice.userIds.length;
  if (workNotice.enabled && workNotice.recipientMode === 'users' && deliverableUsers === 0) {
    throwEnterpriseError({
      code: PLATFORM_ERROR_CODES.PLATFORM_INVALID_INPUT,
      details: { field: 'channels.workNotice.userIds' },
      httpCode: 'BAD_REQUEST',
      message: '工作通知已启用，请至少选择一位接收人',
    });
  }
  if (params.settings.channels.dingtalkRobot.enabled && !params.webhookAvailable) {
    throwEnterpriseError({
      code: PLATFORM_ERROR_CODES.PLATFORM_INVALID_INPUT,
      details: { field: 'channels.dingtalkRobot.webhookUrl' },
      httpCode: 'BAD_REQUEST',
      message: '群机器人已启用，请填写 Webhook',
    });
  }
};

export const summarizeStatusAlertSettings = (params: {
  robotSecretAction: 'clear' | 'keep' | 'replace';
  robotWebhookAction: 'clear' | 'keep' | 'replace';
  settings: StatusAlertSettings;
  webhookSet: boolean;
}): Record<string, unknown> => ({
  channels: {
    dingtalkRobot: {
      enabled: params.settings.channels.dingtalkRobot.enabled,
      keywordSet: Boolean(params.settings.channels.dingtalkRobot.keyword),
      webhookSet: params.webhookSet,
    },
    email: {
      enabled: params.settings.channels.email.enabled,
      recipientCount: params.settings.channels.email.recipients.length,
    },
    workNotice: {
      enabled: params.settings.channels.workNotice.enabled,
      recipientMode: params.settings.channels.workNotice.recipientMode,
      roles: params.settings.channels.workNotice.roles,
      userCount: params.settings.channels.workNotice.userIds.length,
    },
  },
  dingtalkApiDailyThreshold: params.settings.dingtalkApiDailyThreshold,
  enabled: params.settings.enabled,
  notifyOnRecovery: params.settings.notifyOnRecovery,
  repeatIntervalHours: params.settings.repeatIntervalHours,
  rules: params.settings.rules,
  signKeyAction: params.robotSecretAction,
  webhookAction: params.robotWebhookAction,
});

const resolveRecipientUsers = async (
  db: LobeChatDatabase | Transaction,
  userIds: readonly string[],
): Promise<AdminStatusAlertsView['recipientUsers']> => {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      avatar: users.avatar,
      banned: users.banned,
      email: users.email,
      fullName: users.fullName,
      id: users.id,
      username: users.username,
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolved = [];
  for (const id of userIds) {
    const row = byId.get(id);
    if (!row) continue;
    let dingtalkBound: boolean;
    try {
      const identity = await resolveVerifiedDingtalkIdentity(db as LobeChatDatabase, id);
      dingtalkBound = !('error' in identity) && identity.staffId.trim().length > 0;
    } catch {
      dingtalkBound = false;
    }
    resolved.push({
      avatar: row.avatar ?? null,
      banned: row.banned === true,
      dingtalkBound,
      id,
      name: displayName(row),
    });
  }
  return resolved;
};

const webhookView = async (
  row: PlatformStatusSettingsItem | null,
  plaintext: string | null,
): Promise<AdminStatusAlertsView['dingtalkRobotWebhook']> => {
  const decrypted = row?.robotWebhook ? await decryptRobotSecret(row.robotWebhook) : null;
  const source = decrypted ?? plaintext;
  return {
    hint: source ? dingtalkRobotWebhookHint(source) : null,
    set: Boolean(row?.robotWebhook) || Boolean(plaintext),
  };
};

const presentSettings = (
  settings: StatusAlertSettings,
  userIds: readonly string[],
): StatusAlertSettings => ({
  ...settings,
  channels: {
    ...settings.channels,
    dingtalkRobot: { ...settings.channels.dingtalkRobot, webhookUrl: null },
    workNotice: { ...settings.channels.workNotice, userIds: [...userIds] },
  },
});

const toView = async (
  db: LobeChatDatabase | Transaction,
  row: PlatformStatusSettingsItem | null,
  settings: StatusAlertSettings,
  plaintextWebhook: string | null,
): Promise<AdminStatusAlertsView> => {
  const userIds = await retainExistingStatusAlertUserIds(db, settings.channels.workNotice.userIds);
  const visible = presentSettings(settings, userIds);
  const [mailConfigured, notifyAppConfigured, recipientUsers, dingtalkRobotWebhook] =
    await Promise.all([
      isStatusAlertMailConfigured(),
      isStatusAlertNotifyAppConfigured(),
      resolveRecipientUsers(db, userIds),
      webhookView(row, plaintextWebhook),
    ]);
  return {
    dingtalkRobotSecretSet: Boolean(row?.robotSecret),
    dingtalkRobotWebhook,
    effectiveDingtalkApiDailyThreshold: resolveDingtalkApiAlertThreshold(visible),
    envDisabled: process.env.AIHUB_STATUS_ALERTS === '0',
    mailConfigured,
    notifyAppConfigured,
    recipientUsers,
    revision: row?.revision ?? 0,
    settings: visible,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
};

export class StatusAlertSettingsService {
  private readonly db: LobeChatDatabase | Transaction;

  constructor(db: LobeChatDatabase | Transaction) {
    this.db = db;
  }

  getView = async (): Promise<AdminStatusAlertsView> => {
    const loaded = await new PlatformStatusSettingsModel(this.db).get();
    const migrated = await migratePlaintextWebhook(this.db, loaded);
    const settings = normalizeStatusAlertSettings(migrated.row?.config ?? {});
    return toView(this.db, migrated.row, settings, migrated.plaintext);
  };

  update = async (params: {
    actorUserId: string;
    expectedRevision: number;
    robotSecret?: StatusAlertRobotSecretInput;
    /** undefined keeps the stored ciphertext; null clears; string is already encrypted. */
    robotSecretCiphertext?: string | null;
    robotWebhook?: StatusAlertRobotWebhookInput;
    /** undefined keeps; null clears; string is already encrypted. */
    robotWebhookCiphertext?: string | null;
    settings: StatusAlertSettings;
  }): Promise<AdminStatusAlertsView> => {
    const prepared = await inTransaction(this.db, async (tx) => {
      const model = new PlatformStatusSettingsModel(tx);
      const current = await model.getForUpdate();
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== params.expectedRevision) {
        throw new PlatformRevisionConflictError(
          'Status settings revision conflict: expectedRevision does not match current revision',
          {
            currentRevision,
            expectedRevision: params.expectedRevision,
            resourceId: PLATFORM_STATUS_SETTINGS_ID,
            resourceType: 'platform_status_settings',
          },
        );
      }
      const storedPlaintext = current?.robotWebhook
        ? null
        : readStatusAlertWebhookUrl(current?.config);
      const submittedPlaintext = readStatusAlertWebhookUrl(params.settings);
      let robotWebhookCiphertext = params.robotWebhookCiphertext;
      let robotWebhookAction = params.robotWebhook?.action ?? 'keep';
      if (
        robotWebhookAction === 'keep' &&
        robotWebhookCiphertext === undefined &&
        !current?.robotWebhook
      ) {
        const plaintext = storedPlaintext ?? submittedPlaintext;
        if (plaintext) {
          robotWebhookCiphertext = await encryptRobotSecret(plaintext);
          robotWebhookAction = 'replace';
        }
      }
      const retainedUsers = await retainExistingStatusAlertUsers(
        tx,
        params.settings.channels.workNotice.userIds,
      );
      const userIds = retainedUsers.map((row) => row.id);
      const settings = presentSettings(params.settings, userIds);
      const webhookAvailable =
        robotWebhookAction === 'clear'
          ? false
          : robotWebhookAction === 'replace'
            ? true
            : Boolean(current?.robotWebhook) || Boolean(robotWebhookCiphertext);
      assertStatusAlertChannelRecipients({
        deliverableUserCount: retainedUsers.filter((row) => !row.banned).length,
        settings,
        webhookAvailable,
      });
      const updated = await model.updateConfig({
        config: settings,
        expectedRevision: params.expectedRevision,
        robotSecret: params.robotSecretCiphertext,
        robotWebhook: robotWebhookCiphertext,
        updatedBy: params.actorUserId,
      });
      await new PlatformAuditService(tx).append({
        action: ALERTS_UPDATE_ACTION,
        actorUserId: params.actorUserId,
        afterDiff: summarizeStatusAlertSettings({
          robotSecretAction: params.robotSecret?.action ?? 'keep',
          robotWebhookAction,
          settings,
          webhookSet: webhookAvailable,
        }),
        configRevision: updated.revision,
        result: 'success',
        targetId: PLATFORM_STATUS_SETTINGS_ID,
        targetType: 'system',
      });
      return updated;
    });
    invalidateStatusAlertSettingsCache();
    const settings = normalizeStatusAlertSettings(prepared.config);
    return toView(this.db, prepared, settings, null);
  };
}

export const emptyStatusAlertRuntime = (): StatusAlertRuntime => ({
  robotSecret: null,
  robotWebhook: null,
  settings: DEFAULT_STATUS_ALERT_SETTINGS,
});
