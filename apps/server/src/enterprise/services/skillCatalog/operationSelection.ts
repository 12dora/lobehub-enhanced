import type { AgentPluginEntry } from '@lobechat/types';
import { getPluginMode } from '@lobechat/types';

import { resolvePlatformSkillSelection } from '@/types/platform/skills';

import type { PlatformSkillPinnedRef, PublishedSkill } from '../../contracts/skillCatalog';

export interface SelectPlatformOperationSkillsOptions {
  /**
   * Reserved for org-wide `platform_skills.enabled = false` keys if a caller
   * ever applies them after snapshot merge. This module does not source it.
   */
  platformDisabledKeys?: Iterable<string>;
  /**
   * User-disabled catalog keys (`disabledSkillIdentifiers` and bundled
   * builtin uninstall ids). Mandatory skills ignore this set.
   */
  userDisabledKeys?: Iterable<string>;
}

export const selectPlatformOperationSkills = (
  skills: PublishedSkill[],
  plugins?: AgentPluginEntry[],
  options?: SelectPlatformOperationSkillsOptions,
) => {
  const platformDisabled = new Set(options?.platformDisabledKeys);
  const userDisabled = new Set(options?.userDisabledKeys);

  return skills.flatMap((skill) => {
    if (
      skill.distribution !== 'mandatory' &&
      (userDisabled.has(skill.skillKey) || platformDisabled.has(skill.skillKey))
    ) {
      return [];
    }

    const selection = resolvePlatformSkillSelection(
      skill.distribution,
      getPluginMode(plugins, skill.skillKey),
    );
    return selection.available ? [{ selection, skill }] : [];
  });
};

const refKey = (ref: PlatformSkillPinnedRef) => `${ref.skillKey}\0${ref.version}\0${ref.checksum}`;

export const hasExactPlatformSkillRefs = (
  actual: PlatformSkillPinnedRef[],
  expected: PlatformSkillPinnedRef[],
) => {
  if (actual.length !== expected.length) return false;
  const actualKeys = actual.map(refKey).sort();
  const expectedKeys = expected.map(refKey).sort();
  return actualKeys.every((value, index) => value === expectedKeys[index]);
};
