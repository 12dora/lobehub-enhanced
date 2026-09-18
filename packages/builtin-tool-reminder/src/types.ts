import type { ReminderScheduleInput, ResolvedReminderRecipient } from '@lobechat/types';

export const ReminderIdentifier = 'lobe-reminder';

export const ReminderApiName = {
  cancelReminder: 'cancelReminder',
  createReminder: 'createReminder',
  listReminders: 'listReminders',
  searchDirectory: 'searchDirectory',
} as const;

export type ReminderApiNameType = (typeof ReminderApiName)[keyof typeof ReminderApiName];

export type ReminderRecipientKind = 'department' | 'user';

export interface DirectoryUserHit {
  active?: boolean;
  deptPath?: string;
  leafDeptId?: string | null;
  leafDeptName?: string;
  name: string;
  staffId: string;
}

export interface DirectoryDepartmentHit {
  deptId: string;
  memberCount?: number;
  name: string;
  pathNames?: string;
}

export interface SearchDirectoryParams {
  kind?: ReminderRecipientKind;
  q: string;
}

export interface SearchDirectoryState {
  ambiguous: boolean;
  departmentCount: number;
  hits?: {
    departments: DirectoryDepartmentHit[];
    users: DirectoryUserHit[];
  };
  serverNow?: string;
  userCount: number;
}

export interface CreateReminderParams {
  confirmLargeAudience?: boolean;
  content: string;
  recipients: string[];
  schedule: ReminderScheduleInput;
  /** ≤12-char summary used as the task name and DingTalk push title. */
  title?: string;
}

export interface ClarificationCandidate {
  deptPath: string;
  leafDeptName: string;
  name: string;
  staffId: string;
}

export interface ClarificationAmbiguous {
  candidates: ClarificationCandidate[];
  query: string;
}

export interface NeedsConfirmationAudience {
  deptId: string;
  memberCount: number;
  name: string;
}

export interface CreatedReminderView {
  content: string;
  identifier: string;
  nextFireAt?: Date | string | null;
  recipients?: ResolvedReminderRecipient[];
  reminderId?: string;
  scheduleSummary?: string;
  taskId?: string;
}

export interface CreateReminderState {
  ambiguous?: ClarificationAmbiguous[];
  audience?: NeedsConfirmationAudience[];
  needsClarification?: boolean;
  needsConfirmation?: boolean;
  reminder?: CreatedReminderView;
  serverNow?: string;
  status?: 'created' | 'needs_clarification' | 'needs_confirmation';
  success: boolean;
  unknown?: string[];
  unknownSuggestions?: ClarificationUnknownSuggestion[];
}

export interface CreateReminderCreatedResult {
  reminder: {
    content: string;
    fireAt?: Date | string | null;
    id: string;
    recipients?: ResolvedReminderRecipient[];
  };
  status: 'created';
  task: {
    config?: unknown;
    id: string;
    identifier: string;
  };
}

/** Near matches for a recipient query that resolved to nobody (typo / near-homograph). */
export interface ClarificationUnknownSuggestion {
  candidates: ClarificationCandidate[];
  query: string;
}

export interface CreateReminderClarificationResult {
  ambiguous: ClarificationAmbiguous[];
  status: 'needs_clarification';
  unknown: string[];
  /** One entry per `unknown` query that has near matches; omitted/empty when none. */
  unknownSuggestions?: ClarificationUnknownSuggestion[];
}

export interface CreateReminderConfirmationResult {
  audience: NeedsConfirmationAudience[];
  status: 'needs_confirmation';
}

export type CreateReminderTaskResult =
  | CreateReminderCreatedResult
  | CreateReminderClarificationResult
  | CreateReminderConfirmationResult;

export interface ListRemindersParams {
  scope?: 'created' | 'received';
}

export interface ReceivedReminderView {
  content: string;
  creatorName: string;
  firedAt: Date | string;
  id: string;
  reminderId: string;
  status?: string;
}

export interface ListReminderCreatedRow {
  content?: string;
  fireAt?: Date | string;
  id?: string;
  lastFiredAt?: Date | string | null;
  nextFireAt?: Date | string | null;
  recipients?: ResolvedReminderRecipient[];
  reminderId?: string;
  scheduleSummary?: string;
  status?: string;
  taskId?: string;
  taskIdentifier?: string;
}

export interface ListReminderReceivedRow {
  content?: string;
  creatorName?: string;
  firedAt: Date | string;
  id?: string;
  reminderId?: string;
}

export type ListReminderRow = ListReminderCreatedRow | ListReminderReceivedRow;

const isDateLike = (value: unknown): value is Date | string =>
  typeof value === 'string' || value instanceof Date;

export const isListReminderReceivedRow = (value: unknown): value is ListReminderReceivedRow => {
  if (typeof value !== 'object' || value === null) return false;
  return 'firedAt' in value && isDateLike(value.firedAt);
};

export const isListReminderCreatedRow = (value: unknown): value is ListReminderCreatedRow => {
  if (typeof value !== 'object' || value === null) return false;
  if ('firedAt' in value) return false;
  const row = value as { fireAt?: unknown; nextFireAt?: unknown; taskIdentifier?: unknown };
  return (
    isDateLike(row.nextFireAt) || isDateLike(row.fireAt) || typeof row.taskIdentifier === 'string'
  );
};

export const isListReminderRow = (value: unknown): value is ListReminderRow =>
  isListReminderCreatedRow(value) || isListReminderReceivedRow(value);

export const listReminderRowTime = (row: ListReminderRow): Date | string => {
  if (isListReminderReceivedRow(row)) return row.firedAt;
  return row.nextFireAt ?? row.fireAt ?? '';
};

export interface ListRemindersCreatedState {
  count: number;
  items?: ListReminderCreatedRow[];
  scope: 'created';
  serverNow?: string;
  success: boolean;
}

export interface ListRemindersReceivedState {
  count: number;
  items?: ReceivedReminderView[];
  scope: 'received';
  serverNow?: string;
  success: boolean;
}

export type ListRemindersState = ListRemindersCreatedState | ListRemindersReceivedState;

export interface CancelReminderParams {
  taskId: string;
}

export interface CancelReminderState {
  serverNow?: string;
  success: boolean;
  taskId: string;
}

export const isNeedsConfirmationResult = (
  value: unknown,
): value is CreateReminderConfirmationResult => {
  if (!value || typeof value !== 'object') return false;
  return (value as { status?: unknown }).status === 'needs_confirmation';
};

export const isNeedsClarificationResult = (
  value: unknown,
): value is CreateReminderClarificationResult => {
  if (!value || typeof value !== 'object') return false;
  return (value as { status?: unknown }).status === 'needs_clarification';
};

export const isCreatedReminderResult = (value: unknown): value is CreateReminderCreatedResult => {
  if (!value || typeof value !== 'object') return false;
  return (value as { status?: unknown }).status === 'created';
};

/** Human label: 「姓名 · 部门」 or department name. */
export const formatReminderRecipientLabel = (recipient: {
  deptName?: string | null;
  displayName: string;
  kind: ReminderRecipientKind;
  memberCount?: number | null;
}): string => {
  if (recipient.kind === 'department') {
    return typeof recipient.memberCount === 'number'
      ? `${recipient.displayName} · ${recipient.memberCount} 人`
      : recipient.displayName;
  }
  return recipient.deptName
    ? `${recipient.displayName} · ${recipient.deptName}`
    : recipient.displayName;
};
