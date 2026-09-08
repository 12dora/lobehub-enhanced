import type { EffortConfigKey } from '@lobechat/model-runtime';
import { EFFORT_CONTROL_REGISTRY, isEffortControlKey } from '@lobechat/model-runtime';
import type { PlatformAgentVersionConfig } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

/**
 * Map a version's optional thinking-effort pin onto the chatConfig field the
 * registry writes. Fail-open: malformed or unknown pairs are treated as "no pin".
 */
export const resolveThinkingEffortChatConfigPatch = (
  config: Pick<PlatformAgentVersionConfig, 'thinkingEffort'> | null | undefined,
): { configKey: EffortConfigKey; level: string } | null => {
  try {
    const thinkingEffort = config?.thinkingEffort;
    if (!isRecord(thinkingEffort)) return null;
    const { controlKey, level } = thinkingEffort;
    if (typeof controlKey !== 'string' || typeof level !== 'string') return null;
    if (!isEffortControlKey(controlKey)) return null;
    const definition = EFFORT_CONTROL_REGISTRY[controlKey];
    if (!(definition.levels as readonly string[]).includes(level)) return null;
    return { configKey: definition.configKey, level };
  } catch {
    return null;
  }
};
