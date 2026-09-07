import { defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import debug from 'debug';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate } from '@/libs/swr';
import { toolKeys } from '@/libs/swr/keys';
import { userService } from '@/services/user';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { invokeExecutor } from './executors/index';
import { type BuiltinToolContext, type BuiltinToolResult } from './types';

const n = setNamespace('builtinTool');
const log = debug('lobe-store:builtin-tool');

/**
 * Minimal view of `settings.tool` covering the two skill disable slots: the
 * builtin-tool install lists and the disabled-skill identifier lists. Typed
 * locally so the helpers accept the loosened shape returned by `getUserState()`
 * while still spreading the rest of `tool` through at runtime.
 */
interface UninstalledBuiltinToolsScope {
  disabledSkillIdentifiers?: string[];
  disabledSkillIdentifiersByWorkspace?: Record<string, string[] | undefined>;
  uninstalledBuiltinTools?: string[];
  uninstalledBuiltinToolsByWorkspace?: Record<string, string[] | undefined>;
}

/**
 * Which persistence slot a skill toggle writes to.
 *
 * - `builtin`: bundled builtin skills and builtin tools → `uninstalledBuiltinTools`
 * - `skill`: installed market/user skills and platform catalog skills →
 *   `disabledSkillIdentifiers`
 */
export type SkillEnabledKind = 'builtin' | 'skill';

/**
 * Resolve the uninstalled-builtin-tools list for the active scope.
 *
 * - Personal context (`workspaceId == null`) → the user's personal list.
 * - Workspace context → the per-workspace list; a workspace with no stored
 *   entry falls back to the default seed (a clean default state), never the
 *   user's personal customization.
 *
 * `undefined` (never configured) maps to the default seed in both scopes.
 */
const resolveUninstalledBuiltinTools = (
  tool: UninstalledBuiltinToolsScope | undefined,
  workspaceId: string | null,
): string[] => {
  const stored = workspaceId
    ? tool?.uninstalledBuiltinToolsByWorkspace?.[workspaceId]
    : tool?.uninstalledBuiltinTools;

  return stored === undefined ? defaultUninstalledBuiltinTools : stored;
};

/**
 * Build the full `tool` settings payload for persisting a new uninstalled list
 * in the active scope. The whole object is returned (not a partial) because the
 * server replaces the `tool` column wholesale on update — spreading the current
 * `tool` keeps `humanIntervention` and the other scope's list intact.
 */
const buildUninstalledToolsUpdate = <T extends UninstalledBuiltinToolsScope>(
  tool: T | undefined,
  workspaceId: string | null,
  nextUninstalled: string[],
) =>
  workspaceId
    ? {
        ...tool,
        uninstalledBuiltinToolsByWorkspace: {
          ...tool?.uninstalledBuiltinToolsByWorkspace,
          [workspaceId]: nextUninstalled,
        },
      }
    : { ...tool, uninstalledBuiltinTools: nextUninstalled };

/**
 * Resolve the disabled-skill identifier list for the active scope. Mirrors
 * {@link resolveUninstalledBuiltinTools}, except that "never configured" means
 * an empty list in both scopes (no default seed exists for skills).
 */
const resolveDisabledSkillIdentifiers = (
  tool: UninstalledBuiltinToolsScope | undefined,
  workspaceId: string | null,
): string[] =>
  (workspaceId
    ? tool?.disabledSkillIdentifiersByWorkspace?.[workspaceId]
    : tool?.disabledSkillIdentifiers) ?? [];

/** Counterpart of {@link buildUninstalledToolsUpdate} for the disabled-skill list. */
const buildDisabledSkillsUpdate = <T extends UninstalledBuiltinToolsScope>(
  tool: T | undefined,
  workspaceId: string | null,
  nextDisabled: string[],
) =>
  workspaceId
    ? {
        ...tool,
        disabledSkillIdentifiersByWorkspace: {
          ...tool?.disabledSkillIdentifiersByWorkspace,
          [workspaceId]: nextDisabled,
        },
      }
    : { ...tool, disabledSkillIdentifiers: nextDisabled };

/**
 * Builtin Tool Action Interface
 */

type Setter = StoreSetter<ToolStore>;
export const createBuiltinToolSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new BuiltinToolActionImpl(set, get, _api);

export class BuiltinToolActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  invokeBuiltinTool = async (
    identifier: string,
    apiName: string,
    params: any,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const executorKey = `${identifier}/${apiName}`;
    log('invokeBuiltinTool: %s', executorKey);

    const { toggleBuiltinToolLoading } = this.#get();
    toggleBuiltinToolLoading(executorKey, true);

    try {
      const result = await invokeExecutor(identifier, apiName, params, ctx);
      log('invokeBuiltinTool result: %s -> %o', executorKey, result);

      toggleBuiltinToolLoading(executorKey, false);
      return result;
    } catch (error) {
      log('invokeBuiltinTool error: %s -> %o', executorKey, error);
      toggleBuiltinToolLoading(executorKey, false);

      return {
        error: {
          body: error,
          message: error instanceof Error ? error.message : String(error),
          type: 'BuiltinToolExecutorError',
        },
        success: false,
      };
    }
  };

  toggleBuiltinToolLoading = (key: string, value: boolean): void => {
    this.#set({ builtinToolLoading: { [key]: value } }, false, n('toggleBuiltinToolLoading'));
  };

  transformApiArgumentsToAiState = async (
    key: string,
    params: any,
  ): Promise<string | undefined> => {
    const { builtinToolLoading, toggleBuiltinToolLoading } = this.#get();
    if (builtinToolLoading[key]) return;

    const { [key as keyof BuiltinToolAction]: action } = this.#get();

    if (!action) return JSON.stringify(params);

    toggleBuiltinToolLoading(key, true);

    try {
      // @ts-ignore
      const result = await action(params);

      toggleBuiltinToolLoading(key, false);

      return JSON.stringify(result);
    } catch (e) {
      toggleBuiltinToolLoading(key, false);
      throw e;
    }
  };

  // ========== Uninstalled Builtin Tools Management ==========

  /**
   * Toggle a builtin tool's installed state for the active scope (personal or
   * workspace), persisting to the matching slot in user settings.
   *
   * The current list is read fresh from the server so the diff is against the
   * real stored value (not the default seed), and the full `tool` object is
   * written back so the other scope's list and `humanIntervention` survive the
   * server's wholesale column replacement.
   */
  #toggleBuiltinToolInstalled = async (identifier: string, install: boolean): Promise<void> => {
    const workspaceId = getActiveWorkspaceId();

    const userState = await userService.getUserState();
    const tool = userState?.settings?.tool;
    const currentUninstalled = resolveUninstalledBuiltinTools(tool, workspaceId);

    const alreadyUninstalled = currentUninstalled.includes(identifier);
    // No-op if the tool is already in the desired state.
    if (install ? !alreadyUninstalled : alreadyUninstalled) return;

    const newUninstalled = install
      ? currentUninstalled.filter((id) => id !== identifier)
      : [...currentUninstalled, identifier];

    // Optimistic update
    this.#set(
      { uninstalledBuiltinTools: newUninstalled, uninstalledBuiltinToolsLoading: false },
      false,
      n(install ? 'installBuiltinTool' : 'uninstallBuiltinTool'),
    );

    // Persist to user settings (scoped to personal / active workspace)
    await userService.updateUserSettings({
      tool: buildUninstalledToolsUpdate(tool, workspaceId, newUninstalled),
    });

    // Refresh to ensure consistency
    await this.refreshUninstalledBuiltinTools();
  };

  /**
   * Install a builtin tool by removing it from the uninstalled list
   */
  installBuiltinTool = async (identifier: string): Promise<void> => {
    await this.#toggleBuiltinToolInstalled(identifier, true);
  };

  /**
   * Uninstall a builtin tool by adding it to the uninstalled list
   */
  uninstallBuiltinTool = async (identifier: string): Promise<void> => {
    await this.#toggleBuiltinToolInstalled(identifier, false);
  };

  /**
   * Toggle a skill's disabled state for the active scope (personal or
   * workspace) by writing `disabledSkillIdentifiers` in user settings.
   *
   * Same read-then-write discipline as the builtin list: the stored value is
   * read fresh from the server and the whole `tool` object is written back,
   * because the server replaces the column wholesale.
   */
  #toggleSkillDisabled = async (identifier: string, enabled: boolean): Promise<void> => {
    const workspaceId = getActiveWorkspaceId();

    const userState = await userService.getUserState();
    const tool = userState?.settings?.tool;
    const currentDisabled = resolveDisabledSkillIdentifiers(tool, workspaceId);

    const alreadyDisabled = currentDisabled.includes(identifier);
    // No-op if the skill is already in the desired state.
    if (enabled ? !alreadyDisabled : alreadyDisabled) return;

    const nextDisabled = enabled
      ? currentDisabled.filter((id) => id !== identifier)
      : [...currentDisabled, identifier];

    // Optimistic update
    this.#set({ disabledSkillIdentifiers: nextDisabled }, false, n('setSkillEnabled'));

    await userService.updateUserSettings({
      tool: buildDisabledSkillsUpdate(tool, workspaceId, nextDisabled),
    });

    // Refresh to ensure consistency
    await this.refreshUninstalledBuiltinTools();
  };

  /**
   * Enable or disable a skill for the signed-in user across every assistant.
   *
   * A disabled skill is dropped from the skill pool and cannot be activated by
   * name — the same runtime effect as uninstalling — but nothing is deleted.
   */
  setSkillEnabled = async ({
    enabled,
    identifier,
    kind,
  }: {
    enabled: boolean;
    identifier: string;
    kind: SkillEnabledKind;
  }): Promise<void> => {
    if (kind === 'builtin') {
      await this.#toggleBuiltinToolInstalled(identifier, enabled);
      return;
    }

    await this.#toggleSkillDisabled(identifier, enabled);
  };

  /**
   * Refresh uninstalled builtin tools from server (active scope)
   */
  refreshUninstalledBuiltinTools = async (): Promise<void> => {
    await mutate(toolKeys.uninstalledBuiltins(getActiveWorkspaceId()));
  };

  /**
   * SWR hook to fetch uninstalled builtin tools for the active scope.
   *
   * The cache key carries the active workspace id so personal and each
   * workspace keep independent caches; combined with the SPA's per-workspace
   * remount this revalidates automatically on workspace switch.
   */
  useFetchUninstalledBuiltinTools = (enabled: boolean): SWRResponse<string[]> => {
    const workspaceId = useActiveWorkspaceId();

    return useSWR<string[]>(
      enabled ? toolKeys.uninstalledBuiltins(workspaceId) : null,
      async () => {
        const userState = await userService.getUserState();
        const tool = userState?.settings?.tool;
        // Both disable lists come from the same `settings.tool` payload, so the
        // sibling skill list is synced here instead of paying for a second read.
        this.#set(
          { disabledSkillIdentifiers: resolveDisabledSkillIdentifiers(tool, workspaceId) },
          false,
          n('useFetchDisabledSkillIdentifiers'),
        );
        return resolveUninstalledBuiltinTools(tool, workspaceId);
      },
      {
        fallbackData: defaultUninstalledBuiltinTools,
        onSuccess: (data) => {
          this.#set(
            { uninstalledBuiltinTools: data, uninstalledBuiltinToolsLoading: false },
            false,
            n('useFetchUninstalledBuiltinTools'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  };
}

export type BuiltinToolAction = Pick<BuiltinToolActionImpl, keyof BuiltinToolActionImpl>;
