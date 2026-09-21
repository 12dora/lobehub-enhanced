import type { ApprovalAutomationTier } from '@lobechat/types';
import { z } from 'zod';

import { secretSafeAuditReasonSchema } from './shared';

/**
 * Strict Zod contracts for `admin.imConnectors.*` (管理端 → 通用设置 → IM 连接器).
 *
 * One global connector per IM platform. Credentials are stored in `system_bot_providers`
 * (platform = `dingtalk`): `application_id` = Client ID (AppKey, plaintext), `credentials` =
 * AES-GCM JSON `{ clientSecret }`, `settings` = the plaintext tunables below. The same row is what
 * `getEnabledMessengerPlatforms()` reads, so enabling the connector lights up 设置 → 聊天平台.
 */

export const imConnectorPlatformSchema = z.enum(['dingtalk']);
export type ImConnectorPlatform = z.infer<typeof imConnectorPlatformSchema>;

export const IM_CONNECTOR_IDLE_HOURS_MIN = 1;
export const IM_CONNECTOR_IDLE_HOURS_MAX = 720;
export const IM_CONNECTOR_IDLE_HOURS_DEFAULT = 24;

export const approvalAutomationTierSchema = z.enum(['moderate', 'off', 'relaxed', 'strict']);
export type ConnectorApprovalAutomationTier = z.infer<typeof approvalAutomationTierSchema>;

/** Default matches `APPROVAL_AUTOMATION_TIERS` moderate. */
export const APPROVAL_AUTOMATION_TIER_DEFAULT: ApprovalAutomationTier = 'moderate';

/** Plaintext `system_bot_providers.settings` shape for platform `dingtalk`. */
export const dingTalkConnectorSettingsSchema = z
  .object({
    /**
     * Automatic-approval worker tier. `off` stores rules but does not execute them.
     */
    approvalAutomationTier: approvalAutomationTierSchema.default(APPROVAL_AUTOMATION_TIER_DEFAULT),
    /**
     * Optional DingTalk micro-app AgentId for `dingtalk://…/openapp` deep links
     * (`app_id=0_<agentId>`). Empty = push/card buttons use the plain https SSO URL.
     */
    agentId: z.string().trim().max(64).nullable().optional().default(null),
    /** Optional DingTalk AI card template id (卡片平台 → AI 卡片). Empty = markdown fallback. */
    aiCardTemplateId: z.string().trim().max(200).nullable().default(null),
    /** Inbound chat (Clawbot) capability. */
    chatEnabled: z.boolean().default(true),
    /**
     * Optional DingTalk CorpId for in-client 免登 (`dd.runtime.permission.requestAuthCode`).
     * Empty = the stream worker captures it from inbound robot messages into Redis.
     */
    corpId: z.string().trim().max(200).nullable().optional().default(null),
    /** Auto-start a new topic when the last message is older than `idleNewTopicHours`. */
    idleNewTopicEnabled: z.boolean().default(true),
    idleNewTopicHours: z
      .number()
      .int()
      .min(IM_CONNECTOR_IDLE_HOURS_MIN)
      .max(IM_CONNECTOR_IDLE_HOURS_MAX)
      .default(IM_CONNECTOR_IDLE_HOURS_DEFAULT),
    /** Notify-app (服务号) AgentId used by work notifications. Empty = notify app unset. */
    notifyAgentId: z.string().trim().max(64).nullable().optional().default(null),
    /** Notify-app (服务号) AppKey. Empty = notify app unset. */
    notifyAppKey: z.string().trim().max(200).nullable().optional().default(null),
    /**
     * Notify-app 服务号 robot 1:1 channel. Default on; off skips that channel only.
     * `pushEnabled` remains the master switch for task-lifecycle pushes.
     */
    notifyRobotEnabled: z.boolean().default(true),
    /**
     * Notify-app work-notification (工作通知) channel. Default on; off skips that channel only.
     * `pushEnabled` remains the master switch for task-lifecycle pushes.
     */
    notifyWorkNoticeEnabled: z.boolean().default(true),
    /** Proactive push (task reminders) capability. */
    pushEnabled: z.boolean().default(true),
    /** RobotCode from the DingTalk robot page (often equals the Client ID). */
    robotCode: z.string().trim().min(1).max(200),
    /** Optional interactive "select" card template id (助手/会话选择卡片). Empty = ActionCard fallback. */
    selectCardTemplateId: z.string().trim().max(200).nullable().default(null),
    /** Workspace approval tool (`lobe-dingtalk-approval`). */
    workspaceApprovalEnabled: z.boolean().default(false),
    /** Workspace calendar APIs of `lobe-dingtalk-workspace`. */
    workspaceCalendarEnabled: z.boolean().default(false),
    /** Workspace todo APIs of `lobe-dingtalk-workspace`. */
    workspaceTodoEnabled: z.boolean().default(false),
  })
  .strict();
export type DingTalkConnectorSettings = z.infer<typeof dingTalkConnectorSettingsSchema>;

export const imConnectorStreamStateSchema = z.enum([
  'disabled',
  'connecting',
  'connected',
  'error',
  'unknown',
]);
export type ImConnectorStreamState = z.infer<typeof imConnectorStreamStateSchema>;

/**
 * Live status written by the stream worker to Redis key `messenger:dingtalk:stream-status`
 * (JSON, TTL 120 s, refreshed every 30 s). `unknown` = no heartbeat in Redis.
 */
export const imConnectorStatusSchema = z
  .object({
    connectedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
    lastEventAt: z.string().nullable(),
    lastFrameAt: z.string().nullable().optional(),
    state: imConnectorStreamStateSchema,
  })
  .strict();
export type ImConnectorStatus = z.infer<typeof imConnectorStatusSchema>;

/**
 * Counters: `linkedUsers` = rows in `messenger_account_links` for the platform; `messages7d` /
 * `pushes7d` = sum of the daily Redis counters `messenger:<platform>:counter:messages:<YYYY-MM-DD>` /
 * `messenger:<platform>:counter:pushes:<YYYY-MM-DD>` (INCR by the worker / push service, TTL 8 days).
 */
export const imConnectorStatsSchema = z
  .object({
    linkedUsers: z.number().int().nonnegative(),
    messages7d: z.number().int().nonnegative(),
    pushes7d: z.number().int().nonnegative(),
  })
  .strict();
export type ImConnectorStats = z.infer<typeof imConnectorStatsSchema>;

export const adminImConnectorViewSchema = z
  .object({
    approvalAutomationTier: approvalAutomationTierSchema,
    /** Optional micro-app AgentId used by DingTalk `openapp` deep links. Null when unset. */
    agentId: z.string().nullable().optional(),
    aiCardTemplateId: z.string().nullable(),
    chatEnabled: z.boolean(),
    /** Client ID (AppKey). Null when never configured. */
    clientId: z.string().nullable(),
    /** Short fingerprint of the stored secret for display; never the secret itself. */
    clientSecretFingerprint: z.string().nullable(),
    /** True once a row exists (even if disabled). */
    configured: z.boolean(),
    /** Optional CorpId used by the DingTalk 免登 SSO bridge. Null when unset. */
    corpId: z.string().nullable().optional(),
    enabled: z.boolean(),
    hasClientSecret: z.boolean(),
    idleNewTopicEnabled: z.boolean(),
    idleNewTopicHours: z.number().int(),
    /** Notify-app (服务号) AgentId. Null when unset. */
    notifyAgentId: z.string().nullable(),
    /** Notify-app (服务号) AppKey. Null when unset. */
    notifyAppKey: z.string().nullable(),
    /** True when a notify-app secret is stored; the secret itself is never returned. */
    notifyAppSecretSet: z.boolean(),
    /** Notify-app 服务号 robot 1:1 channel. Default on. */
    notifyRobotEnabled: z.boolean(),
    /** Notify-app work-notification (工作通知) channel. Default on. */
    notifyWorkNoticeEnabled: z.boolean(),
    platform: imConnectorPlatformSchema,
    pushEnabled: z.boolean(),
    robotCode: z.string().nullable(),
    selectCardTemplateId: z.string().nullable(),
    stats: imConnectorStatsSchema,
    status: imConnectorStatusSchema,
    updatedAt: z.string().nullable(),
    workspaceApprovalEnabled: z.boolean(),
    workspaceCalendarEnabled: z.boolean(),
    workspaceTodoEnabled: z.boolean(),
  })
  .strict();
export type AdminImConnectorView = z.infer<typeof adminImConnectorViewSchema>;

export const adminImConnectorGetInputSchema = z
  .object({ platform: imConnectorPlatformSchema })
  .strict();
export type AdminImConnectorGetInput = z.infer<typeof adminImConnectorGetInputSchema>;

export const adminImConnectorListOutputSchema = z
  .object({ items: z.array(adminImConnectorViewSchema) })
  .strict();

/**
 * Upsert. `clientSecret`: `{ action: 'keep' }` leaves the stored secret untouched (only valid when
 * one is stored), `{ action: 'replace', value }` stores a new one. Enabling requires a stored or
 * replaced secret.
 */
export const adminImConnectorSecretInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('replace'), value: z.string().trim().min(1).max(500) }).strict(),
]);

/** Notify-app secret: keep / replace / clear. Optional on upsert (omitted = keep). */
export const adminImConnectorNotifyAppSecretInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('replace'), value: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
]);

export const adminImConnectorUpsertInputSchema = z
  .object({
    approvalAutomationTier: approvalAutomationTierSchema
      .optional()
      .default(APPROVAL_AUTOMATION_TIER_DEFAULT),
    agentId: z.string().trim().max(64).nullable().optional(),
    aiCardTemplateId: z.string().trim().max(200).nullable(),
    chatEnabled: z.boolean(),
    clientId: z.string().trim().min(1).max(200),
    clientSecret: adminImConnectorSecretInputSchema,
    corpId: z.string().trim().max(200).nullable().optional(),
    enabled: z.boolean(),
    idleNewTopicEnabled: z.boolean(),
    idleNewTopicHours: z
      .number()
      .int()
      .min(IM_CONNECTOR_IDLE_HOURS_MIN)
      .max(IM_CONNECTOR_IDLE_HOURS_MAX),
    notifyAgentId: z.string().trim().max(64).nullable().optional(),
    notifyAppKey: z.string().trim().max(200).nullable().optional(),
    notifyAppSecret: adminImConnectorNotifyAppSecretInputSchema.optional(),
    notifyRobotEnabled: z.boolean().optional().default(true),
    notifyWorkNoticeEnabled: z.boolean().optional().default(true),
    platform: imConnectorPlatformSchema,
    pushEnabled: z.boolean(),
    reason: secretSafeAuditReasonSchema.optional(),
    robotCode: z.string().trim().min(1).max(200),
    selectCardTemplateId: z.string().trim().max(200).nullable(),
    workspaceApprovalEnabled: z.boolean().optional().default(false),
    workspaceCalendarEnabled: z.boolean().optional().default(false),
    workspaceTodoEnabled: z.boolean().optional().default(false),
  })
  .strict();
export type AdminImConnectorUpsertInput = z.input<typeof adminImConnectorUpsertInputSchema>;

/** Test with explicit values (unsaved form) or the stored row when a field is omitted. */
export const adminImConnectorTestInputSchema = z
  .object({
    clientId: z.string().trim().min(1).max(200).optional(),
    clientSecret: z.string().trim().min(1).max(500).optional(),
    platform: imConnectorPlatformSchema,
    robotCode: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type AdminImConnectorTestInput = z.infer<typeof adminImConnectorTestInputSchema>;

export const adminImConnectorTestOutputSchema = z
  .object({
    /** Stable error code for i18n (`auth_failed` | `network` | `missing_credentials` | `unknown`). */
    errorCode: z.string().nullable(),
    /** Raw provider error message for the details drawer. */
    errorMessage: z.string().nullable(),
    latencyMs: z.number().int().nonnegative().nullable(),
    ok: z.boolean(),
    /** Robot display name when the API exposes it. */
    robotName: z.string().nullable(),
  })
  .strict();
export type AdminImConnectorTestOutput = z.infer<typeof adminImConnectorTestOutputSchema>;

/** `auto` = inbound IM chat auto-link; `manual` = administrator bind in IM connectors. */
export const imConnectorBindingSourceSchema = z.enum(['auto', 'manual']);
export type ImConnectorBindingSource = z.infer<typeof imConnectorBindingSourceSchema>;

/**
 * Why a DingTalk staffId is already mapped to another AIHub user.
 * `link` = a `messenger_account_links` row; `identity_email` = the other
 * user's mailbox is `<staffId>@DINGTALK_IDENTITY_EMAIL_DOMAIN`.
 */
export const imConnectorBindingBoundViaSchema = z.enum(['identity_email', 'link']);
export type ImConnectorBindingBoundVia = z.infer<typeof imConnectorBindingBoundViaSchema>;

export const DINGTALK_PLATFORM_USER_ID_MAX = 64;

export const adminImConnectorBindingItemSchema = z
  .object({
    createdAt: z.string(),
    platformUserId: z.string(),
    platformUsername: z.string().nullable(),
    source: imConnectorBindingSourceSchema,
    userEmail: z.string().nullable(),
    userId: z.string(),
    userName: z.string().nullable(),
  })
  .strict();
export type AdminImConnectorBindingItem = z.infer<typeof adminImConnectorBindingItemSchema>;

export const adminImConnectorBindingsListInputSchema = z
  .object({
    platform: imConnectorPlatformSchema,
    q: z.string().trim().max(200).optional(),
  })
  .strict();
export type AdminImConnectorBindingsListInput = z.infer<
  typeof adminImConnectorBindingsListInputSchema
>;

export const adminImConnectorBindingsListOutputSchema = z
  .object({
    /** True when `total` exceeds the 200-row list cap (`items.length`). */
    hasMore: z.boolean(),
    items: z.array(adminImConnectorBindingItemSchema),
    /** Count of matching rows without the 200 cap. */
    total: z.number().int().nonnegative(),
  })
  .strict();
export type AdminImConnectorBindingsListOutput = z.infer<
  typeof adminImConnectorBindingsListOutputSchema
>;

export const adminImConnectorBindingsUpsertInputSchema = z
  .object({
    /**
     * When `platformUserId` is already mapped to another AIHub user (a links
     * row or an identity-email mailbox), the default is CONFLICT
     * `PLATFORM_USER_ALREADY_BOUND`. `force: true` transfers in one
     * transaction: drop the other user's link row (if any) and write this one.
     * Omitted / false refuses the write.
     */
    force: z.boolean().optional(),
    platform: imConnectorPlatformSchema,
    platformUserId: z.string().trim().min(1).max(DINGTALK_PLATFORM_USER_ID_MAX),
    platformUsername: z.string().trim().max(200).nullable().optional(),
    reason: secretSafeAuditReasonSchema.optional(),
    userId: z.string().trim().min(1),
  })
  .strict();
export type AdminImConnectorBindingsUpsertInput = z.infer<
  typeof adminImConnectorBindingsUpsertInputSchema
>;
export type AdminImConnectorBindingsUpsertOutput = AdminImConnectorBindingItem;

export const adminImConnectorBindingsRemoveInputSchema = z
  .object({
    platform: imConnectorPlatformSchema,
    reason: secretSafeAuditReasonSchema.optional(),
    userId: z.string().trim().min(1),
  })
  .strict();
export type AdminImConnectorBindingsRemoveInput = z.infer<
  typeof adminImConnectorBindingsRemoveInputSchema
>;

export const adminImConnectorBindingsRemoveOutputSchema = z
  .object({ success: z.literal(true) })
  .strict();
export type AdminImConnectorBindingsRemoveOutput = z.infer<
  typeof adminImConnectorBindingsRemoveOutputSchema
>;

export const dingtalkPermissionProbeReasonSchema = z.enum([
  'forbidden',
  'not_configured',
  'unreachable',
]);

export const dingtalkPermissionProbeSchema = z
  .object({
    missingScopes: z.array(z.string().min(1).max(100)).max(16).optional(),
    ok: z.boolean(),
    reason: dingtalkPermissionProbeReasonSchema.optional(),
  })
  .strict();
export type DingtalkPermissionProbe = z.infer<typeof dingtalkPermissionProbeSchema>;

export const adminImConnectorProbeWorkspacePermissionsOutputSchema = z
  .object({
    approval: dingtalkPermissionProbeSchema,
    calendar: dingtalkPermissionProbeSchema,
    todo: dingtalkPermissionProbeSchema,
  })
  .strict();
export type AdminImConnectorProbeWorkspacePermissionsOutput = z.infer<
  typeof adminImConnectorProbeWorkspacePermissionsOutputSchema
>;
