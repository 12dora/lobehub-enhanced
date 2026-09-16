export interface NotificationChannelSettings {
  enabled?: boolean;
  /** Per-type overrides grouped by category. Missing = use scenario default (true) */
  items?: Record<string, Record<string, boolean>>;
}

/**
 * Notification category for task events (任务提醒). Producer: `TaskNotificationService`
 * (apps/server). Types are the `notifications.type` values and the keys under
 * `items.task` in every channel's settings. Missing = enabled.
 */
export const TASK_NOTIFICATION_CATEGORY = 'task' as const;
export const TASK_NOTIFICATION_TYPES = [
  /** A scheduled / heartbeat / manual run finished; `content` = the assistant's final output. */
  'task_run_completed',
  /** A run failed or timed out; `content` = failure reason. */
  'task_run_failed',
  /** The task is waiting for the user (verification / acceptance / agent question). */
  'task_waiting_for_user',
  /** The task reached `completed` because of an agent action. */
  'task_completed',
] as const;
export type TaskNotificationType = (typeof TASK_NOTIFICATION_TYPES)[number];

/**
 * Notification category for timed reminders (定时提醒). Producer: `ReminderService`
 * sweep (`apps/server/src/enterprise/services/reminder`). Types are the
 * `notifications.type` values and the keys under `items.reminder`. Missing = enabled.
 */
export const REMINDER_NOTIFICATION_CATEGORY = 'reminder' as const;
export const REMINDER_NOTIFICATION_TYPE_RECEIVED = 'reminder.received' as const;
export const REMINDER_NOTIFICATION_TYPES = [REMINDER_NOTIFICATION_TYPE_RECEIVED] as const;
export type ReminderNotificationType = (typeof REMINDER_NOTIFICATION_TYPES)[number];

/** Default per-type prefs for the reminder category. Missing = enabled. */
export const REMINDER_NOTIFICATION_DEFAULT_ITEMS = {
  [REMINDER_NOTIFICATION_TYPE_RECEIVED]: true,
} as const;

/** Delivery channels persisted in `notification_deliveries.channel`. */
export type NotificationDeliveryChannel = 'email' | 'inbox' | 'push' | 'dingtalk';

/** Lifecycle status persisted in `notification_deliveries.status`. */
export type NotificationDeliveryStatus = 'delivered' | 'failed' | 'pending' | 'sent' | 'skipped';

export interface NotificationSettings {
  /**
   * DingTalk push through the platform IM connector (管理端 → IM 连接器 → 钉钉). Only takes
   * effect for users whose account maps to a DingTalk staff id and when the connector's
   * `pushEnabled` is on. Missing = enabled (default all-on decision, 2026-09-15).
   */
  dingtalk?: NotificationChannelSettings;
  email?: NotificationChannelSettings;
  inbox?: NotificationChannelSettings;
  /**
   * Mobile push notifications (delivered via Expo Push Service → APNs/FCM).
   * Only takes effect for users with a registered Expo push token —
   * see `push_tokens` table.
   */
  push?: NotificationChannelSettings;
}
