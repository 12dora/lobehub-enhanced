import type { AgentPluginEntry } from '../agent/pluginConfig';
import { getDisabledPluginIds } from '../agent/pluginConfig';
import type { UserToolConfig } from '../user/settings/tool';

const resolveScopedIdentifierList = (
  personal: string[] | undefined,
  byWorkspace: Record<string, string[]> | undefined,
  workspaceId?: string | null,
): string[] => {
  if (workspaceId) {
    // A workspace with no stored entry is a clean default — it must not
    // inherit the user's personal list.
    return byWorkspace?.[workspaceId] ?? [];
  }

  return personal ?? [];
};

/**
 * User-scope identifiers that must be treated as uninstalled for the active
 * context: bundled builtin skill ids (`uninstalledBuiltinTools`) union
 * installed / catalog skill ids (`disabledSkillIdentifiers`).
 */
export const collectUserDisabledSkillIds = (input: {
  toolConfig?: UserToolConfig;
  workspaceId?: string | null;
}): Set<string> => {
  const { toolConfig, workspaceId } = input;
  const ids = new Set<string>();

  for (const id of resolveScopedIdentifierList(
    toolConfig?.uninstalledBuiltinTools,
    toolConfig?.uninstalledBuiltinToolsByWorkspace,
    workspaceId,
  )) {
    ids.add(id);
  }

  for (const id of resolveScopedIdentifierList(
    toolConfig?.disabledSkillIdentifiers,
    toolConfig?.disabledSkillIdentifiersByWorkspace,
    workspaceId,
  )) {
    ids.add(id);
  }

  return ids;
};

/**
 * Full runtime disable set: per-agent plugin tri-state ∪ user-scope list ∪
 * optional platform keys, minus mandatory catalog keys (those stay callable
 * even if a stale user/platform entry remains).
 */
export const resolveDisabledSkillIds = (input: {
  agentPlugins?: AgentPluginEntry[];
  toolConfig?: UserToolConfig;
  workspaceId?: string | null;
  platformDisabledKeys?: Iterable<string>;
  mandatoryKeys?: Iterable<string>;
}): Set<string> => {
  const disabled = collectUserDisabledSkillIds({
    toolConfig: input.toolConfig,
    workspaceId: input.workspaceId,
  });

  for (const id of getDisabledPluginIds(input.agentPlugins)) {
    disabled.add(id);
  }

  if (input.platformDisabledKeys) {
    for (const id of input.platformDisabledKeys) {
      disabled.add(id);
    }
  }

  if (input.mandatoryKeys) {
    for (const id of input.mandatoryKeys) {
      disabled.delete(id);
    }
  }

  return disabled;
};
