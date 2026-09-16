import type {
  AdminImConnectorNotifyAppTestInput,
  AdminImConnectorTestInput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
} from '@/enterprise/client/services/adminImConnectors';

/** Mirrors the contract bounds in `apps/server/src/enterprise/contracts/adminImConnectors.ts`. */
export const IM_CONNECTOR_IDLE_HOURS_MIN = 1;
export const IM_CONNECTOR_IDLE_HOURS_MAX = 720;
export const IM_CONNECTOR_IDLE_HOURS_DEFAULT = 24;
const TEXT_MAX = 200;
const SECRET_MAX = 500;
/** The AgentId is a short numeric id; the contract caps it at 64. */
const AGENT_ID_MAX = 64;

/**
 * Draft state for a secret the server never returns.
 *
 * Unlike the infrastructure cards there is no 清除 action: the contract only knows `keep` and
 * `replace`, because a connector row without a secret cannot be stored at all. `fingerprint` is the
 * short display token the server sends so an admin can tell WHICH secret is stored.
 */
export interface ImConnectorSecretDraft {
  fingerprint: string | null;
  stored: boolean;
  value: string;
}

export interface DingTalkConnectorDraft {
  /** Optional: when empty the push/card buttons fall back to the plain https SSO URL. */
  agentId: string;
  aiCardTemplateId: string;
  chatEnabled: boolean;
  clientId: string;
  clientSecret: ImConnectorSecretDraft;
  /** Optional: when empty the stream worker captures the CorpId from the first inbound message. */
  corpId: string;
  enabled: boolean;
  idleNewTopicEnabled: boolean;
  /** `null` while the field is empty, so "unset" stays distinguishable from a typed 0. */
  idleNewTopicHours: number | null;
  /** 通知应用（服务号）AgentId — the numeric app id `asyncsend_v2` sends under. */
  notifyAgentId: string;
  /** 通知应用（服务号）AppKey. The whole block is optional: without it nothing is sent by it. */
  notifyAppKey: string;
  notifyAppSecret: ImConnectorSecretDraft;
  /** Notify-app 服务号 robot 1:1 channel. */
  notifyRobotEnabled: boolean;
  /** Notify-app work-notification (工作通知) channel. */
  notifyWorkNoticeEnabled: boolean;
  pushEnabled: boolean;
  robotCode: string;
  selectCardTemplateId: string;
}

export type DingTalkConnectorFieldErrors = Partial<
  Record<
    | 'agentId'
    | 'clientId'
    | 'clientSecret'
    | 'corpId'
    | 'robotCode'
    | 'notifyAgentId'
    | 'notifyAppKey'
    | 'notifyAppSecret'
    | 'idleNewTopicHours'
    | 'aiCardTemplateId'
    | 'selectCardTemplateId',
    string
  >
>;

export const toDingTalkDraft = (view: AdminImConnectorView): DingTalkConnectorDraft => ({
  agentId: view.agentId ?? '',
  aiCardTemplateId: view.aiCardTemplateId ?? '',
  chatEnabled: view.chatEnabled,
  clientId: view.clientId ?? '',
  clientSecret: {
    fingerprint: view.clientSecretFingerprint,
    stored: view.hasClientSecret,
    value: '',
  },
  corpId: view.corpId ?? '',
  enabled: view.enabled,
  idleNewTopicEnabled: view.idleNewTopicEnabled,
  idleNewTopicHours: view.idleNewTopicHours,
  notifyAgentId: view.notifyAgentId ?? '',
  notifyAppKey: view.notifyAppKey ?? '',
  // The notification app's secret has no fingerprint of its own — the server only says whether one
  // is stored, which is all the 已设置 placeholder needs.
  notifyAppSecret: { fingerprint: null, stored: view.notifyAppSecretSet, value: '' },
  notifyRobotEnabled: view.notifyRobotEnabled ?? true,
  notifyWorkNoticeEnabled: view.notifyWorkNoticeEnabled ?? true,
  pushEnabled: view.pushEnabled,
  robotCode: view.robotCode ?? '',
  selectCardTemplateId: view.selectCardTemplateId ?? '',
});

/**
 * Content identity of a draft — what 未保存 is decided from.
 *
 * The stored secret's fingerprint is part of it: it is the only identity the server gives a
 * credential, so a clean card has to adopt a rotated one when the list is re-read.
 */
export const fingerprintDingTalkDraft = (draft: DingTalkConnectorDraft): string =>
  JSON.stringify([
    draft.agentId.trim(),
    draft.aiCardTemplateId.trim(),
    draft.chatEnabled,
    draft.clientId.trim(),
    draft.clientSecret.fingerprint,
    draft.clientSecret.stored,
    draft.clientSecret.value,
    draft.corpId.trim(),
    draft.enabled,
    draft.idleNewTopicEnabled,
    draft.idleNewTopicHours,
    draft.notifyAgentId.trim(),
    draft.notifyAppKey.trim(),
    draft.notifyAppSecret.stored,
    draft.notifyAppSecret.value,
    draft.notifyRobotEnabled,
    draft.notifyWorkNoticeEnabled,
    draft.pushEnabled,
    draft.robotCode.trim(),
    draft.selectCardTemplateId.trim(),
  ]);

/**
 * State of a draft right after a successful save: the plaintext is dropped from memory and the
 * secret's identity is taken from the row the server just wrote, so the next save sends `keep` and
 * the fingerprint note names the credential that is actually stored — a rotation shows its new
 * fingerprint immediately rather than waiting on (and being ignored by) the list revalidation.
 */
export const settleDingTalkDraft = (
  draft: DingTalkConnectorDraft,
  saved: AdminImConnectorView,
): DingTalkConnectorDraft => ({
  ...draft,
  clientSecret: {
    fingerprint: saved.clientSecretFingerprint,
    stored: saved.hasClientSecret,
    value: '',
  },
  notifyAppSecret: { fingerprint: null, stored: saved.notifyAppSecretSet, value: '' },
});

/**
 * Validation mirrors the upsert contract rather than only the enable path: `clientId`, `robotCode`
 * and a secret are required by the schema for EVERY write, and `keep` is only a legal action when
 * something is already stored — so a save without them would be rejected server-side anyway.
 */
export const validateDingTalkDraft = (
  draft: DingTalkConnectorDraft,
): DingTalkConnectorFieldErrors => {
  const errors: DingTalkConnectorFieldErrors = {};

  const clientId = draft.clientId.trim();
  if (clientId.length === 0) errors.clientId = 'required';
  else if (clientId.length > TEXT_MAX) errors.clientId = 'tooLong';

  const robotCode = draft.robotCode.trim();
  if (robotCode.length === 0) errors.robotCode = 'required';
  else if (robotCode.length > TEXT_MAX) errors.robotCode = 'tooLong';

  const secret = draft.clientSecret.value.trim();
  if (secret.length === 0 && !draft.clientSecret.stored) errors.clientSecret = 'required';
  else if (secret.length > SECRET_MAX) errors.clientSecret = 'tooLong';

  if (draft.corpId.trim().length > TEXT_MAX) errors.corpId = 'tooLong';
  if (draft.agentId.trim().length > AGENT_ID_MAX) errors.agentId = 'tooLong';

  // The notification app is optional as a whole: a half-filled block is simply not configured
  // (the server reads it as absent), so only the lengths the contract caps are checked here.
  if (draft.notifyAppKey.trim().length > TEXT_MAX) errors.notifyAppKey = 'tooLong';
  if (draft.notifyAgentId.trim().length > AGENT_ID_MAX) errors.notifyAgentId = 'tooLong';
  if (draft.notifyAppSecret.value.trim().length > SECRET_MAX) errors.notifyAppSecret = 'tooLong';

  if (draft.aiCardTemplateId.trim().length > TEXT_MAX) errors.aiCardTemplateId = 'tooLong';
  if (draft.selectCardTemplateId.trim().length > TEXT_MAX) errors.selectCardTemplateId = 'tooLong';

  // The hours only have to be sane when they can actually start a topic, but an out-of-range value
  // left behind by a previous edit still blocks the write, so it is flagged either way.
  const hours = draft.idleNewTopicHours;
  if (
    hours === null ||
    !Number.isInteger(hours) ||
    hours < IM_CONNECTOR_IDLE_HOURS_MIN ||
    hours > IM_CONNECTOR_IDLE_HOURS_MAX
  )
    errors.idleNewTopicHours = 'idleHours';

  return errors;
};

const optionalText = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const toDingTalkUpsertInput = (
  draft: DingTalkConnectorDraft,
): AdminImConnectorUpsertInput => ({
  agentId: optionalText(draft.agentId),
  aiCardTemplateId: optionalText(draft.aiCardTemplateId),
  chatEnabled: draft.chatEnabled,
  clientId: draft.clientId.trim(),
  clientSecret:
    draft.clientSecret.value.trim().length > 0
      ? { action: 'replace', value: draft.clientSecret.value.trim() }
      : { action: 'keep' },
  corpId: optionalText(draft.corpId),
  enabled: draft.enabled,
  idleNewTopicEnabled: draft.idleNewTopicEnabled,
  idleNewTopicHours: draft.idleNewTopicHours ?? IM_CONNECTOR_IDLE_HOURS_DEFAULT,
  notifyAgentId: optionalText(draft.notifyAgentId),
  notifyAppKey: optionalText(draft.notifyAppKey),
  // Omitted rather than nulled when untouched: the contract reads an absent secret as `keep`, and
  // a stored one has to survive an edit of the AppKey beside it.
  ...(draft.notifyAppSecret.value.trim().length > 0
    ? {
        notifyAppSecret: {
          action: 'replace' as const,
          value: draft.notifyAppSecret.value.trim(),
        },
      }
    : {}),
  notifyRobotEnabled: draft.notifyRobotEnabled,
  notifyWorkNoticeEnabled: draft.notifyWorkNoticeEnabled,
  platform: 'dingtalk',
  pushEnabled: draft.pushEnabled,
  robotCode: draft.robotCode.trim(),
  selectCardTemplateId: optionalText(draft.selectCardTemplateId),
});

/**
 * Probe payload. Only what the admin actually typed is sent — an omitted field tells the server to
 * fall back to the stored row, which is how a saved connector can be re-tested without re-entering
 * its secret.
 */
export const toDingTalkTestInput = (draft: DingTalkConnectorDraft): AdminImConnectorTestInput => {
  const clientId = draft.clientId.trim();
  const robotCode = draft.robotCode.trim();
  const clientSecret = draft.clientSecret.value.trim();

  return {
    platform: 'dingtalk',
    ...(clientId.length > 0 ? { clientId } : {}),
    ...(clientSecret.length > 0 ? { clientSecret } : {}),
    ...(robotCode.length > 0 ? { robotCode } : {}),
  };
};

/**
 * Probe payload for the 通知应用（服务号）. Same rule as the robot's probe: only what the admin
 * actually typed is sent, so a saved notification app can be re-tested without re-entering it.
 */
export const toDingTalkNotifyTestInput = (
  draft: DingTalkConnectorDraft,
): AdminImConnectorNotifyAppTestInput => {
  const notifyAppKey = draft.notifyAppKey.trim();
  const notifyAppSecret = draft.notifyAppSecret.value.trim();

  return {
    ...(notifyAppKey.length > 0 ? { notifyAppKey } : {}),
    ...(notifyAppSecret.length > 0 ? { notifyAppSecret } : {}),
  };
};

/** The probe error codes the contract defines; anything else reads as an unknown failure. */
const IM_CONNECTOR_TEST_ERROR_CODES = new Set([
  'auth_failed',
  'missing_credentials',
  'network',
  'unknown',
]);

/** `admin` key for a probe failure — shared by the robot's 测试连接 and the notification app's 测试. */
export const resolveImConnectorTestErrorKey = (code: string | null | undefined): string =>
  `systemGeneral.imConnectors.test.errors.${
    code && IM_CONNECTOR_TEST_ERROR_CODES.has(code) ? code : 'unknown'
  }`;

/** Local timestamp for the status line; `—` when the worker never reported one. */
export const formatConnectorTime = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};
