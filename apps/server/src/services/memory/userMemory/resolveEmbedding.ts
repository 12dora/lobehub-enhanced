import type { SystemAgentReasoningEffort, UserServiceModelConfig } from '@lobechat/types';

/**
 * Platform/user override for one memory service model.
 * Matches the fields `MemoryExtractionExecutor` reads from `systemAgent`.
 */
export interface MemoryServiceAgentOverride {
  contextLimit?: number;
  model?: string;
  provider?: string;
  reasoningEffort?: SystemAgentReasoningEffort | null;
}

/**
 * Env / private-config fallback for a memory service model.
 * Same shape `parseMemoryExtractionConfig().embedding` already has.
 */
export interface MemoryServiceAgentFallback {
  apiKey?: string;
  baseURL?: string;
  contextLimit?: number;
  language?: string;
  model: string;
  provider?: string;
  reasoningEffort?: SystemAgentReasoningEffort | null;
}

const normalizeProvider = (provider: string) => provider.toLowerCase();

/**
 * Resolve one memory service agent the way background extraction does:
 * platform-published / user `systemAgent` override, then the private-config fallback.
 *
 * Credential inheritance follows extraction: a same-provider override keeps the
 * fallback API key and base URL; a different provider does not.
 */
export const resolveMemoryServiceAgent = (
  override: MemoryServiceAgentOverride | undefined,
  fallback: MemoryServiceAgentFallback,
): MemoryServiceAgentFallback => {
  const provider = override?.provider || fallback.provider;
  const shouldInheritCredentials =
    !override?.provider ||
    normalizeProvider(override.provider) === normalizeProvider(fallback.provider || 'openai');
  const contextLimit =
    typeof override?.contextLimit === 'number' &&
    Number.isFinite(override.contextLimit) &&
    override.contextLimit > 0
      ? Math.floor(override.contextLimit)
      : fallback.contextLimit;

  return {
    apiKey: shouldInheritCredentials ? fallback.apiKey : undefined,
    baseURL: shouldInheritCredentials ? fallback.baseURL : undefined,
    contextLimit,
    language: fallback.language,
    model: override?.model || fallback.model,
    provider,
    reasoningEffort: override?.reasoningEffort,
  };
};

export const readUserMemoryEmbeddingOverride = (
  systemAgent: Partial<UserServiceModelConfig> | undefined,
): MemoryServiceAgentOverride | undefined => systemAgent?.userMemoryEmbedding;
