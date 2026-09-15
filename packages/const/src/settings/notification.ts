import type { NotificationSettings } from '@lobechat/types';

const TASK_ITEMS_ALL_ON = {
  task_completed: true,
  task_run_completed: true,
  task_run_failed: true,
  task_waiting_for_user: true,
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  dingtalk: {
    enabled: true,
    items: {
      task: TASK_ITEMS_ALL_ON,
    },
  },
  email: {
    enabled: true,
    items: {
      generation: {
        image_generation_completed: true,
        video_generation_completed: true,
      },
    },
  },
  inbox: {
    enabled: true,
    items: {
      generation: {
        image_generation_completed: true,
        video_generation_completed: true,
      },
      task: TASK_ITEMS_ALL_ON,
    },
  },
};
