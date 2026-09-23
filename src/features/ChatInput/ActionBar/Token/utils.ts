import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type { LobeAgentChatConfig, RuntimeEnvMode } from '@lobechat/types';

interface ToolContextRefreshKeyOptions {
  agentId?: string;
  enableAgentMode?: boolean;
  hasEnabledKnowledgeBases?: boolean;
  isModelBuiltinSearchInternal?: boolean;
  isModelHasBuiltinSearch?: boolean;
  isProviderHasBuiltinSearch?: boolean;
  /** `undefined` = unknown (not loaded / failed); only `false` hides the memory tool. */
  memoryEmbeddingAvailable?: boolean;
  memoryEnabled?: boolean;
  runtimeMode?: RuntimeEnvMode;
  searchMode?: LobeAgentChatConfig['searchMode'];
  skillActivateMode?: LobeAgentChatConfig['skillActivateMode'];
  useModelBuiltinSearch?: boolean;
}

export const getToolExcludeDefaultToolIds = (
  skillActivateMode?: LobeAgentChatConfig['skillActivateMode'],
) => (skillActivateMode === 'manual' ? manualModeExcludeToolIds : undefined);

export const getToolContextRefreshKey = ({
  agentId,
  enableAgentMode,
  hasEnabledKnowledgeBases,
  isModelBuiltinSearchInternal,
  isModelHasBuiltinSearch,
  isProviderHasBuiltinSearch,
  memoryEmbeddingAvailable,
  memoryEnabled,
  runtimeMode,
  searchMode,
  skillActivateMode,
  useModelBuiltinSearch,
}: ToolContextRefreshKeyOptions) =>
  [
    agentId || '',
    enableAgentMode === false ? 'chat' : 'agent',
    searchMode || 'auto',
    useModelBuiltinSearch ? 'model-search' : 'app-search',
    skillActivateMode || 'auto',
    memoryEnabled ? 'memory-on' : 'memory-off',
    hasEnabledKnowledgeBases ? 'knowledge-on' : 'knowledge-off',
    runtimeMode || 'none',
    isProviderHasBuiltinSearch ? 'provider-search-on' : 'provider-search-off',
    isModelHasBuiltinSearch ? 'model-search-on' : 'model-search-off',
    isModelBuiltinSearchInternal ? 'internal-search-on' : 'internal-search-off',
    memoryEmbeddingAvailable === false ? 'memory-embedding-off' : 'memory-embedding-unknown-or-on',
  ].join('|');
