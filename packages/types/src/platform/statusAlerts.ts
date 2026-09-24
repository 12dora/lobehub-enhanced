import { z } from 'zod';

/** Global admin roles that may receive status alerts. `platform_user` is not included. */
export const PLATFORM_ADMIN_ALERT_ROLE_KEYS = [
  'super_admin',
  'user_admin',
  'ai_admin',
  'identity_admin',
  'auditor',
] as const;

export type PlatformAdminAlertRole = (typeof PLATFORM_ADMIN_ALERT_ROLE_KEYS)[number];

export const STATUS_ALERT_LIMITS = {
  EMAIL_MAX: 20,
  KEYWORD_MAX: 20,
  REPEAT_INTERVAL_HOURS_MAX: 168,
  REPEAT_INTERVAL_HOURS_MIN: 1,
  ROBOT_SECRET_MAX: 200,
  THRESHOLD_MAX: 10_000_000,
  USER_ID_MAX: 128,
  USER_IDS_MAX: 100,
  WEBHOOK_MAX: 500,
} as const;

/**
 * DingTalk custom-robot incoming webhook. The access token is the only query value;
 * any other host, path, or parameter is rejected.
 */
export const DINGTALK_ROBOT_WEBHOOK_PATTERN =
  /^https:\/\/oapi\.dingtalk\.com\/robot\/send\?access_token=[\w-]+$/;

const alertRoleSchema = z.enum(PLATFORM_ADMIN_ALERT_ROLE_KEYS);

const unique = <T extends string>(values: readonly T[]): T[] => [...new Set(values)];

const nullableTrimmedString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().min(1).max(max).nullable(),
  );

export const statusAlertSettingsSchema = z
  .object({
    channels: z
      .object({
        dingtalkRobot: z
          .object({
            enabled: z.boolean(),
            keyword: nullableTrimmedString(STATUS_ALERT_LIMITS.KEYWORD_MAX),
            webhookUrl: z.preprocess(
              (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
              z
                .string()
                .trim()
                .max(STATUS_ALERT_LIMITS.WEBHOOK_MAX)
                .regex(DINGTALK_ROBOT_WEBHOOK_PATTERN, 'webhook must be a DingTalk robot URL')
                .nullable(),
            ),
          })
          .strict(),
        email: z
          .object({
            enabled: z.boolean(),
            recipients: z
              .array(z.string().trim().email().max(254))
              .max(STATUS_ALERT_LIMITS.EMAIL_MAX)
              .transform((emails) => unique(emails.map((email) => email.toLowerCase()))),
          })
          .strict(),
        workNotice: z
          .object({
            enabled: z.boolean(),
            recipientMode: z.enum(['roles', 'users']),
            roles: z
              .array(alertRoleSchema)
              .max(PLATFORM_ADMIN_ALERT_ROLE_KEYS.length)
              .transform((roles) => unique(roles)),
            userIds: z
              .array(z.string().trim().min(1).max(STATUS_ALERT_LIMITS.USER_ID_MAX))
              .max(STATUS_ALERT_LIMITS.USER_IDS_MAX)
              .transform((ids) => unique(ids)),
          })
          .strict(),
      })
      .strict(),
    dingtalkApiDailyThreshold: z
      .number()
      .int()
      .min(0)
      .max(STATUS_ALERT_LIMITS.THRESHOLD_MAX)
      .nullable(),
    enabled: z.boolean(),
    notifyOnRecovery: z.boolean(),
    repeatIntervalHours: z
      .number()
      .int()
      .min(STATUS_ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MIN)
      .max(STATUS_ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MAX),
    rules: z
      .object({
        capabilities: z.boolean(),
        dependencies: z.boolean(),
        dingtalkApiBudget: z.boolean(),
        runtimeErrors: z.boolean(),
        workers: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channels.email.enabled && value.channels.email.recipients.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one recipient is required when email alerts are enabled',
        path: ['channels', 'email', 'recipients'],
      });
    }
  });

export type StatusAlertSettings = z.infer<typeof statusAlertSettingsSchema>;

export const statusAlertRobotSecretInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
  z
    .object({
      action: z.literal('replace'),
      value: z.string().trim().min(1).max(STATUS_ALERT_LIMITS.ROBOT_SECRET_MAX),
    })
    .strict(),
]);

export type StatusAlertRobotSecretInput = z.infer<typeof statusAlertRobotSecretInputSchema>;

/** Omitted means keep. `value` uses the same DingTalk robot webhook rule as stored settings. */
export const statusAlertRobotWebhookInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
  z
    .object({
      action: z.literal('replace'),
      value: z
        .string()
        .trim()
        .min(1)
        .max(STATUS_ALERT_LIMITS.WEBHOOK_MAX)
        .regex(DINGTALK_ROBOT_WEBHOOK_PATTERN, 'webhook must be a DingTalk robot URL'),
    })
    .strict(),
]);

export type StatusAlertRobotWebhookInput = z.infer<typeof statusAlertRobotWebhookInputSchema>;

/** Masked webhook. The access token is reduced to its last four characters. */
export const dingtalkRobotWebhookHint = (webhookUrl: string): string | null => {
  if (!DINGTALK_ROBOT_WEBHOOK_PATTERN.test(webhookUrl)) return null;
  const token = webhookUrl.slice(webhookUrl.lastIndexOf('=') + 1);
  return `https://oapi.dingtalk.com/robot/send?access_token=…${token.slice(-4)}`;
};

export const DEFAULT_STATUS_ALERT_SETTINGS: StatusAlertSettings = {
  channels: {
    dingtalkRobot: { enabled: false, keyword: null, webhookUrl: null },
    email: { enabled: false, recipients: [] },
    workNotice: {
      enabled: true,
      recipientMode: 'roles',
      roles: [...PLATFORM_ADMIN_ALERT_ROLE_KEYS],
      userIds: [],
    },
  },
  dingtalkApiDailyThreshold: null,
  enabled: true,
  notifyOnRecovery: true,
  repeatIntervalHours: 6,
  rules: {
    capabilities: true,
    dependencies: true,
    dingtalkApiBudget: true,
    runtimeErrors: true,
    workers: true,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Valid plaintext webhook still sitting in stored jsonb (dev rows from before encryption). */
export const readStatusAlertWebhookUrl = (config: unknown): string | null => {
  if (!isRecord(config)) return null;
  const channels = isRecord(config.channels) ? config.channels : null;
  if (!channels) return null;
  const robot = isRecord(channels.dingtalkRobot) ? channels.dingtalkRobot : null;
  if (!robot || typeof robot.webhookUrl !== 'string') return null;
  const webhookUrl = robot.webhookUrl.trim();
  return DINGTALK_ROBOT_WEBHOOK_PATTERN.test(webhookUrl) ? webhookUrl : null;
};

/** Stored config never keeps the webhook; it lives in the encrypted column. */
export const stripStatusAlertWebhookUrl = (
  config: Record<string, unknown>,
): Record<string, unknown> => {
  const channels = isRecord(config.channels) ? { ...config.channels } : {};
  const robot = isRecord(channels.dingtalkRobot) ? { ...channels.dingtalkRobot } : {};
  robot.webhookUrl = null;
  channels.dingtalkRobot = robot;
  return { ...config, channels };
};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asStringArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Fill omitted or invalid fields from {@link DEFAULT_STATUS_ALERT_SETTINGS}.
 * Stored jsonb may be partial; reads must not throw on a corrupt document.
 */
export const normalizeStatusAlertSettings = (partial: unknown): StatusAlertSettings => {
  const raw = isRecord(partial) ? partial : {};
  const channels = isRecord(raw.channels) ? raw.channels : {};
  const workNotice = isRecord(channels.workNotice) ? channels.workNotice : {};
  const robot = isRecord(channels.dingtalkRobot) ? channels.dingtalkRobot : {};
  const email = isRecord(channels.email) ? channels.email : {};
  const rules = isRecord(raw.rules) ? raw.rules : {};

  const recipientMode = workNotice.recipientMode === 'users' ? 'users' : 'roles';
  const roles = unique(
    asStringArray(workNotice.roles).filter(
      (role): role is PlatformAdminAlertRole =>
        typeof role === 'string' &&
        (PLATFORM_ADMIN_ALERT_ROLE_KEYS as readonly string[]).includes(role),
    ),
  );
  const keywordRaw = typeof robot.keyword === 'string' ? robot.keyword.trim() : '';
  const keyword =
    keywordRaw.length > 0 && keywordRaw.length <= STATUS_ALERT_LIMITS.KEYWORD_MAX
      ? keywordRaw
      : null;
  const emailLike = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
  const recipients = unique(
    asStringArray(email.recipients)
      .filter((item): item is string => typeof item === 'string' && emailLike.test(item.trim()))
      .map((item) => item.trim().toLowerCase()),
  ).slice(0, STATUS_ALERT_LIMITS.EMAIL_MAX);
  const userIds = unique(
    asStringArray(workNotice.userIds)
      .filter(
        (item): item is string =>
          typeof item === 'string' &&
          item.trim().length > 0 &&
          item.trim().length <= STATUS_ALERT_LIMITS.USER_ID_MAX,
      )
      .map((item) => item.trim()),
  ).slice(0, STATUS_ALERT_LIMITS.USER_IDS_MAX);
  const threshold = raw.dingtalkApiDailyThreshold;
  const repeat = raw.repeatIntervalHours;
  const repeatIntervalHours =
    typeof repeat === 'number' &&
    Number.isInteger(repeat) &&
    repeat >= STATUS_ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MIN &&
    repeat <= STATUS_ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MAX
      ? repeat
      : DEFAULT_STATUS_ALERT_SETTINGS.repeatIntervalHours;
  const dingtalkApiDailyThreshold =
    threshold === null || threshold === undefined
      ? null
      : typeof threshold === 'number' &&
          Number.isInteger(threshold) &&
          threshold >= 0 &&
          threshold <= STATUS_ALERT_LIMITS.THRESHOLD_MAX
        ? threshold
        : null;
  const robotEnabled = asBoolean(robot.enabled, false);
  const emailEnabled = asBoolean(email.enabled, false) && recipients.length > 0;
  const candidate = {
    channels: {
      dingtalkRobot: { enabled: robotEnabled, keyword, webhookUrl: null },
      email: { enabled: emailEnabled, recipients },
      workNotice: {
        enabled: asBoolean(workNotice.enabled, true),
        recipientMode,
        roles:
          workNotice.roles === undefined
            ? [...DEFAULT_STATUS_ALERT_SETTINGS.channels.workNotice.roles]
            : roles,
        userIds,
      },
    },
    dingtalkApiDailyThreshold,
    enabled: asBoolean(raw.enabled, true),
    notifyOnRecovery: asBoolean(raw.notifyOnRecovery, true),
    repeatIntervalHours,
    rules: {
      capabilities: asBoolean(rules.capabilities, true),
      dependencies: asBoolean(rules.dependencies, true),
      dingtalkApiBudget: asBoolean(rules.dingtalkApiBudget, true),
      runtimeErrors: asBoolean(rules.runtimeErrors, true),
      workers: asBoolean(rules.workers, true),
    },
  };

  const parsed = statusAlertSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_STATUS_ALERT_SETTINGS;
};
