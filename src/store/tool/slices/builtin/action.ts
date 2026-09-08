import { defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import debug from 'debug';
import { t } from 'i18next';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { message } from '@/components/AntdStaticMethods';
import { mutate } from '@/libs/swr';
import { toolKeys } from '@/libs/swr/keys';
import { userService } from '@/services/user';
import { type StoreSetter } from '@/store/types';
import { readEnterpriseErrorBody } from '@/utils/enterpriseErrorBody';
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
 * Build the skill-slot payload for persisting a new uninstalled list in the
 * active scope. Only disable-list slots are returned — locked policy leaves
 * such as `humanIntervention.approvalMode` must not be round-tripped.
 */
const buildUninstalledToolsUpdate = (
  tool: UninstalledBuiltinToolsScope | undefined,
  workspaceId: string | null,
  nextUninstalled: string[],
): UninstalledBuiltinToolsScope => {
  const slots = pickSkillDisableSlots(tool);

  return workspaceId
    ? {
        ...slots,
        uninstalledBuiltinToolsByWorkspace: {
          ...tool?.uninstalledBuiltinToolsByWorkspace,
          [workspaceId]: nextUninstalled,
        },
      }
    : { ...slots, uninstalledBuiltinTools: nextUninstalled };
};

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
const buildDisabledSkillsUpdate = (
  tool: UninstalledBuiltinToolsScope | undefined,
  workspaceId: string | null,
  nextDisabled: string[],
): UninstalledBuiltinToolsScope => {
  const slots = pickSkillDisableSlots(tool);

  return workspaceId
    ? {
        ...slots,
        disabledSkillIdentifiersByWorkspace: {
          ...tool?.disabledSkillIdentifiersByWorkspace,
          [workspaceId]: nextDisabled,
        },
      }
    : { ...slots, disabledSkillIdentifiers: nextDisabled };
};

/**
 * The `settings.tool` slots the skill toggles rewrite. Only these are carried
 * over from an in-flight burst of toggles; every other setting stays whatever
 * the server last returned.
 */
const SKILL_DISABLE_SLOTS = [
  'disabledSkillIdentifiers',
  'disabledSkillIdentifiersByWorkspace',
  'uninstalledBuiltinTools',
  'uninstalledBuiltinToolsByWorkspace',
] as const;

/** Copy only the skill disable slots — never locked registry leaves. */
const pickSkillDisableSlots = (
  tool: UninstalledBuiltinToolsScope | undefined,
): UninstalledBuiltinToolsScope => {
  if (!tool) return {};

  const slots: UninstalledBuiltinToolsScope = {};
  for (const slot of SKILL_DISABLE_SLOTS) {
    if (Object.hasOwn(tool, slot) && tool[slot] !== undefined) {
      slots[slot] = tool[slot] as never;
    }
  }
  return slots;
};

/**
 * Overlay the disable slots this store already persisted onto a freshly read
 * `tool` object.
 *
 * Toggles are serialized, so the previous write has always resolved by the time
 * the next one reads — but the read can still miss it (a cached or replicated
 * response), and rebasing onto that stale value is exactly the lost update the
 * queue exists to prevent.
 */
const mergePersistedDisableSlots = <T extends UninstalledBuiltinToolsScope>(
  tool: T | undefined,
  persisted: UninstalledBuiltinToolsScope | undefined,
): T | undefined => {
  if (!persisted) return tool;

  const merged = { ...tool } as T;
  for (const slot of SKILL_DISABLE_SLOTS) {
    if (Object.hasOwn(persisted, slot)) {
      (merged as UninstalledBuiltinToolsScope)[slot] = persisted[slot] as never;
    }
  }

  return merged;
};

const skillToggleFailureDetail = (error: unknown): string | undefined => {
  const body = readEnterpriseErrorBody(error);
  const code = body?.code?.trim();
  if (code) return code;
  const bodyMessage = body?.message?.trim();
  if (bodyMessage) return bodyMessage;
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return undefined;
};

/**
 * Builtin Tool Action Interface
 */

type Setter = StoreSetter<ToolStore>;
export const createBuiltinToolSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new BuiltinToolActionImpl(set, get, _api);

export class BuiltinToolActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  /**
   * Serializes every `settings.tool` mutation issued by this store. Each toggle
   * is a read-modify-write of the skill disable slots, so two overlapping
   * toggles would both rebase on the pre-toggle value and the later write would
   * silently drop the earlier one.
   */
  #settingsMutationChain: Promise<unknown> = Promise.resolve();
  /** Number of queued-or-running settings mutations. */
  #settingsMutationDepth = 0;
  /** Last `tool` payload persisted during the current burst; see {@link mergePersistedDisableSlots}. */
  #persistedToolSettings: UninstalledBuiltinToolsScope | undefined;

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
   * Run a `settings.tool` mutation after every earlier one has settled, so the
   * read-modify-write cycles never interleave. A rejected task does not break
   * the chain: the next mutation still runs.
   */
  #enqueueToolSettingsMutation = <T>(task: () => Promise<T>): Promise<T> => {
    this.#settingsMutationDepth += 1;

    const run = this.#settingsMutationChain.then(task, task);

    this.#settingsMutationChain = run.then(
      () => this.#releaseToolSettingsMutation(),
      () => this.#releaseToolSettingsMutation(),
    );

    return run;
  };

  #releaseToolSettingsMutation = (): void => {
    this.#settingsMutationDepth -= 1;
    // The overlay only has to bridge the writes of a single burst. Once the
    // queue drains the server is authoritative again, so another device's
    // changes are never overwritten by a stale local snapshot.
    if (this.#settingsMutationDepth <= 0) {
      this.#settingsMutationDepth = 0;
      this.#persistedToolSettings = undefined;
    }
  };

  /** Freshest `tool` settings: the server value plus this burst's own writes. */
  #readToolSettings = async () => {
    const userState = await userService.getUserState();

    return mergePersistedDisableSlots(userState?.settings?.tool, this.#persistedToolSettings);
  };

  /** Surface a failed skill toggle; the caller has already rolled the store back. */
  #notifySkillToggleFailed = (error: unknown): void => {
    log('skill toggle failed: %o', error);
    const generic = t('tools.skillEnabled.saveFailed', { ns: 'setting' });
    const detail = skillToggleFailureDetail(error);
    message.error(detail ? `${generic} (${detail})` : generic);
  };

  /**
   * Toggle a builtin tool's installed state for the active scope (personal or
   * workspace), persisting to the matching slot in user settings.
   *
   * The current list is read fresh from the server so the diff is against the
   * real stored value (not the default seed), and only skill disable slots are
   * written back so locked policy leaves are never round-tripped. The whole
   * read-modify-write runs on the settings queue, so a second toggle can never
   * overwrite the first.
   */
  #toggleBuiltinToolInstalled = (identifier: string, install: boolean): Promise<void> =>
    this.#enqueueToolSettingsMutation(async () => {
      const workspaceId = getActiveWorkspaceId();

      const tool = await this.#readToolSettings();
      const currentUninstalled = resolveUninstalledBuiltinTools(tool, workspaceId);

      const alreadyUninstalled = currentUninstalled.includes(identifier);
      // No-op if the tool is already in the desired state.
      if (install ? !alreadyUninstalled : alreadyUninstalled) return;

      const newUninstalled = install
        ? currentUninstalled.filter((id) => id !== identifier)
        : [...currentUninstalled, identifier];

      const nextTool = buildUninstalledToolsUpdate(tool, workspaceId, newUninstalled);
      const previousUninstalled = this.#get().uninstalledBuiltinTools;

      // Optimistic update
      this.#set(
        { uninstalledBuiltinTools: newUninstalled, uninstalledBuiltinToolsLoading: false },
        false,
        n(install ? 'installBuiltinTool' : 'uninstallBuiltinTool'),
      );

      try {
        // Persist to user settings (scoped to personal / active workspace)
        await userService.updateUserSettings({ tool: nextTool });
      } catch (error) {
        // Roll the optimistic state back so the row matches what is stored.
        this.#set(
          { uninstalledBuiltinTools: previousUninstalled },
          false,
          n('rollbackBuiltinToolInstalled'),
        );
        this.#notifySkillToggleFailed(error);
        throw error;
      }

      this.#persistedToolSettings = nextTool;

      // Refresh to ensure consistency
      await this.refreshUninstalledBuiltinTools();
    });

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
   * Same read-then-write discipline as the builtin list — queued, read fresh
   * from the server, and written as skill-slot partials so locked policy leaves
   * are never round-tripped.
   */
  #toggleSkillDisabled = (identifier: string, enabled: boolean): Promise<void> =>
    this.#enqueueToolSettingsMutation(async () => {
      const workspaceId = getActiveWorkspaceId();

      const tool = await this.#readToolSettings();
      const currentDisabled = resolveDisabledSkillIdentifiers(tool, workspaceId);

      const alreadyDisabled = currentDisabled.includes(identifier);
      // No-op if the skill is already in the desired state.
      if (enabled ? !alreadyDisabled : alreadyDisabled) return;

      const nextDisabled = enabled
        ? currentDisabled.filter((id) => id !== identifier)
        : [...currentDisabled, identifier];

      const nextTool = buildDisabledSkillsUpdate(tool, workspaceId, nextDisabled);
      const previousDisabled = this.#get().disabledSkillIdentifiers;

      // Optimistic update
      this.#set({ disabledSkillIdentifiers: nextDisabled }, false, n('setSkillEnabled'));

      try {
        await userService.updateUserSettings({ tool: nextTool });
      } catch (error) {
        // Roll the optimistic state back so the switch matches what is stored.
        this.#set({ disabledSkillIdentifiers: previousDisabled }, false, n('rollbackSkillEnabled'));
        this.#notifySkillToggleFailed(error);
        throw error;
      }

      this.#persistedToolSettings = nextTool;

      // Refresh to ensure consistency
      await this.refreshUninstalledBuiltinTools();
    });

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
