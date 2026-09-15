import {
  type NotificationChannelSettings,
  type NotificationSettings,
  TASK_NOTIFICATION_CATEGORY,
  TASK_NOTIFICATION_TYPES,
  type TaskNotificationType,
} from '@/types/user/settings';

/**
 * Channels a user can steer for task reminders. `email` / `push` are deliberately
 * excluded: neither has a producer for the `task` category in this deployment, so
 * showing them would promise a delivery that never happens.
 */
export const REMINDER_CHANNELS = ['inbox', 'dingtalk'] as const;
export type ReminderChannelId = (typeof REMINDER_CHANNELS)[number];

export interface ReminderChannelDraft {
  enabled: boolean;
  items: Record<TaskNotificationType, boolean>;
}

export type ReminderDraft = Record<ReminderChannelId, ReminderChannelDraft>;

/**
 * Stored settings are sparse — a missing channel, a missing `enabled`, or a missing
 * per-type flag all mean "on" (the all-on default decided 2026-09-15). The draft is
 * the densified view the matrix binds to.
 */
const readChannel = (channel: NotificationChannelSettings | undefined): ReminderChannelDraft => {
  const items = channel?.items?.[TASK_NOTIFICATION_CATEGORY];

  return {
    enabled: channel?.enabled !== false,
    items: Object.fromEntries(
      TASK_NOTIFICATION_TYPES.map((type) => [type, items?.[type] !== false]),
    ) as Record<TaskNotificationType, boolean>,
  };
};

export const buildReminderDraft = (settings?: NotificationSettings): ReminderDraft =>
  Object.fromEntries(
    REMINDER_CHANNELS.map((channel) => [channel, readChannel(settings?.[channel])]),
  ) as ReminderDraft;

/**
 * Fold the draft back into the full `NotificationSettings` object: every channel the
 * modal does not own (email / push) and every category other than `task` is carried
 * over untouched, so saving reminders never silently resets generation or billing prefs.
 */
export const mergeReminderDraft = (
  draft: ReminderDraft,
  current: NotificationSettings = {},
): NotificationSettings => {
  const next: NotificationSettings = { ...current };

  for (const channel of REMINDER_CHANNELS) {
    const currentChannel = current[channel] ?? {};

    next[channel] = {
      ...currentChannel,
      enabled: draft[channel].enabled,
      items: {
        ...currentChannel.items,
        [TASK_NOTIFICATION_CATEGORY]: { ...draft[channel].items },
      },
    };
  }

  return next;
};

export const setChannelEnabled = (
  draft: ReminderDraft,
  channel: ReminderChannelId,
  enabled: boolean,
): ReminderDraft => ({ ...draft, [channel]: { ...draft[channel], enabled } });

export const setChannelItem = (
  draft: ReminderDraft,
  channel: ReminderChannelId,
  type: TaskNotificationType,
  enabled: boolean,
): ReminderDraft => ({
  ...draft,
  [channel]: { ...draft[channel], items: { ...draft[channel].items, [type]: enabled } },
});
