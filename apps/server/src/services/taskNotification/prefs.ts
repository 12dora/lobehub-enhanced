import { DEFAULT_NOTIFICATION_SETTINGS } from '@lobechat/const';
import type {
  NotificationChannelSettings,
  NotificationSettings,
  TaskNotificationType,
} from '@lobechat/types';
import { TASK_NOTIFICATION_CATEGORY } from '@lobechat/types';
import { merge } from '@lobechat/utils';

export const mergeNotificationSettings = (
  stored: NotificationSettings | null | undefined,
): NotificationSettings => merge(DEFAULT_NOTIFICATION_SETTINGS, stored ?? {});

/**
 * Channel enabled ⇔ `channel.enabled !== false && channel.items?.task?.[type] !== false`.
 * Missing channel / item = enabled (defaults are all-on).
 */
export const isChannelEnabledForType = (
  settings: NotificationSettings,
  channel: 'dingtalk' | 'inbox',
  type: TaskNotificationType,
): boolean => {
  const channelSettings: NotificationChannelSettings | undefined = settings[channel];
  if (channelSettings?.enabled === false) return false;
  if (channelSettings?.items?.[TASK_NOTIFICATION_CATEGORY]?.[type] === false) return false;
  return true;
};
