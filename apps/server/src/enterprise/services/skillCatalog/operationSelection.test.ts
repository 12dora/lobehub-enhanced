import { describe, expect, it } from 'vitest';

import { selectPlatformOperationSkills } from './operationSelection';

const makeSkill = (skillKey: string, distribution: 'mandatory' | 'default' | 'optional') => ({
  checksum: 'a'.repeat(64),
  description: skillKey,
  displayName: skillKey,
  distribution,
  skillKey,
  source: 'uploaded' as const,
  version: '1.0.0',
});

describe('selectPlatformOperationSkills', () => {
  it('drops a user-disabled catalog skill unless it is mandatory', () => {
    const selected = selectPlatformOperationSkills(
      [
        makeSkill('user.disabled', 'default'),
        makeSkill('org.required', 'mandatory'),
        makeSkill('still.available', 'default'),
      ],
      undefined,
      { userDisabledKeys: ['user.disabled', 'org.required'] },
    );

    expect(selected.map(({ skill }) => skill.skillKey)).toEqual([
      'org.required',
      'still.available',
    ]);
  });

  it('does not inherit a personal disable through an empty workspace set', () => {
    const selected = selectPlatformOperationSkills(
      [makeSkill('personal.only', 'default')],
      undefined,
      { userDisabledKeys: [] },
    );

    expect(selected.map(({ skill }) => skill.skillKey)).toEqual(['personal.only']);
  });

  it('accepts platformDisabledKeys for future use and still exempts mandatory skills', () => {
    const selected = selectPlatformOperationSkills(
      [makeSkill('platform.off', 'default'), makeSkill('org.required', 'mandatory')],
      undefined,
      { platformDisabledKeys: ['platform.off', 'org.required'] },
    );

    expect(selected.map(({ skill }) => skill.skillKey)).toEqual(['org.required']);
  });
});
