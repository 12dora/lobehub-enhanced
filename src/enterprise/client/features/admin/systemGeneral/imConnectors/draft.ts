import type {
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
  aiCardTemplateId: string;
  chatEnabled: boolean;
  clientId: string;
  clientSecret: ImConnectorSecretDraft;
  enabled: boolean;
  idleNewTopicEnabled: boolean;
  /** `null` while the field is empty, so "unset" stays distinguishable from a typed 0. */
  idleNewTopicHours: number | null;
  pushEnabled: boolean;
  robotCode: string;
  selectCardTemplateId: string;
}

export type DingTalkConnectorFieldErrors = Partial<
  Record<
    | 'clientId'
    | 'clientSecret'
    | 'robotCode'
    | 'idleNewTopicHours'
    | 'aiCardTemplateId'
    | 'selectCardTemplateId',
    string
  >
>;

export const toDingTalkDraft = (view: AdminImConnectorView): DingTalkConnectorDraft => ({
  aiCardTemplateId: view.aiCardTemplateId ?? '',
  chatEnabled: view.chatEnabled,
  clientId: view.clientId ?? '',
  clientSecret: {
    fingerprint: view.clientSecretFingerprint,
    stored: view.hasClientSecret,
    value: '',
  },
  enabled: view.enabled,
  idleNewTopicEnabled: view.idleNewTopicEnabled,
  idleNewTopicHours: view.idleNewTopicHours,
  pushEnabled: view.pushEnabled,
  robotCode: view.robotCode ?? '',
  selectCardTemplateId: view.selectCardTemplateId ?? '',
});

/** Content identity of a draft — what 未保存 is decided from. */
export const fingerprintDingTalkDraft = (draft: DingTalkConnectorDraft): string =>
  JSON.stringify([
    draft.aiCardTemplateId.trim(),
    draft.chatEnabled,
    draft.clientId.trim(),
    draft.clientSecret.stored,
    draft.clientSecret.value,
    draft.enabled,
    draft.idleNewTopicEnabled,
    draft.idleNewTopicHours,
    draft.pushEnabled,
    draft.robotCode.trim(),
    draft.selectCardTemplateId.trim(),
  ]);

/**
 * State of a draft right after a successful save: the plaintext is dropped from memory and the
 * secret now reads as stored, so the next save sends `keep` instead of re-sending what was typed.
 */
export const settleDingTalkDraft = (draft: DingTalkConnectorDraft): DingTalkConnectorDraft => ({
  ...draft,
  clientSecret: { ...draft.clientSecret, stored: true, value: '' },
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
  aiCardTemplateId: optionalText(draft.aiCardTemplateId),
  chatEnabled: draft.chatEnabled,
  clientId: draft.clientId.trim(),
  clientSecret:
    draft.clientSecret.value.trim().length > 0
      ? { action: 'replace', value: draft.clientSecret.value.trim() }
      : { action: 'keep' },
  enabled: draft.enabled,
  idleNewTopicEnabled: draft.idleNewTopicEnabled,
  idleNewTopicHours: draft.idleNewTopicHours ?? IM_CONNECTOR_IDLE_HOURS_DEFAULT,
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

/** Local timestamp for the status line; `—` when the worker never reported one. */
export const formatConnectorTime = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};
