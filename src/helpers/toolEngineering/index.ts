/**
 * Tools Engineering - Unified tools processing using ToolsEngine
 */
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { DocumentPagesManifest } from '@lobechat/builtin-tool-document-pages';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { alwaysOnToolIds, chatModeAllowedToolIds, defaultToolIds } from '@lobechat/builtin-tools';
import { createEnableChecker, type PluginEnableChecker } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import {
  type BuiltinToolManifest,
  type BuiltinToolResolveContext,
  type ChatCompletionTool,
  type ToolManifest,
  type WorkingModel,
} from '@lobechat/types';

import type { ConnectorToolPermission } from '@/database/schemas';
import { isToolAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { patchManifestWithPermissions } from '@/libs/mcp/patchManifestPermissions';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { getToolStoreState } from '@/store/tool';
import {
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { getUserMemoryStoreState, userMemorySelectors } from '@/store/userMemory';

import { getSearchConfig } from '../getSearchConfig';
import { isCanUseFC } from '../isCanUseFC';
import { buildClientConnectorManifests } from './buildClientConnectorManifests';

const DINGTALK_APPROVAL_TOOL_IDENTIFIER = 'lobe-dingtalk-approval';
const DINGTALK_WORKSPACE_TOOL_IDENTIFIER = 'lobe-dingtalk-workspace';
const DINGTALK_PERSONAL_TOOL_IDENTIFIER = 'lobe-dingtalk-personal';
const ENTERPRISE_LOOKUP_TOOL_IDENTIFIER = 'lobe-enterprise-lookup';

/**
 * Capability flags from server config. Missing / unknown is fail-closed (off).
 * Approval and workspace are NOT always-on: they join `defaultToolIds` + the
 * enable rule only when the matching flag is on, same as enterprise-lookup.
 */
const readEnterpriseToolFlags = () => {
  const caps = getServerConfigStoreState()?.serverConfig.enterprise?.capabilities;
  return {
    dingtalkApproval: !!caps?.dingtalkApproval,
    dingtalkPersonal: !!caps?.dingtalkPersonal,
    dingtalkWorkspace: !!(caps?.dingtalkTodo || caps?.dingtalkCalendar),
    enterpriseLookup: !!caps?.enterpriseLookup,
  };
};

/**
 * Tools engine configuration options
 */
export interface ToolsEngineConfig {
  /** Additional manifests to include beyond the standard ones */
  additionalManifests?: ToolManifest[];
  /** Default tool IDs that will always be added to the end of the tools list */
  defaultToolIds?: string[];
  /**
   * Identifiers the agent has explicitly disabled (`agents.plugins` tri-state).
   * Dropped from the combined manifest pool entirely — not just the
   * enableChecker rule map — because `allowExplicitActivation` lets the
   * activator resolve/enable any manifest present in `manifestSchemas`
   * regardless of the rules, bypassing a rule-only gate.
   */
  disabledPluginIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
  /**
   * Runtime context for context-aware builtin manifests. When provided, each
   * builtin tool with a `resolveManifest` produces its manifest for this context
   * (trimming APIs or opting out via `null`). Omit for context-free callers
   * (e.g. UI token estimation) — they get the full static manifests.
   */
  manifestContext?: BuiltinToolResolveContext;
}

/**
 * A manifest is usable by ToolsEngine only if it has a non-empty `api` array.
 * ToolsEngine.convertManifestsToTools calls `manifest.api.map(...)` unconditionally,
 * so any entry with `api` missing / non-array will crash the whole tools build.
 * Sources that populate manifests (installed plugins, Composio, LobeHub skills, MCP)
 * have no shared schema validation, so we guard defensively at the merge point.
 */
const isValidToolManifest = (m: ToolManifest | undefined): m is ToolManifest =>
  !!m && typeof m === 'object' && Array.isArray((m as ToolManifest).api);

const dropInvalidManifests = (manifests: (ToolManifest | undefined)[], source: string) => {
  const valid: ToolManifest[] = [];
  const dropped: Array<{ identifier?: string; reason: string }> = [];

  for (const m of manifests) {
    if (isValidToolManifest(m)) {
      valid.push(m);
    } else if (m) {
      dropped.push({
        identifier: (m as { identifier?: string }).identifier,
        reason: Array.isArray((m as { api?: unknown }).api)
          ? 'unknown'
          : 'missing `api` field (expected array)',
      });
    }
  }

  if (dropped.length > 0) {
    console.warn(
      `[toolEngineering] Dropped ${dropped.length} invalid manifest(s) from ${source}:`,
      dropped,
    );
  }

  return valid;
};

/**
 * Initialize ToolsEngine with current manifest schemas and configurable options
 */
export const createToolsEngine = (config: ToolsEngineConfig = {}): ToolsEngine => {
  const {
    enableChecker,
    additionalManifests = [],
    defaultToolIds,
    disabledPluginIds = [],
    manifestContext,
  } = config;

  const toolStoreState = getToolStoreState();

  // Get custom connector manifests (user-added MCP servers). Connectors take
  // priority over plugins: any plugin sharing a connector identifier is dropped
  // so the connector (server-side execution with its stored token) wins.
  const connectorManifests = buildClientConnectorManifests(
    connectorSelectors.customConnectors(toolStoreState),
  );
  const connectorIdentifiers = new Set(connectorManifests.map((m) => m.identifier));

  // Per-connector tool permissions, keyed by connector identifier. Used to patch
  // community-MCP plugin manifests below so the user's needs_approval / disabled
  // settings surface as humanIntervention (custom connectors are handled by their
  // own manifests above; disabled is also hard-blocked at the mcp router).
  const connectorPermsByIdentifier = new Map(
    connectorSelectors
      .connectorList(toolStoreState)
      .map((c) => [c.identifier, new Map(c.tools.map((t) => [t.toolName, t.permission]))] as const),
  );

  // Get all available plugin manifests (excluding ones now covered by a connector),
  // patched with their connector tool permissions when a connector row exists.
  const pluginManifests = pluginSelectors
    .installedPluginManifestList(toolStoreState)
    .filter((m) => !connectorIdentifiers.has(m.identifier))
    .map((m) => {
      const perms = connectorPermsByIdentifier.get(m.identifier);
      return perms && perms.size > 0
        ? (patchManifestWithPermissions(
            m as any,
            perms as Map<string, ConnectorToolPermission>,
          ) as ToolManifest)
        : m;
    });

  // Get all builtin tool manifests. When a manifest context is supplied (agent
  // runtime path), context-aware tools resolve their manifest for it — trimming
  // APIs (e.g. lobe-agent hides callSubAgent in groups) or opting out via `null`.
  // Context-free callers fall back to the full static manifest.
  const builtinManifests = toolStoreState.builtinTools
    .map((tool) =>
      manifestContext && tool.resolveManifest
        ? tool.resolveManifest(manifestContext)
        : tool.manifest,
    )
    .filter((m): m is BuiltinToolManifest => !!m) as ToolManifest[];

  // Get Composio tool manifests
  const composioTools = composioStoreSelectors.composioAsLobeTools(toolStoreState);
  const composioManifests = composioTools
    .map((tool) => tool.manifest as ToolManifest)
    .filter(Boolean);

  // Get LobeHub Skill tool manifests
  const lobehubSkillTools = lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(toolStoreState);
  const lobehubSkillManifests = lobehubSkillTools
    .map((tool) => tool.manifest as ToolManifest)
    .filter(Boolean);

  // Combine all manifests, dropping entries that would crash ToolsEngine.
  // Each source is filtered separately so the warning pinpoints the origin.
  const combinedManifests = [
    ...dropInvalidManifests(pluginManifests, 'installedPlugins'),
    ...dropInvalidManifests(builtinManifests, 'builtinTools'),
    ...dropInvalidManifests(composioManifests, 'composio'),
    ...dropInvalidManifests(lobehubSkillManifests, 'lobehubSkills'),
    ...dropInvalidManifests(connectorManifests, 'connectors'),
    ...dropInvalidManifests(additionalManifests, 'additionalManifests'),
  ];

  // Disabled identifiers are dropped from the pool outright (not left for the
  // enableChecker rules) — a plugin, skill, connector, or user-toggleable
  // builtin tool the agent has explicitly disabled must not be discoverable/
  // activatable at all, matching the server-side (aiAgent gateway) treatment.
  const allManifests =
    disabledPluginIds.length === 0
      ? combinedManifests
      : combinedManifests.filter((m) => !disabledPluginIds.includes(m.identifier));

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: isCanUseFC,
    manifestSchemas: allManifests,
  });
};

export const createAgentToolsEngine = (
  workingModel: WorkingModel,
  /** Runtime-resolved plugin IDs (from agentConfigResolver), may include tools beyond the active agent */
  pluginIds?: string[],
  /** Conversation context for context-aware builtin manifests (scope, isSubAgent). */
  manifestContext?: BuiltinToolResolveContext,
) => {
  const searchConfig = getSearchConfig(workingModel.model, workingModel.provider);
  const agentState = getAgentStoreState();
  // `currentAgentPlugins` already resolves to pinned-only identifiers — disabled
  // entries never reach the tools-engine whitelist.
  const userPlugins = agentSelectors.currentAgentPlugins(agentState);
  const disabledPluginIds = agentSelectors.currentAgentDisabledPlugins(agentState);
  const isChatMode =
    agentChatConfigSelectors.currentChatConfig(agentState).enableAgentMode === false ||
    !isCanUseFC(workingModel.model, workingModel.provider);

  // Each entry below still respects its own runtime gate; in chat mode this
  // is the entire whitelist. `allowExplicitActivation` and user plugins /
  // `alwaysOnToolIds` are deliberately omitted in chat mode so the activator
  // can't smuggle additional tools in.
  const kbEnabled = agentSelectors.hasEnabledKnowledgeBases(agentState);
  // Embedding availability is fetched once per cache scope at app init and read
  // synchronously here — only the *current* scope's entry, so another account /
  // workspace's result never applies. Only a confirmed `false` gates the tool;
  // `undefined` (not loaded for this scope yet / fetch failed) keeps the
  // toggle-only behavior. Mirrors the server `memoryEmbeddingAvailable` gate in
  // Mecha/AgentToolsEngine.
  const memoryEmbeddingAvailable =
    userMemorySelectors.memoryEmbeddingAvailable(getCacheScope())(getUserMemoryStoreState());
  const memoryEnabled =
    (agentChatConfigSelectors.currentChatConfig(agentState).memory?.enabled ??
      settingsSelectors.memoryEnabled(useUserStore.getState())) &&
    memoryEmbeddingAvailable !== false;
  const webBrowsingEnabled = searchConfig.useApplicationBuiltinSearchTool;
  const { dingtalkApproval, dingtalkPersonal, dingtalkWorkspace, enterpriseLookup } =
    readEnterpriseToolFlags();
  // Native search and the platform browsing tool must not stack. Drop the
  // web-browsing manifest from the pool so `allowExplicitActivation` cannot
  // re-enable it after lobe-activator. DingTalk / enterprise-lookup are
  // dropped the same way when their capability flag is off or unknown, and
  // user-memory when no embedding model is configured (every call would fail).
  const disabledIds = [
    ...(webBrowsingEnabled
      ? disabledPluginIds
      : [...disabledPluginIds, WebBrowsingManifest.identifier]),
    ...(!dingtalkApproval ? [DINGTALK_APPROVAL_TOOL_IDENTIFIER] : []),
    ...(!dingtalkWorkspace ? [DINGTALK_WORKSPACE_TOOL_IDENTIFIER] : []),
    ...(!dingtalkPersonal ? [DINGTALK_PERSONAL_TOOL_IDENTIFIER] : []),
    ...(!enterpriseLookup ? [ENTERPRISE_LOOKUP_TOOL_IDENTIFIER] : []),
    ...(memoryEmbeddingAvailable === false ? [MemoryManifest.identifier] : []),
  ];

  const chatModeRules = {
    [DocumentPagesManifest.identifier]: true,
    [KnowledgeBaseManifest.identifier]: kbEnabled,
    [MemoryManifest.identifier]: memoryEnabled,
    [WebBrowsingManifest.identifier]: webBrowsingEnabled,
  };

  const agentModeRules = {
    // Runtime-resolved plugins (from agentConfigResolver for the effective agent,
    // may include sub-agent/group/page scope plugins not on the active agent)
    ...(pluginIds && Object.fromEntries(pluginIds.map((id) => [id, true]))),
    // User-selected plugins (from the active agent)
    ...Object.fromEntries(userPlugins.map((id) => [id, true])),
    // Always-on builtin tools
    ...Object.fromEntries(alwaysOnToolIds.map((id) => [id, true])),
    // System-level rules (may override user selection for specific tools)
    [CloudSandboxManifest.identifier]: agentChatConfigSelectors.isCloudSandboxEnabled(agentState),
    [KnowledgeBaseManifest.identifier]: kbEnabled,
    [LocalSystemManifest.identifier]: agentChatConfigSelectors.isLocalSystemEnabled(agentState),
    [MemoryManifest.identifier]: memoryEnabled,
    [WebBrowsingManifest.identifier]: webBrowsingEnabled,
    [ENTERPRISE_LOOKUP_TOOL_IDENTIFIER]: enterpriseLookup,
    // Same mechanism as enterprise-lookup: enable rule + defaultToolIds, not
    // always-on. The approval manifest is large; keep it off the prompt when
    // the connector flag is off.
    [DINGTALK_APPROVAL_TOOL_IDENTIFIER]: dingtalkApproval,
    [DINGTALK_WORKSPACE_TOOL_IDENTIFIER]: dingtalkWorkspace,
    [DINGTALK_PERSONAL_TOOL_IDENTIFIER]: dingtalkPersonal,
  };

  return createToolsEngine({
    // Enabling a tool that isn't a candidate is a no-op — the checker only
    // filters `union(toolIds, defaultToolIds)`. DingTalk ids are not in the
    // shared always-on / default lists (token cost); inject them here when
    // the matching capability is on so the model can call them without an
    // activator round-trip.
    defaultToolIds: isChatMode
      ? chatModeAllowedToolIds
      : [
          ...defaultToolIds,
          ...(dingtalkApproval ? [DINGTALK_APPROVAL_TOOL_IDENTIFIER] : []),
          ...(dingtalkWorkspace ? [DINGTALK_WORKSPACE_TOOL_IDENTIFIER] : []),
          ...(dingtalkPersonal ? [DINGTALK_PERSONAL_TOOL_IDENTIFIER] : []),
        ],
    disabledPluginIds: disabledIds,
    manifestContext,
    enableChecker: createEnableChecker({
      allowExplicitActivation: !isChatMode,
      platformFilter: ({ pluginId }) => {
        const toolStoreState = getToolStoreState();
        const installedPlugin = pluginSelectors.getInstalledPluginById(pluginId)(toolStoreState);

        if (
          !isToolAvailableInCurrentEnv(pluginId, {
            installedPlugins: installedPlugin ? [installedPlugin] : toolStoreState.installedPlugins,
          })
        ) {
          return false;
        }

        return undefined; // fall through to rules
      },
      rules: isChatMode ? chatModeRules : agentModeRules,
    }),
  });
};

/**
 * Provides the same functionality using ToolsEngine with enhanced capabilities
 *
 * @param toolIds - Array of tool IDs to generate tools for
 * @param model - Model name for function calling compatibility check (optional)
 * @param provider - Provider name for function calling compatibility check (optional)
 * @returns Array of ChatCompletionTool objects
 */
export const getEnabledTools = (
  toolIds: string[] = [],
  model: string,
  provider: string,
): ChatCompletionTool[] => {
  const toolsEngine = createToolsEngine();

  return (
    toolsEngine.generateTools({
      model, // Use provided model or fallback
      provider, // Use provided provider or fallback
      toolIds,
    }) || []
  );
};
