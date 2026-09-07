import { builtinSkills } from '@lobechat/builtin-skills';
import { builtinTools, defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import { type BuiltinSkill, type LobeBuiltinTool } from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';

export interface BuiltinToolState {
  builtinSkills: BuiltinSkill[];
  builtinToolLoading: Record<string, boolean>;
  builtinTools: LobeBuiltinTool[];
  /**
   * Identifiers of installed (market/user) skills and platform catalog skills
   * the user disabled for every assistant. Disabled behaves exactly like
   * uninstalled at runtime, but nothing is deleted — re-enabling only removes
   * the identifier from this list.
   *
   * Bundled builtin skills use `uninstalledBuiltinTools` instead.
   */
  disabledSkillIdentifiers: string[];
  /**
   * List of uninstalled builtin tool identifiers
   * Empty array means all builtin tools are enabled
   */
  uninstalledBuiltinTools: string[];
  /**
   * Loading state for fetching uninstalled builtin tools
   */
  uninstalledBuiltinToolsLoading: boolean;
}

export const initialBuiltinToolState: BuiltinToolState = {
  builtinSkills: filterBuiltinSkills(builtinSkills),
  builtinToolLoading: {},
  builtinTools,
  disabledSkillIdentifiers: [],
  uninstalledBuiltinTools: defaultUninstalledBuiltinTools,
  uninstalledBuiltinToolsLoading: true,
};
