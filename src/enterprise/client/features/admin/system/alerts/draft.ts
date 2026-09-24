import {
  DINGTALK_ROBOT_WEBHOOK_PATTERN,
  PLATFORM_ADMIN_ALERT_ROLE_KEYS,
  STATUS_ALERT_LIMITS,
} from '@lobechat/types';
import { z } from 'zod';

import type { InfraSecretDraft } from '@/enterprise/client/features/admin/systemGeneral/infra/draft';
import type {
  AdminStatusAlertSettings,
  AdminStatusAlertsUpdateInput,
  AdminStatusAlertsView,
} from '@/enterprise/client/services/adminSystem';

type WorkNoticeSettings = AdminStatusAlertSettings['channels']['workNotice'];

export type AlertRecipientRole = WorkNoticeSettings['roles'][number];
export type AlertRecipientMode = WorkNoticeSettings['recipientMode'];
export type AlertRuleKey = keyof AdminStatusAlertSettings['rules'];

/** Display order of the recipient roles — the contract's own list. */
export const ALERT_RECIPIENT_ROLES: readonly AlertRecipientRole[] = PLATFORM_ADMIN_ALERT_ROLE_KEYS;

export const ALERT_RULE_KEYS = [
  'dependencies',
  'workers',
  'capabilities',
  'runtimeErrors',
  'dingtalkApiBudget',
] as const satisfies readonly AlertRuleKey[];

/** The server's own limits (`STATUS_ALERT_LIMITS`), so the form rejects what the server would. */
export const ALERT_LIMITS = STATUS_ALERT_LIMITS;

/** Same zod check the server applies to each recipient (`z.string().trim().email().max(254)`). */
const EMAIL_SCHEMA = z.string().trim().email().max(254);

export interface AlertRecipientUser {
  /** Disabled account: kept on the list, but no alert reaches it. */
  banned?: boolean;
  /** `null` until the server resolved the binding (a user picked in this session). */
  dingtalkBound: boolean | null;
  id: string;
  /**
   * Stored id the server no longer resolves (user deleted). Shown as 「已删除的用户」 so it can be
   * removed, and never sent back.
   */
  missing?: boolean;
  name: string;
}

/**
 * A write-only credential: `stored` is server truth, `value` what the admin typed, `cleared` the
 * explicit "remove it" toggle. Blank input keeps whatever is stored.
 */
export type AlertCredentialDraft = InfraSecretDraft;

export type AlertCredentialAction =
  { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export interface AlertSettingsDraft {
  email: { enabled: boolean; recipients: string[] };
  enabled: boolean;
  notifyOnRecovery: boolean;
  repeatIntervalHours: number | null;
  robot: {
    enabled: boolean;
    keyword: string;
    secret: AlertCredentialDraft;
    /** The webhook carries an access token, so it is write-only like the secret. */
    webhook: AlertCredentialDraft;
    /** Masked form of the stored webhook (`…access_token=…abcd`); never the token itself. */
    webhookHint: string | null;
  };
  rules: Record<AlertRuleKey, boolean>;
  /** `null` = use the default (env / built-in); `0` = never alert. */
  threshold: number | null;
  workNotice: {
    enabled: boolean;
    recipientMode: AlertRecipientMode;
    roles: AlertRecipientRole[];
    users: AlertRecipientUser[];
  };
}

export type AlertDraftErrorKey =
  | 'emailInvalid'
  | 'emailRequired'
  | 'emailTooMany'
  | 'repeatInterval'
  | 'rolesRequired'
  | 'secretInvalid'
  | 'threshold'
  | 'usersRequired'
  | 'webhookRequired'
  | 'webhookUrl';

/** Field → error key (translated under `system.alerts.errors.*`). */
export type AlertDraftField =
  | 'emailRecipients'
  | 'recipients'
  | 'repeatIntervalHours'
  | 'robotSecret'
  | 'threshold'
  | 'webhook';

export type AlertDraftErrors = Partial<Record<AlertDraftField, AlertDraftErrorKey>>;

/** Which delivery channel owns a field — used to point at the channel that blocks a save. */
export const ALERT_FIELD_CHANNEL: Partial<
  Record<AlertDraftField, 'dingtalkRobot' | 'email' | 'workNotice'>
> = {
  emailRecipients: 'email',
  recipients: 'workNotice',
  robotSecret: 'dingtalkRobot',
  webhook: 'dingtalkRobot',
};

const emptyCredential = (stored: boolean): AlertCredentialDraft => ({
  cleared: false,
  stored,
  value: '',
});

type ResolvedRecipient = AdminStatusAlertsView['recipientUsers'][number];

const toRecipientUser = (user: ResolvedRecipient): AlertRecipientUser => ({
  ...(user.banned ? { banned: true } : {}),
  dingtalkBound: user.dingtalkBound,
  id: user.id,
  name: user.name || user.id,
});

export const draftFromView = (view: AdminStatusAlertsView): AlertSettingsDraft => {
  const { settings } = view;
  const { dingtalkRobot, email, workNotice } = settings.channels;
  const resolved = new Map(view.recipientUsers.map((user) => [user.id, user]));

  return {
    email: { enabled: email.enabled, recipients: [...email.recipients] },
    enabled: settings.enabled,
    notifyOnRecovery: settings.notifyOnRecovery,
    repeatIntervalHours: settings.repeatIntervalHours,
    robot: {
      enabled: dingtalkRobot.enabled,
      keyword: dingtalkRobot.keyword ?? '',
      secret: emptyCredential(view.dingtalkRobotSecretSet),
      webhook: emptyCredential(view.dingtalkRobotWebhook.set),
      webhookHint: view.dingtalkRobotWebhook.hint,
    },
    rules: { ...settings.rules },
    threshold: settings.dingtalkApiDailyThreshold,
    workNotice: {
      enabled: workNotice.enabled,
      recipientMode: workNotice.recipientMode,
      roles: ALERT_RECIPIENT_ROLES.filter((role) => workNotice.roles.includes(role)),
      // `recipientUsers` lists existing users only; anything else was deleted.
      users: workNotice.userIds.map((id) => {
        const user = resolved.get(id);
        return user ? toRecipientUser(user) : { dingtalkBound: null, id, missing: true, name: id };
      }),
    },
  };
};

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Three-way pick: the operator's value where they changed it, the server's everywhere else. */
const pick = <T>(base: T, mine: T, theirs: T): T => (sameValue(mine, base) ? theirs : mine);

/**
 * After a revision conflict: apply only what the operator changed since `base` (the snapshot the
 * draft was seeded from) onto the newer server settings. Fields they never touched take the
 * server's new values, so saving the merge cannot silently revert someone else's edit.
 *
 * Credentials merge by intent (typed value / clear); whether one is stored, and every user's name
 * and status, always come from the newer snapshot.
 */
export const mergeAlertDraft = (
  base: AlertSettingsDraft,
  draft: AlertSettingsDraft,
  view: AdminStatusAlertsView,
): AlertSettingsDraft => {
  const fresh = draftFromView(view);
  const resolved = new Map(view.recipientUsers.map((user) => [user.id, user]));
  const credential = (
    baseValue: AlertCredentialDraft,
    mine: AlertCredentialDraft,
    theirs: AlertCredentialDraft,
  ): AlertCredentialDraft =>
    mine.value === baseValue.value && mine.cleared === baseValue.cleared
      ? theirs
      : { cleared: mine.cleared && theirs.stored, stored: theirs.stored, value: mine.value };
  const userIds = (users: readonly AlertRecipientUser[]) => users.map((user) => user.id);
  const users = sameValue(userIds(draft.workNotice.users), userIds(base.workNotice.users))
    ? fresh.workNotice.users
    : draft.workNotice.users.map((user) => {
        const match = resolved.get(user.id);
        return match ? toRecipientUser(match) : user;
      });

  return {
    email: {
      enabled: pick(base.email.enabled, draft.email.enabled, fresh.email.enabled),
      recipients: pick(base.email.recipients, draft.email.recipients, fresh.email.recipients),
    },
    enabled: pick(base.enabled, draft.enabled, fresh.enabled),
    notifyOnRecovery: pick(base.notifyOnRecovery, draft.notifyOnRecovery, fresh.notifyOnRecovery),
    repeatIntervalHours: pick(
      base.repeatIntervalHours,
      draft.repeatIntervalHours,
      fresh.repeatIntervalHours,
    ),
    robot: {
      enabled: pick(base.robot.enabled, draft.robot.enabled, fresh.robot.enabled),
      keyword: pick(base.robot.keyword, draft.robot.keyword, fresh.robot.keyword),
      secret: credential(base.robot.secret, draft.robot.secret, fresh.robot.secret),
      webhook: credential(base.robot.webhook, draft.robot.webhook, fresh.robot.webhook),
      webhookHint: fresh.robot.webhookHint,
    },
    rules: Object.fromEntries(
      ALERT_RULE_KEYS.map((key) => [
        key,
        pick(base.rules[key], draft.rules[key], fresh.rules[key]),
      ]),
    ) as Record<AlertRuleKey, boolean>,
    threshold: pick(base.threshold, draft.threshold, fresh.threshold),
    workNotice: {
      enabled: pick(base.workNotice.enabled, draft.workNotice.enabled, fresh.workNotice.enabled),
      recipientMode: pick(
        base.workNotice.recipientMode,
        draft.workNotice.recipientMode,
        fresh.workNotice.recipientMode,
      ),
      roles: pick(base.workNotice.roles, draft.workNotice.roles, fresh.workNotice.roles),
      users,
    },
  };
};

/**
 * What the server stores for this form — settings plus which credentials exist. Two snapshots with
 * the same value differ only in columns the form does not edit (token, jobs watermark), so the
 * newer revision can be adopted without touching the operator's edits.
 */
export const alertConfigFingerprint = (view: AdminStatusAlertsView): string =>
  JSON.stringify({
    secret: view.dingtalkRobotSecretSet,
    settings: view.settings,
    users: view.recipientUsers.map((user) => user.id),
    webhook: view.dingtalkRobotWebhook,
  });

/** First recipient the server would reject, so the error can name it. */
export const findInvalidEmail = (recipients: readonly string[]): string | undefined =>
  recipients.find((address) => !EMAIL_SCHEMA.safeParse(address).success);

/** Users still on the server: deleted ids are shown (so they can be removed) but never sent. */
export const storedUsers = (users: readonly AlertRecipientUser[]): AlertRecipientUser[] =>
  users.filter((user) => !user.missing);

/** Users a notice can actually reach: neither deleted nor disabled. */
export const deliverableUsers = (users: readonly AlertRecipientUser[]): AlertRecipientUser[] =>
  users.filter((user) => !user.missing && !user.banned);

/**
 * A typed value replaces (trimmed, as the server stores it), an explicit clear removes, anything
 * else — including whitespace — keeps what is stored.
 */
export const deriveCredentialAction = (credential: AlertCredentialDraft): AlertCredentialAction => {
  const value = credential.value.trim();
  if (value) return { action: 'replace', value };
  if (credential.cleared) return { action: 'clear' };
  return { action: 'keep' };
};

/** True when the channel would have a webhook after this draft is saved. */
const hasWebhook = (webhook: AlertCredentialDraft): boolean =>
  webhook.value.trim().length > 0 || (webhook.stored && !webhook.cleared);

/**
 * The robot's credential fields stay on screen while the channel is off but something is stored,
 * so a stored webhook / secret can still be cleared.
 */
export const isRobotBodyVisible = (draft: AlertSettingsDraft): boolean =>
  draft.robot.enabled || draft.robot.webhook.stored || draft.robot.secret.stored;

const isWholeNumberIn = (value: number | null, min: number, max: number): value is number =>
  value !== null && Number.isInteger(value) && value >= min && value <= max;

/**
 * Only what the operator can see is validated: a switched-off channel hides its fields, so a stale
 * value there must not block the save (it is simply not sent — see `toAlertsUpdateInput`).
 */
export const validateAlertDraft = (draft: AlertSettingsDraft): AlertDraftErrors => {
  const errors: AlertDraftErrors = {};
  const { email, robot, workNotice } = draft;

  // The server rejects an enabled work notice that reaches nobody (deleted and disabled users
  // do not count).
  if (workNotice.enabled) {
    if (workNotice.recipientMode === 'roles' && workNotice.roles.length === 0) {
      errors.recipients = 'rolesRequired';
    }
    if (workNotice.recipientMode === 'users' && deliverableUsers(workNotice.users).length === 0) {
      errors.recipients = 'usersRequired';
    }
  }

  if (isRobotBodyVisible(draft)) {
    const webhook = robot.webhook.value.trim();
    if (webhook && !DINGTALK_ROBOT_WEBHOOK_PATTERN.test(webhook)) {
      errors.webhook = 'webhookUrl';
    } else if (robot.enabled && !hasWebhook(robot.webhook)) {
      errors.webhook = 'webhookRequired';
    }

    const secret = robot.secret.value;
    if (
      secret.length > 0 &&
      (secret.trim().length === 0 || secret.trim().length > ALERT_LIMITS.ROBOT_SECRET_MAX)
    ) {
      errors.robotSecret = 'secretInvalid';
    }
  }

  if (email.enabled) {
    if (findInvalidEmail(email.recipients) !== undefined) {
      errors.emailRecipients = 'emailInvalid';
    } else if (email.recipients.length > ALERT_LIMITS.EMAIL_MAX) {
      errors.emailRecipients = 'emailTooMany';
    } else if (email.recipients.length === 0) {
      errors.emailRecipients = 'emailRequired';
    }
  }

  const { threshold } = draft;
  if (threshold !== null && !isWholeNumberIn(threshold, 0, ALERT_LIMITS.THRESHOLD_MAX)) {
    errors.threshold = 'threshold';
  }

  if (
    !isWholeNumberIn(
      draft.repeatIntervalHours,
      ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MIN,
      ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MAX,
    )
  ) {
    errors.repeatIntervalHours = 'repeatInterval';
  }

  return errors;
};

/** Normalises the recipients typed into the tags input: trimmed, lower-cased, de-duplicated. */
export const normalizeEmailRecipients = (values: readonly unknown[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw).trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const emptyToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * The settings document exactly as `alerts.update` expects it. Call only on a valid draft.
 *
 * - The webhook never travels in `settings` (it is a write-only credential, see `robotWebhook`).
 * - Only the recipients of the chosen mode are sent, and never a deleted user id.
 * - A switched-off email channel keeps only addresses the server would accept.
 */
export const toAlertSettings = (draft: AlertSettingsDraft): AdminStatusAlertSettings => {
  const { email, workNotice } = draft;
  const recipients = email.enabled
    ? [...email.recipients]
    : email.recipients
        .filter((address) => EMAIL_SCHEMA.safeParse(address).success)
        .slice(0, ALERT_LIMITS.EMAIL_MAX);

  return {
    channels: {
      dingtalkRobot: {
        enabled: draft.robot.enabled,
        keyword: emptyToNull(draft.robot.keyword),
        webhookUrl: null,
      },
      email: { enabled: email.enabled, recipients },
      workNotice: {
        enabled: workNotice.enabled,
        recipientMode: workNotice.recipientMode,
        roles: [...workNotice.roles],
        // Disabled users stay on the list (they may be re-enabled); deleted ones are dropped.
        userIds:
          workNotice.recipientMode === 'users'
            ? storedUsers(workNotice.users).map((user) => user.id)
            : [],
      },
    },
    dingtalkApiDailyThreshold: draft.threshold,
    enabled: draft.enabled,
    notifyOnRecovery: draft.notifyOnRecovery,
    repeatIntervalHours: draft.repeatIntervalHours ?? ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MIN,
    rules: { ...draft.rules },
  };
};

export const toAlertsUpdateInput = (
  draft: AlertSettingsDraft,
  expectedRevision: number,
): AdminStatusAlertsUpdateInput => {
  // Credential input is sent only while its fields are on screen and valid; otherwise whatever is
  // stored is kept.
  const errors = validateAlertDraft(draft);
  const robotVisible = isRobotBodyVisible(draft);
  const keep: AlertCredentialAction = { action: 'keep' };
  return {
    expectedRevision,
    robotSecret:
      robotVisible && !errors.robotSecret ? deriveCredentialAction(draft.robot.secret) : keep,
    robotWebhook:
      robotVisible && !errors.webhook ? deriveCredentialAction(draft.robot.webhook) : keep,
    settings: toAlertSettings(draft),
  };
};

/**
 * Identity of what a save would send. Display-only fields (user names, DingTalk binding, the
 * webhook hint) are left out so resolving a name never marks the form dirty.
 */
export const alertDraftFingerprint = (draft: AlertSettingsDraft): string =>
  JSON.stringify({
    ...draft,
    robot: {
      enabled: draft.robot.enabled,
      keyword: draft.robot.keyword,
      secret: { cleared: draft.robot.secret.cleared, value: draft.robot.secret.value },
      webhook: { cleared: draft.robot.webhook.cleared, value: draft.robot.webhook.value },
    },
    workNotice: { ...draft.workNotice, users: draft.workNotice.users.map((user) => user.id) },
  });
