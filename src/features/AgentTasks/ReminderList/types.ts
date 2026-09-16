/**
 * UI-facing shapes of the 定时提醒 payloads returned by `reminderService`.
 *
 * A reminder is a task (`tasks.config.reminder`); the rows below mirror the
 * `listCreated` / `listReceived` contracts of the reminder router. They are kept
 * local to the feature (and intentionally tolerant — dates may arrive as ISO
 * strings or `Date`) so the tables render without importing server-only types.
 */

/** Lifecycle of a reminder task, mirrored from `tasks.status`. */
export type CreatedReminderStatus = 'canceled' | 'completed' | 'scheduled';

/** Per-channel outcome of one delivery row. */
export type ReminderDeliveryStatus = 'failed' | 'sent' | 'skipped';

/**
 * Recipient chip input. `ResolvedReminderRecipient` (`@lobechat/types`) is
 * assignable to it; the nullable fields keep older/looser rows renderable.
 */
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

/** Aggregate of the last fire of a reminder. */
export interface ReminderDeliverySummary {
  failed: number;
  firedAt: Date | string;
  sent: number;
  skipped: number;
}

/** One row of 我发起的. */
export interface CreatedReminderRow {
  content: string;
  firedCount: number;
  lastDelivery?: ReminderDeliverySummary | null;
  lastFiredAt?: Date | string | null;
  nextFireAt?: Date | string | null;
  recipients?: ReminderRecipientView[];
  reminderId: string;
  /** Human schedule text built by the server, e.g. 「每周一、三 09:00」. */
  scheduleSummary: string;
  status: CreatedReminderStatus;
  taskId: string;
  /** Short identifier used by the task detail route (`/task/<identifier>`). */
  taskIdentifier: string;
}

/** One row of 我收到的 (a delivery addressed to the current user). */
export interface ReceivedReminderRow {
  content: string;
  creatorName: string;
  /** Work-notice failure detail. */
  failedReason?: string | null;
  firedAt: Date | string;
  /** Delivery id — the handle `hideReceived` takes. */
  id: string;
  reminderId: string;
  /** 服务号 robot failure detail. */
  robotFailedReason?: string | null;
  /** 服务号 robot outcome; null/absent when the channel was not used. */
  robotStatus?: ReminderDeliveryStatus | null;
  /** DingTalk work-notice outcome; null/absent when the channel was not used. */
  status?: ReminderDeliveryStatus | null;
}
