import { BuiltinToolManifestSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { ReminderManifest } from './manifest';
import { ReminderApiName } from './types';

describe('ReminderManifest', () => {
  it('matches the builtin tool manifest schema', () => {
    const parsed = BuiltinToolManifestSchema.safeParse(ReminderManifest);

    expect(parsed.success).toBe(true);
  });

  it('uses the stable lobe-reminder identifier and required APIs', () => {
    expect(ReminderManifest.identifier).toBe('lobe-reminder');
    expect(ReminderManifest.type).toBe('builtin');
    expect(ReminderManifest.api.map((item) => item.name).sort()).toEqual(
      Object.values(ReminderApiName).slice().sort(),
    );
  });

  it('requires name recipients, content, and schedule on createReminder', () => {
    const create = ReminderManifest.api.find(
      (item) => item.name === ReminderApiName.createReminder,
    );

    expect(create?.parameters.required).toEqual(['recipients', 'content', 'schedule']);
    expect(create?.parameters.additionalProperties).toBe(false);
    expect(create?.parameters.properties.recipients.items.type).toBe('string');
    expect(create?.parameters.properties.schedule.required).toEqual(['kind', 'time']);
    expect(create?.parameters.properties.schedule.properties.kind.enum).toEqual([
      'daily',
      'monthly',
      'once',
      'weekly',
    ]);
  });

  it('exposes searchDirectory q and optional kind', () => {
    const search = ReminderManifest.api.find(
      (item) => item.name === ReminderApiName.searchDirectory,
    );

    expect(search?.parameters.required).toEqual(['q']);
    expect(search?.parameters.properties.kind.enum).toEqual(['department', 'user']);
  });

  it('cancels by taskId', () => {
    const cancel = ReminderManifest.api.find(
      (item) => item.name === ReminderApiName.cancelReminder,
    );

    expect(cancel?.parameters.required).toEqual(['taskId']);
  });
});
