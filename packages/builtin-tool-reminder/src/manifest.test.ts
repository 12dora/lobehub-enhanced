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

  it('requires resolved recipients, fireAt, and content on createReminder', () => {
    const create = ReminderManifest.api.find(
      (item) => item.name === ReminderApiName.createReminder,
    );

    expect(create?.parameters.required).toEqual(['recipients', 'fireAt', 'content']);
    expect(create?.parameters.additionalProperties).toBe(false);
    expect(create?.parameters.properties.fireAt.type).toBe('string');
    expect(create?.parameters.properties.recipients.items.properties.kind.enum).toEqual([
      'user',
      'department',
    ]);
  });

  it('exposes searchDirectory q and optional kind', () => {
    const search = ReminderManifest.api.find(
      (item) => item.name === ReminderApiName.searchDirectory,
    );

    expect(search?.parameters.required).toEqual(['q']);
    expect(search?.parameters.properties.kind.enum).toEqual(['user', 'department']);
  });
});
