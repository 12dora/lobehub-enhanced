/**
 * @vitest-environment node
 *
 * The modal's save goes through `user.updateSettings`, which — with the platform
 * settings policy on (the default) — runs the payload through the legacy settings
 * catalog. The component tests mock `setSettings`, so this is the only place that
 * proves the merged object is actually persistable.
 */
import { DEFAULT_NOTIFICATION_SETTINGS } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { validateLegacySettingsUpdate } from '@/server/enterprise/services/settings/legacySettingsCatalog';

import { buildReminderDraft, mergeReminderDraft, setChannelEnabled, setChannelItem } from './draft';

const validate = (notification: unknown) => validateLegacySettingsUpdate({ notification });

describe('reminder save payload vs the legacy settings catalog', () => {
  it('accepts the payload produced when DingTalk is switched off', () => {
    const current = DEFAULT_NOTIFICATION_SETTINGS;
    const draft = setChannelEnabled(buildReminderDraft(current), 'dingtalk', false);

    const result = validate(mergeReminderDraft(draft, current));

    expect(result.ok).toBe(true);
  });

  it('accepts a per-event opt-out on both channels', () => {
    const current = DEFAULT_NOTIFICATION_SETTINGS;
    let draft = buildReminderDraft(current);
    draft = setChannelItem(draft, 'inbox', 'task_run_failed', false);
    draft = setChannelItem(draft, 'dingtalk', 'task_waiting_for_user', false);

    expect(validate(mergeReminderDraft(draft, current)).ok).toBe(true);
  });

  it('accepts the untouched default draft', () => {
    expect(validate(mergeReminderDraft(buildReminderDraft(), {})).ok).toBe(true);
  });
});
