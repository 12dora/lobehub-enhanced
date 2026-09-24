import type { ApprovalAutomationTier } from '@lobechat/types';

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
/** 机器人名称 is a label, not an identifier — the contract caps it at 32. */
const ROBOT_DISPLAY_NAME_MAX = 32;

/**
 * 自动审批档位 in the order the select offers them, from the tier that allows nothing to the one
 * that allows the most. Only that order lives here — the tier itself is `ApprovalAutomationTier`
 * (`packages/types/src/dingtalk/approvalRule.ts`), and `satisfies` makes a divergence a type error.
 */
export const APPROVAL_AUTOMATION_TIER_OPTIONS = [
  'off',
  'strict',
  'moderate',
  'relaxed',
] as const satisfies readonly ApprovalAutomationTier[];

/** How much each tier allows — what「收紧」 is decided from. */
const APPROVAL_AUTOMATION_TIER_RANK: Record<ApprovalAutomationTier, number> = {
  moderate: 2,
  off: 0,
  relaxed: 3,
  strict: 1,
};

/**
 * The four 工作台能力 fields as the upsert carries them (contract §3.1).
 *
 * The contract defaults them, so `z.input` leaves them optional; the card always sends all four,
 * and this makes that part of its signature rather than a promise in a comment.
 */
export type DingTalkWorkspaceSettingsInput = Required<
  Pick<
    AdminImConnectorUpsertInput,
    | 'approvalAutomationTier'
    | 'workspaceApprovalEnabled'
    | 'workspaceCalendarEnabled'
    | 'workspaceTodoEnabled'
  >
>;

/**
 * The seven 个人数据授权 switches as the upsert carries them. Like the workspace four, the contract
 * defaults them (all off) and the card always sends every one.
 */
export type DingTalkPersonalSettingsInput = Required<
  Pick<
    AdminImConnectorUpsertInput,
    | 'personalChatEnabled'
    | 'personalDataEnabled'
    | 'personalDocsEnabled'
    | 'personalReportEnabled'
    | 'personalSheetsEnabled'
    | 'personalTodoEnabled'
    | 'personalWriteEnabled'
  >
>;

/**
 * What the 个人数据授权 block reads about the deployment rather than the row: whether the personal
 * data sidecar is configured, and how many members have authorized. Optional on the view.
 */
export interface DingTalkPersonalSummary {
  authorizedCount: number;
  brokerConfigured: boolean;
}

/**
 * What the server uses for an input left empty (contract §1.2 `fallbacks`): the CorpId the stream
 * worker captured from an inbound message, the confirm-card template id from the environment, and
 * the robot name used when none is set. Display only: a fallback is never written back unless the
 * admin actually edits the input.
 */
export interface DingTalkConnectorFallbacks {
  confirmCardTemplateId: string | null;
  corpId: string | null;
  robotDisplayName: string;
}

/** The inputs that are pre-filled from a fallback while their stored value is empty. */
export type DingTalkPrefillField = 'confirmCardTemplateId' | 'corpId';

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
  /** 自动审批档位 — the limits automatic approval rules are created and run under. */
  approvalAutomationTier: ApprovalAutomationTier;
  chatEnabled: boolean;
  clientId: string;
  clientSecret: ImConnectorSecretDraft;
  /**
   * Template id of the write-confirmation card. Pre-filled from the environment's id while the row
   * has none, so what is in force is what the input shows.
   */
  confirmCardTemplateId: string;
  /**
   * Optional: when empty the stream worker captures the CorpId from the first inbound message.
   * Pre-filled with that captured id while the row has none.
   */
  corpId: string;
  enabled: boolean;
  idleNewTopicEnabled: boolean;
  /** `null` while the field is empty, so "unset" stays distinguishable from a typed 0. */
  idleNewTopicHours: number | null;
  /** 通知应用 AgentId — the numeric app id `asyncsend_v2` sends under. */
  notifyAgentId: string;
  /** 通知应用 AppKey. The whole block is optional: without it nothing is sent by it. */
  notifyAppKey: string;
  notifyAppSecret: ImConnectorSecretDraft;
  /** The notification app's own robot, 1:1 messages (机器人消息). */
  notifyRobotEnabled: boolean;
  /** Notify-app work-notification (工作通知) channel. */
  notifyWorkNoticeEnabled: boolean;
  /** 个人数据授权: the member's own authorization via the sidecar — all off by default. */
  personalChatEnabled: boolean;
  personalDataEnabled: boolean;
  /** 文档 / 钉盘 / 知识库 reads of `lobe-dingtalk-docs`. */
  personalDocsEnabled: boolean;
  personalReportEnabled: boolean;
  /** 在线表格 / AI 表格 reads of `lobe-dingtalk-docs`. */
  personalSheetsEnabled: boolean;
  personalTodoEnabled: boolean;
  personalWriteEnabled: boolean;
  pushEnabled: boolean;
  robotCode: string;
  /** Optional label shown in the binding instructions; empty when the deployment never set one. */
  robotDisplayName: string;
  selectCardTemplateId: string;
  /** 工作台能力: the assistant acts as the member's own DingTalk identity — all three default off. */
  workspaceApprovalEnabled: boolean;
  workspaceCalendarEnabled: boolean;
  workspaceTodoEnabled: boolean;
}

export type DingTalkConnectorFieldErrors = Partial<
  Record<
    | 'agentId'
    | 'clientId'
    | 'clientSecret'
    | 'corpId'
    | 'robotCode'
    | 'robotDisplayName'
    | 'notifyAgentId'
    | 'notifyAppKey'
    | 'notifyAppSecret'
    | 'idleNewTopicHours'
    | 'aiCardTemplateId'
    | 'confirmCardTemplateId'
    | 'selectCardTemplateId',
    string
  >
>;

/**
 * The 工作台能力 half of a connector row.
 *
 * The four fields come off the view as concrete values: the server parses `settings` through the
 * contract's own schema, so a row that predates the feature already reads as「all off, 适中」 by the
 * time it reaches the card.
 */
export const readDingTalkWorkspaceSettings = (
  view: AdminImConnectorView,
): DingTalkWorkspaceSettingsInput => ({
  approvalAutomationTier: view.approvalAutomationTier,
  workspaceApprovalEnabled: view.workspaceApprovalEnabled,
  workspaceCalendarEnabled: view.workspaceCalendarEnabled,
  workspaceTodoEnabled: view.workspaceTodoEnabled,
});

/** The 个人数据授权 half of a connector row; a row that predates the feature reads as all off. */
export const readDingTalkPersonalSettings = (
  view: AdminImConnectorView,
): DingTalkPersonalSettingsInput => ({
  personalChatEnabled: view.personalChatEnabled ?? false,
  personalDataEnabled: view.personalDataEnabled ?? false,
  personalDocsEnabled: view.personalDocsEnabled ?? false,
  personalReportEnabled: view.personalReportEnabled ?? false,
  personalSheetsEnabled: view.personalSheetsEnabled ?? false,
  personalTodoEnabled: view.personalTodoEnabled ?? false,
  personalWriteEnabled: view.personalWriteEnabled ?? false,
});

/**
 * The view's live `personal` summary (sidecar configured, members authorized). It is shape-checked
 * rather than trusted: a card can still hold a view read before the field existed, and `null`
 * means「unknown」, not「not configured」.
 */
export const readDingTalkPersonalSummary = (
  view: AdminImConnectorView,
): DingTalkPersonalSummary | null => {
  const personal = view.personal as unknown;
  if (!personal || typeof personal !== 'object') return null;

  const { authorizedCount, brokerConfigured } = personal as Partial<
    Record<keyof DingTalkPersonalSummary, unknown>
  >;
  if (typeof brokerConfigured !== 'boolean') return null;

  return {
    authorizedCount:
      typeof authorizedCount === 'number' && Number.isFinite(authorizedCount) ? authorizedCount : 0,
    brokerConfigured,
  };
};

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type RawFallbacks = Partial<Record<keyof DingTalkConnectorFallbacks, unknown>>;

/**
 * The view's `fallbacks`, shape-checked rather than trusted: a card can still hold a view read
 * before the field existed, and a missing fallback simply means there is nothing to pre-fill.
 */
export const readDingTalkFallbacks = (view: AdminImConnectorView): DingTalkConnectorFallbacks => {
  const raw = (view as { fallbacks?: unknown }).fallbacks;
  const fallbacks: RawFallbacks = raw && typeof raw === 'object' ? (raw as RawFallbacks) : {};

  return {
    confirmCardTemplateId: readOptionalString(fallbacks.confirmCardTemplateId),
    corpId: readOptionalString(fallbacks.corpId),
    robotDisplayName: readOptionalString(fallbacks.robotDisplayName) ?? '',
  };
};

/** The value the row stores for a pre-fillable input; `null` when it stores none. */
const readStoredPrefillValue = (
  view: AdminImConnectorView,
  field: DingTalkPrefillField,
): string | null =>
  readOptionalString((view as Partial<Record<DingTalkPrefillField, unknown>>)[field]);

/**
 * Whether an input currently shows the server's fallback, untouched, rather than a stored value —
 * what the 自动获取 / 来自环境变量 tag is decided from. It stops being one the moment the admin
 * edits it, and never is while the row stores a value.
 */
export const isDingTalkFieldPrefilled = (
  view: AdminImConnectorView,
  draft: DingTalkConnectorDraft,
  field: DingTalkPrefillField,
): boolean => {
  if (readStoredPrefillValue(view, field) !== null) return false;
  const fallback = readDingTalkFallbacks(view)[field];
  return fallback !== null && draft[field].trim() === fallback;
};

const PREFILL_FIELDS: readonly DingTalkPrefillField[] = ['confirmCardTemplateId', 'corpId'];

const NO_UNTOUCHED_FALLBACKS: ReadonlySet<DingTalkPrefillField> = new Set();

/**
 * The inputs that still show an untouched fallback. They are display only: the save leaves them
 * out, so the row keeps storing what it stores and the runtime keeps following the fallback (a new
 * environment id, a re-captured CorpId); and validation skips them, so a fallback the admin never
 * typed can never block a save.
 *
 * Pass every reading the draft may have been pre-filled from — above all the one it was seeded
 * from: when the server's fallback changes while the card has unrelated edits, the value the
 * input was pre-filled with is still untouched, not an edit. Without a reading there are none.
 */
export const readDingTalkUntouchedFallbacks = (
  draft: DingTalkConnectorDraft,
  ...views: (AdminImConnectorView | undefined)[]
): ReadonlySet<DingTalkPrefillField> =>
  new Set(
    PREFILL_FIELDS.filter((field) =>
      views.some((view) => view !== undefined && isDingTalkFieldPrefilled(view, draft, field)),
    ),
  );

/**
 * The groups of the card the deployment has installed (contract §2.2). A hidden group's fields are
 * neither validated nor edited: the save sends them exactly as the server holds them.
 */
export interface DingTalkConnectorGroups {
  /** 审批 switch and the 自动审批档位 (`dingtalkApproval`). */
  approval: boolean;
  /** 机器人对话 (`dingtalkChat`). */
  chat: boolean;
  /** 文档 / 表格 scopes of 个人数据授权 (`dingtalkDocs`). */
  docs: boolean;
  /** 通知应用 (`dingtalkNotify`). */
  notify: boolean;
  /** 个人数据授权 (`dingtalkPersonal`). */
  personal: boolean;
  /** 待办 / 日程 switches of 工作台能力 (`dingtalkWorkspace`). */
  workspace: boolean;
}

type DingTalkDraftField = keyof DingTalkConnectorDraft;

/** The draft fields each hideable group renders. */
const GROUP_FIELDS: Record<keyof DingTalkConnectorGroups, readonly DingTalkDraftField[]> = {
  approval: ['approvalAutomationTier', 'workspaceApprovalEnabled'],
  chat: [
    'aiCardTemplateId',
    'chatEnabled',
    'confirmCardTemplateId',
    'idleNewTopicEnabled',
    'idleNewTopicHours',
    'selectCardTemplateId',
  ],
  docs: ['personalDocsEnabled', 'personalSheetsEnabled'],
  notify: [
    'notifyAgentId',
    'notifyAppKey',
    'notifyAppSecret',
    'notifyRobotEnabled',
    'notifyWorkNoticeEnabled',
    'pushEnabled',
  ],
  personal: [
    'personalChatEnabled',
    'personalDataEnabled',
    'personalDocsEnabled',
    'personalReportEnabled',
    'personalSheetsEnabled',
    'personalTodoEnabled',
    'personalWriteEnabled',
  ],
  workspace: ['workspaceCalendarEnabled', 'workspaceTodoEnabled'],
};

/**
 * The draft as it can be saved: every field of a group the card does not render is put back to
 * the server's value (`baseline`). An edit made before a module was switched off elsewhere can then
 * neither block the save through validation nor be written behind the admin's back.
 */
export const keepHiddenDingTalkGroups = (
  draft: DingTalkConnectorDraft,
  baseline: DingTalkConnectorDraft,
  groups: DingTalkConnectorGroups,
): DingTalkConnectorDraft => {
  const hidden = (Object.keys(GROUP_FIELDS) as (keyof DingTalkConnectorGroups)[]).filter(
    (group) => !groups[group],
  );
  if (hidden.length === 0) return draft;

  const restored: Record<string, unknown> = { ...draft };
  for (const group of hidden)
    for (const field of GROUP_FIELDS[group]) restored[field] = baseline[field];
  return restored as unknown as DingTalkConnectorDraft;
};

/**
 * Seed of the card's draft.
 *
 * An input shows the stored value; when that is empty and the server has a fallback (the captured
 * CorpId, the environment's confirm-card template), the fallback is pre-filled instead (contract
 * §1.2). It is part of the seed, so it is the baseline the card compares against — not an unsaved
 * edit — and, untouched, it is never sent (`readDingTalkUntouchedFallbacks`). The robot name is
 * not pre-filled at all: its fallback is a placeholder only.
 */
export const toDingTalkDraft = (view: AdminImConnectorView): DingTalkConnectorDraft => {
  const workspace = readDingTalkWorkspaceSettings(view);
  const personal = readDingTalkPersonalSettings(view);
  const fallbacks = readDingTalkFallbacks(view);

  return {
    agentId: view.agentId ?? '',
    aiCardTemplateId: view.aiCardTemplateId ?? '',
    approvalAutomationTier: workspace.approvalAutomationTier,
    chatEnabled: view.chatEnabled,
    clientId: view.clientId ?? '',
    clientSecret: {
      fingerprint: view.clientSecretFingerprint,
      stored: view.hasClientSecret,
      value: '',
    },
    confirmCardTemplateId:
      readStoredPrefillValue(view, 'confirmCardTemplateId') ??
      fallbacks.confirmCardTemplateId ??
      '',
    corpId: readStoredPrefillValue(view, 'corpId') ?? fallbacks.corpId ?? '',
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
    personalChatEnabled: personal.personalChatEnabled,
    personalDataEnabled: personal.personalDataEnabled,
    personalDocsEnabled: personal.personalDocsEnabled,
    personalReportEnabled: personal.personalReportEnabled,
    personalSheetsEnabled: personal.personalSheetsEnabled,
    personalTodoEnabled: personal.personalTodoEnabled,
    personalWriteEnabled: personal.personalWriteEnabled,
    pushEnabled: view.pushEnabled,
    robotCode: view.robotCode ?? '',
    // Optional on the view so a row written before the field existed still parses.
    robotDisplayName: view.robotDisplayName ?? '',
    selectCardTemplateId: view.selectCardTemplateId ?? '',
    workspaceApprovalEnabled: workspace.workspaceApprovalEnabled,
    workspaceCalendarEnabled: workspace.workspaceCalendarEnabled,
    workspaceTodoEnabled: workspace.workspaceTodoEnabled,
  };
};

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
    draft.approvalAutomationTier,
    draft.chatEnabled,
    draft.clientId.trim(),
    draft.clientSecret.fingerprint,
    draft.clientSecret.stored,
    draft.clientSecret.value,
    draft.confirmCardTemplateId.trim(),
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
    draft.personalChatEnabled,
    draft.personalDataEnabled,
    draft.personalDocsEnabled,
    draft.personalReportEnabled,
    draft.personalSheetsEnabled,
    draft.personalTodoEnabled,
    draft.personalWriteEnabled,
    draft.pushEnabled,
    draft.robotCode.trim(),
    draft.robotDisplayName.trim(),
    draft.selectCardTemplateId.trim(),
    draft.workspaceApprovalEnabled,
    draft.workspaceCalendarEnabled,
    draft.workspaceTodoEnabled,
  ]);

/**
 * State of a draft right after a successful save: the plaintext is dropped from memory and the
 * secret's identity is taken from the row the server just wrote, so the next save sends `keep` and
 * the fingerprint note names the credential that is actually stored — a rotation shows its new
 * fingerprint immediately rather than waiting on (and being ignored by) the list revalidation.
 * The 个人数据授权 switches are taken from that row too, so the card shows what is in force.
 */
export const settleDingTalkDraft = (
  draft: DingTalkConnectorDraft,
  saved: AdminImConnectorView,
): DingTalkConnectorDraft => {
  // An input the row now stores nothing for shows its fallback again, exactly as a fresh seed
  // would: clearing a pre-filled input means「use the fallback」, and that is what it then says.
  const fallbacks = readDingTalkFallbacks(saved);
  const refill = (field: DingTalkPrefillField): string => {
    if (readStoredPrefillValue(saved, field) !== null) return draft[field];
    return draft[field].trim().length === 0 ? (fallbacks[field] ?? draft[field]) : draft[field];
  };

  return {
    ...draft,
    ...readDingTalkPersonalSettings(saved),
    clientSecret: {
      fingerprint: saved.clientSecretFingerprint,
      stored: saved.hasClientSecret,
      value: '',
    },
    confirmCardTemplateId: refill('confirmCardTemplateId'),
    corpId: refill('corpId'),
    notifyAppSecret: { fingerprint: null, stored: saved.notifyAppSecretSet, value: '' },
  };
};

/**
 * Validation mirrors the upsert contract rather than only the enable path: `clientId`, `robotCode`
 * and a secret are required by the schema for EVERY write, and `keep` is only a legal action when
 * something is already stored — so a save without them would be rejected server-side anyway.
 */
export const validateDingTalkDraft = (
  draft: DingTalkConnectorDraft,
  /** Inputs still showing their untouched fallback (`readDingTalkUntouchedFallbacks`): skipped. */
  untouched: ReadonlySet<DingTalkPrefillField> = NO_UNTOUCHED_FALLBACKS,
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

  if (!untouched.has('corpId') && draft.corpId.trim().length > TEXT_MAX) errors.corpId = 'tooLong';
  if (draft.agentId.trim().length > AGENT_ID_MAX) errors.agentId = 'tooLong';
  // Optional: a deployment that never set a robot name simply has none to show.
  if (draft.robotDisplayName.trim().length > ROBOT_DISPLAY_NAME_MAX)
    errors.robotDisplayName = 'tooLong';

  // The notification app is optional as a whole: a half-filled block is simply not configured
  // (the server reads it as absent), so only the lengths the contract caps are checked here.
  if (draft.notifyAppKey.trim().length > TEXT_MAX) errors.notifyAppKey = 'tooLong';
  if (draft.notifyAgentId.trim().length > AGENT_ID_MAX) errors.notifyAgentId = 'tooLong';
  if (draft.notifyAppSecret.value.trim().length > SECRET_MAX) errors.notifyAppSecret = 'tooLong';

  if (draft.aiCardTemplateId.trim().length > TEXT_MAX) errors.aiCardTemplateId = 'tooLong';
  if (draft.selectCardTemplateId.trim().length > TEXT_MAX) errors.selectCardTemplateId = 'tooLong';
  // An over-long environment id is shown as it is, but it is not the admin's input to correct.
  if (
    !untouched.has('confirmCardTemplateId') &&
    draft.confirmCardTemplateId.trim().length > TEXT_MAX
  )
    errors.confirmCardTemplateId = 'tooLong';

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

/**
 * The whole row, 工作台能力 and 个人数据授权 included: they live in the same `settings` jsonb as the
 * rest, so both sections are saved by the card's own 保存 rather than by a call of their own.
 *
 * An input that still shows its untouched fallback (`untouched`, from
 * `readDingTalkUntouchedFallbacks`) is left out of the payload, so the row keeps what it stores and
 * the fallback stays in force. An edit — clearing the input included — is always sent.
 */
export const toDingTalkUpsertInput = (
  draft: DingTalkConnectorDraft,
  untouched: ReadonlySet<DingTalkPrefillField> = NO_UNTOUCHED_FALLBACKS,
): AdminImConnectorUpsertInput &
  DingTalkPersonalSettingsInput &
  DingTalkWorkspaceSettingsInput => ({
  agentId: optionalText(draft.agentId),
  aiCardTemplateId: optionalText(draft.aiCardTemplateId),
  approvalAutomationTier: draft.approvalAutomationTier,
  chatEnabled: draft.chatEnabled,
  clientId: draft.clientId.trim(),
  clientSecret:
    draft.clientSecret.value.trim().length > 0
      ? { action: 'replace', value: draft.clientSecret.value.trim() }
      : { action: 'keep' },
  ...(untouched.has('confirmCardTemplateId')
    ? {}
    : { confirmCardTemplateId: optionalText(draft.confirmCardTemplateId) }),
  ...(untouched.has('corpId') ? {} : { corpId: optionalText(draft.corpId) }),
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
  personalChatEnabled: draft.personalChatEnabled,
  personalDataEnabled: draft.personalDataEnabled,
  personalDocsEnabled: draft.personalDocsEnabled,
  personalReportEnabled: draft.personalReportEnabled,
  personalSheetsEnabled: draft.personalSheetsEnabled,
  personalTodoEnabled: draft.personalTodoEnabled,
  personalWriteEnabled: draft.personalWriteEnabled,
  platform: 'dingtalk',
  pushEnabled: draft.pushEnabled,
  robotCode: draft.robotCode.trim(),
  robotDisplayName: optionalText(draft.robotDisplayName),
  selectCardTemplateId: optionalText(draft.selectCardTemplateId),
  workspaceApprovalEnabled: draft.workspaceApprovalEnabled,
  workspaceCalendarEnabled: draft.workspaceCalendarEnabled,
  workspaceTodoEnabled: draft.workspaceTodoEnabled,
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
 * Probe payload for the 通知应用. Same rule as the robot's probe: only what the admin
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

/**
 * Whether the 通知应用 is usable as it stands.
 *
 * The workspace capabilities run on that app's token, so this is the section's precondition: an
 * AppKey with a secret either stored or just typed. The AgentId only matters to 工作通知, which is
 * why it is not part of it.
 */
export const isDingTalkNotifyAppConfigured = (draft: DingTalkConnectorDraft): boolean =>
  draft.notifyAppKey.trim().length > 0 &&
  (draft.notifyAppSecret.stored || draft.notifyAppSecret.value.trim().length > 0);

/**
 * The tier change that costs something, or `null` when nothing has to be explained.
 *
 * Only tightening reaches rules that already exist (§3.1): 严格 shortens their expiry and notifies
 * their owners, 关闭 stops them from running. Loosening takes nothing away, so it saves silently.
 */
export const resolveApprovalTierTightening = (
  previous: ApprovalAutomationTier,
  next: ApprovalAutomationTier,
): 'off' | 'strict' | null => {
  if (next === previous) return null;
  if (next !== 'off' && next !== 'strict') return null;

  return APPROVAL_AUTOMATION_TIER_RANK[next] < APPROVAL_AUTOMATION_TIER_RANK[previous]
    ? next
    : null;
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
