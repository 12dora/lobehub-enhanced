import { DEFAULT_NOTIFICATION_SETTINGS } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { buildReminderDraft, mergeReminderDraft, setChannelEnabled, setChannelItem } from './draft';

describe('reminder settings draft', () => {
  it('treats missing channels and missing flags as enabled', () => {
    expect(buildReminderDraft(undefined)).toEqual({
      dingtalk: {
        enabled: true,
        items: {
          task_completed: true,
          task_run_completed: true,
          task_run_failed: true,
          task_waiting_for_user: true,
        },
      },
      inbox: {
        enabled: true,
        items: {
          task_completed: true,
          task_run_completed: true,
          task_run_failed: true,
          task_waiting_for_user: true,
        },
      },
    });
  });

  it('reads stored opt-outs, and only an explicit false turns a row off', () => {
    const draft = buildReminderDraft({
      dingtalk: { enabled: false },
      inbox: { items: { task: { task_run_failed: false } } },
    });

    expect(draft.dingtalk.enabled).toBe(false);
    expect(draft.inbox.enabled).toBe(true);
    expect(draft.inbox.items.task_run_failed).toBe(false);
    expect(draft.inbox.items.task_run_completed).toBe(true);
  });

  it('round-trips the shipped defaults', () => {
    const draft = buildReminderDraft(DEFAULT_NOTIFICATION_SETTINGS);

    expect(draft.inbox.enabled).toBe(true);
    expect(draft.dingtalk.enabled).toBe(true);
    expect(Object.values(draft.inbox.items).every(Boolean)).toBe(true);
  });

  it('merges back without touching other channels or categories', () => {
    const current = {
      email: { enabled: false },
      inbox: {
        enabled: true,
        items: {
          generation: { image_generation_completed: false },
          task: { task_completed: true },
        },
      },
    };

    let draft = buildReminderDraft(current);
    draft = setChannelItem(draft, 'inbox', 'task_completed', false);
    draft = setChannelEnabled(draft, 'dingtalk', false);

    expect(mergeReminderDraft(draft, current)).toEqual({
      dingtalk: {
        enabled: false,
        items: {
          task: {
            task_completed: true,
            task_run_completed: true,
            task_run_failed: true,
            task_waiting_for_user: true,
          },
        },
      },
      email: { enabled: false },
      inbox: {
        enabled: true,
        items: {
          generation: { image_generation_completed: false },
          task: {
            task_completed: false,
            task_run_completed: true,
            task_run_failed: true,
            task_waiting_for_user: true,
          },
        },
      },
    });
  });

  it('keeps toggles immutable so a stale draft cannot leak into the next render', () => {
    const draft = buildReminderDraft();
    const next = setChannelItem(draft, 'inbox', 'task_run_failed', false);

    expect(draft.inbox.items.task_run_failed).toBe(true);
    expect(next.inbox.items.task_run_failed).toBe(false);
    expect(next.dingtalk).toBe(draft.dingtalk);
  });
});
