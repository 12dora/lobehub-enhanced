export const ReminderIdentifier = 'lobe-reminder';

export const ReminderApiName = {
  cancelReminder: 'cancelReminder',
  createReminder: 'createReminder',
  listReminders: 'listReminders',
  searchDirectory: 'searchDirectory',
} as const;

export type ReminderApiNameType = (typeof ReminderApiName)[keyof typeof ReminderApiName];

export type ReminderRecipientKind = 'department' | 'user';

export interface ReminderRecipientInput {
  deptId?: string;
  kind: ReminderRecipientKind;
  staffId?: string;
}

export interface ReminderRepeatRule {
  freq: 'daily' | 'monthly' | 'weekly';
  monthDays?: number[];
  time: string;
  until?: string;
  weekdays?: number[];
}

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
  fireAt: string;
  recipients: ReminderRecipientInput[];
  repeat?: ReminderRepeatRule;
}

export interface ReminderRecipientView {
  deptId?: string | null;
  deptName?: string;
  deptPath?: string;
  displayName: string;
  kind: ReminderRecipientKind;
  memberCount?: number | null;
  staffId?: string | null;
}

export interface ReminderView {
  content: string;
  creatorName: string;
  fireAt: Date | string;
  id: string;
  recipients?: ReminderRecipientView[];
  repeat?: ReminderRepeatRule | null;
  /** Alias used by DB / tRPC rows; prefer `repeat`. */
  repeatRule?: ReminderRepeatRule | null;
  status?: string;
}

export interface NeedsConfirmationAudience {
  deptId: string;
  memberCount: number;
  name: string;
}

export interface NeedsConfirmationResult {
  audience: NeedsConfirmationAudience[];
  needsConfirmation: true;
}

export interface CreateReminderState {
  audience?: NeedsConfirmationAudience[];
  needsConfirmation?: boolean;
  reminder?: ReminderView;
  success: boolean;
}

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

export interface ListRemindersState {
  count: number;
  items?: Array<ReceivedReminderView | ReminderView>;
  scope: 'created' | 'received';
  success: boolean;
}

export interface CancelReminderParams {
  id: string;
}

export interface CancelReminderState {
  id: string;
  success: boolean;
}

export const isNeedsConfirmationResult = (value: unknown): value is NeedsConfirmationResult => {
  if (!value || typeof value !== 'object') return false;
  return (value as { needsConfirmation?: unknown }).needsConfirmation === true;
};
