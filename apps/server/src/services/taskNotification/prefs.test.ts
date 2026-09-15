import type { NotificationSettings, TaskNotificationType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isChannelEnabledForType, mergeNotificationSettings } from './prefs';

const type = 'task_run_completed' as const satisfies TaskNotificationType;

describe('isChannelEnabledForType', () => {
  const matrix: {
    channel: 'dingtalk' | 'inbox';
    expected: boolean;
    name: string;
    settings: NotificationSettings;
  }[] = [
    {
      channel: 'inbox',
      expected: true,
      name: 'defaults (missing = on)',
      settings: {},
    },
    {
      channel: 'dingtalk',
      expected: true,
      name: 'defaults dingtalk (missing = on)',
      settings: {},
    },
    {
      channel: 'inbox',
      expected: false,
      name: 'inbox.enabled = false',
      settings: { inbox: { enabled: false } },
    },
    {
      channel: 'dingtalk',
      expected: false,
      name: 'dingtalk.enabled = false',
      settings: { dingtalk: { enabled: false } },
    },
    {
      channel: 'inbox',
      expected: false,
      name: 'inbox.items.task[type] = false',
      settings: { inbox: { items: { task: { task_run_completed: false } } } },
    },
    {
      channel: 'inbox',
      expected: true,
      name: 'inbox.items.task[type] = true',
      settings: { inbox: { items: { task: { task_run_completed: true } } } },
    },
    {
      channel: 'inbox',
      expected: true,
      name: 'inbox.enabled = true and item missing',
      settings: { inbox: { enabled: true, items: { task: {} } } },
    },
    {
      channel: 'dingtalk',
      expected: false,
      name: 'channel on but item off',
      settings: {
        dingtalk: { enabled: true, items: { task: { task_run_completed: false } } },
      },
    },
    {
      channel: 'inbox',
      expected: false,
      name: 'channel off wins over item on',
      settings: {
        inbox: { enabled: false, items: { task: { task_run_completed: true } } },
      },
    },
  ];

  it.each(matrix)('$name → $expected', ({ channel, expected, settings }) => {
    const merged = mergeNotificationSettings(settings);
    expect(isChannelEnabledForType(merged, channel, type)).toBe(expected);
  });

  it('evaluates each task type independently', () => {
    const merged = mergeNotificationSettings({
      inbox: {
        items: {
          task: {
            task_completed: false,
            task_run_completed: true,
            task_run_failed: false,
            task_waiting_for_user: true,
          },
        },
      },
    });

    expect(isChannelEnabledForType(merged, 'inbox', 'task_run_completed')).toBe(true);
    expect(isChannelEnabledForType(merged, 'inbox', 'task_run_failed')).toBe(false);
    expect(isChannelEnabledForType(merged, 'inbox', 'task_waiting_for_user')).toBe(true);
    expect(isChannelEnabledForType(merged, 'inbox', 'task_completed')).toBe(false);
  });
});
