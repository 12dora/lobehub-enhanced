/**
 * UI-facing shapes of the 定时提醒 payloads returned by `reminderService`.
 *
 * Kept local to the feature (and intentionally tolerant — dates may arrive as
 * ISO strings or `Date`) so the list renders the server contract of v1.5 §1/§3
 * without importing server-only types.
 */

export type ReminderStatus = 'canceled' | 'expired' | 'failed' | 'scheduled' | 'sent';

export type ReminderRepeatFreq = 'daily' | 'monthly' | 'weekly';

export interface ReminderRepeatRule {
  freq: ReminderRepeatFreq;
  /** 1..31, for `monthly` */
  monthDays?: number[];
  /** `HH:mm` in the reminder timezone */
  time: string;
  /** `YYYY-MM-DD`, inclusive end of the series */
  until?: string;
  /** 1..7, Monday = 1, for `weekly` */
  weekdays?: number[];
}

export interface ReminderRecipientView {
  deptId?: string | null;
  /** Smallest department name of a user recipient. */
  deptName?: string | null;
  deptPath?: string | null;
  displayName: string;
  id?: string;
  kind: 'department' | 'user';
  /** Departments only: subtree member count snapshot. */
  memberCount?: number | null;
  staffId?: string | null;
}

export interface CreatedReminderView {
  content: string;
  creatorName: string;
  fireAt: Date | string;
  id: string;
  lastFiredAt?: Date | string | null;
  recipients?: ReminderRecipientView[];
  repeatRule?: ReminderRepeatRule | null;
  status: ReminderStatus;
  timezone?: string | null;
}

export interface ReceivedReminderView {
  content: string;
  creatorName: string;
  firedAt: Date | string;
  /** Delivery id — the handle `hideReceived` takes. */
  id: string;
  reminderId: string;
  status?: string;
}
