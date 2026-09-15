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

/** Delivery channels persisted in `notification_deliveries.channel`. */
export type NotificationDeliveryChannel = 'email' | 'inbox' | 'push' | 'dingtalk';

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
