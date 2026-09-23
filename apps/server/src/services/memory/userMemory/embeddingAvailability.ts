import { lobehubRouterRuntimeOptions } from '@lobechat/business-model-runtime';
import type { LobeChatDatabase } from '@lobechat/database';
import type { UserServiceModelConfig } from '@lobechat/types';
import debug from 'debug';

import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import { getLLMConfig } from '@/envs/llm';
import type { AiCatalogCredentialVault } from '@/server/enterprise/services/aiCatalog/credentialAdapter';
import { REQUIRED_CREDENTIALS } from '@/server/enterprise/services/aiCatalog/credentialRequirements';
import {
  isSettingsPolicyEnabled,
  loadEffectiveUserSettings,
} from '@/server/enterprise/services/settings/runtimeSettingsAdapter';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  getPlatformAiTakeoverFlags,
  listPlatformCatalogModels,
  listPlatformPublishedModels,
  resolvePlatformAiExecutionConfig,
} from '@/server/modules/ModelRuntime/platformAiRuntimeBridge';

import { readUserMemoryEmbeddingOverride, resolveMemoryServiceAgent } from './resolveEmbedding';

const log = debug('lobe-server:memory:user-memory:embedding');

export type MemoryEmbeddingUnavailableReason =
  'missing_credentials' | 'model_not_enabled' | 'not_configured';

export interface MemoryEmbeddingAvailability {
  available: boolean;
  model?: string;
  provider?: string;
  reason?: MemoryEmbeddingUnavailableReason;
}

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Config/credential presence only. Never calls the embedding provider.
 */
export const vaultHasUsableCredential = (
  provider: string,
  keyVaults: Record<string, unknown> | undefined,
): boolean => {
  if (!keyVaults) return false;

  const checker = REQUIRED_CREDENTIALS[provider];
  if (checker) {
    try {
      checker(keyVaults as AiCatalogCredentialVault);
      return true;
    } catch {
      return false;
    }
  }

  return hasText(keyVaults.apiKey) || hasText(keyVaults.oauthAccessToken);
};

const envProviderKey = (provider: string): string | undefined => {
  try {
    const llmConfig = getLLMConfig() as Record<string, unknown>;
    const value = llmConfig[`${provider.toUpperCase()}_API_KEY`];
    return hasText(value) ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Model/provider env selects an embedding target. The dedicated API key is not
 * a selection: search/save never pass it into `initModelRuntimeFromDB`.
 */
const embeddingEnvConfigured = (): boolean =>
  Boolean(
    process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL ||
    process.env.MEMORY_USER_MEMORY_EMBEDDING_PROVIDER,
  );

/**
 * Runtimes that do not read `PROVIDER_API_KEY`. Same set as
 * `hasModelRuntimeEnvironmentFallback` refusing an env key.
 */
const RUNTIME_IGNORES_ENV_API_KEY = new Set([
  'chatgpt',
  'chatgptweb',
  'cursor',
  'githubcopilot',
  'grok',
  'lobehub',
  'supergrok',
]);

const runtimeUsesEnvApiKey = (provider: string): boolean =>
  !RUNTIME_IGNORES_ENV_API_KEY.has(provider.toLowerCase()) && Boolean(envProviderKey(provider));

interface LoadedEmbeddingSettings {
  /**
   * True when an effective model is selected: a published value, a user override,
   * the registry built-in (still judged by credentials below), a legacy settings
   * blob, or the memory embedding model/provider env.
   */
  configured: boolean;
  systemAgent?: Partial<UserServiceModelConfig>;
}

const loadEmbeddingSettings = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<LoadedEmbeddingSettings> => {
  try {
    if (!(await isSettingsPolicyEnabled())) {
      const settings = await new UserModel(db, userId).getUserSettings();
      const systemAgent = settings?.systemAgent as Partial<UserServiceModelConfig> | undefined;
      const item = systemAgent?.userMemoryEmbedding;
      return {
        configured: Boolean(item?.model || item?.provider) || embeddingEnvConfigured(),
        systemAgent,
      };
    }

    const row = await new UserModel(db, userId).getUserSettings();
    const { effective, settings } = await loadEffectiveUserSettings({
      db,
      legacySettings: {
        defaultAgent: row?.defaultAgent,
        systemAgent: row?.systemAgent,
        tool: row?.tool,
      } as Record<string, unknown>,
      userId,
    });
    const sources = [
      effective.pathMeta['systemAgent.userMemoryEmbedding.model']?.source,
      effective.pathMeta['systemAgent.userMemoryEmbedding.provider']?.source,
    ];
    return {
      configured: sources.some((source) => Boolean(source)) || embeddingEnvConfigured(),
      systemAgent: settings.systemAgent as Partial<UserServiceModelConfig> | undefined,
    };
  } catch (error) {
    log('[user-memory] failed to read embedding settings: %O', error);
    return { configured: embeddingEnvConfigured() };
  }
};

export interface ResolvedMemoryEmbeddingTarget {
  /**
   * An effective model is selected: settings (including the registry built-in)
   * or the memory-embedding model/provider env. Credentials are a separate check.
   */
  configured: boolean;
  model: string;
  provider: string;
}

/**
 * Effective user-memory embedding model.
 * Same chain as extraction: published systemAgent → user override if allowed → env/default.
 */
export const resolveEffectiveMemoryEmbedding = async (params: {
  db: LobeChatDatabase;
  userId: string;
}): Promise<ResolvedMemoryEmbeddingTarget> => {
  const loaded = await loadEmbeddingSettings(params.db, params.userId);
  const fallback = parseMemoryExtractionConfig().embedding;
  const resolved = resolveMemoryServiceAgent(
    readUserMemoryEmbeddingOverride(loaded.systemAgent),
    fallback,
  );
  const model = resolved.model?.trim() || fallback.model;
  const provider = (resolved.provider || fallback.provider || 'openai').trim() || 'openai';

  return {
    configured: loaded.configured && Boolean(model && provider),
    model,
    provider,
  };
};

interface CatalogEmbeddingModel {
  enabled?: boolean;
  id?: string;
  modelKey?: string;
  type?: string;
}

/**
 * Same predicate as the managed runtime allowlist: an enabled model whose type
 * is `embedding`. A missing type is not an embedding (the catalog defaults it
 * to chat).
 */
const catalogEnablesEmbedding = (
  models: readonly CatalogEmbeddingModel[] | null | undefined,
  model: string,
): boolean =>
  (models ?? []).some((item) => {
    const key = item.modelKey ?? item.id;
    return key === model && item.type === 'embedding' && item.enabled !== false;
  });

type PlatformEmbeddingGate =
  | { state: 'blocked'; reason: 'missing_credentials' | 'model_not_enabled' }
  | { state: 'ready' }
  | { state: 'skip' };

/**
 * Platform-owned providers use `allowedModels` (the execution allowlist).
 * Model takeover without provider ownership uses the published catalog.
 * `skip` means this deployment is not gating the model, so user/env credentials apply.
 */
const platformEmbeddingGate = async (
  db: LobeChatDatabase,
  provider: string,
  model: string,
): Promise<PlatformEmbeddingGate> => {
  try {
    const flags = await getPlatformAiTakeoverFlags(db);
    if (!flags.providers && !flags.models) return { state: 'skip' };

    if (flags.providers) {
      const published = await listPlatformPublishedModels(db, provider);
      if (published !== null) {
        const execution = await resolvePlatformAiExecutionConfig(db, provider);
        if (!catalogEnablesEmbedding(execution.allowedModels, model)) {
          return { state: 'blocked', reason: 'model_not_enabled' };
        }
        return vaultHasUsableCredential(
          execution.runtimeProvider || provider,
          execution.keyVaults as Record<string, unknown>,
        )
          ? { state: 'ready' }
          : { state: 'blocked', reason: 'missing_credentials' };
      }
    }

    if (flags.models) {
      const catalog = await listPlatformCatalogModels(db, provider);
      if (!catalogEnablesEmbedding(catalog ?? [], model)) {
        return { state: 'blocked', reason: 'model_not_enabled' };
      }
    }

    return { state: 'skip' };
  } catch (error) {
    log('[user-memory] platform embedding credential check failed: %O', {
      error,
      provider,
    });
    return { state: 'blocked', reason: 'missing_credentials' };
  }
};

/**
 * LobeHub in this deployment is a router with no embedding route. Any other
 * provider keeps the normal credential path. No network call: the router list
 * is local config.
 */
const runtimeReportsEmbeddings = async (provider: string, model: string): Promise<boolean> => {
  if (provider.toLowerCase() !== 'lobehub') return true;
  try {
    const routers = await lobehubRouterRuntimeOptions.routers({}, { model });
    return routers.some((router) => {
      const models = router.models;
      if (!models?.length) return true;
      return models.includes(model);
    });
  } catch (error) {
    log('[user-memory] lobehub embedding route check failed: %O', error);
    return false;
  }
};

const userCredential = async (params: {
  db: LobeChatDatabase;
  provider: string;
  userId: string;
  workspaceId?: string;
}): Promise<boolean> => {
  try {
    const providerConfig = await new AiProviderModel(
      params.db,
      params.userId,
      params.workspaceId,
    ).getAiProviderById(params.provider, KeyVaultsGateKeeper.getUserKeyVaults);
    const runtimeProvider = providerConfig?.settings?.sdkType || params.provider;
    return vaultHasUsableCredential(
      runtimeProvider,
      providerConfig?.keyVaults as Record<string, unknown> | undefined,
    );
  } catch (error) {
    log('[user-memory] user embedding credential check failed: %O', {
      error,
      provider: params.provider,
    });
    return false;
  }
};

const unavailable = (
  target: { model?: string; provider?: string },
  reason: MemoryEmbeddingUnavailableReason,
): MemoryEmbeddingAvailability => ({
  available: false,
  model: target.model,
  provider: target.provider,
  reason,
});

/**
 * Whether memory search/save can embed without calling the provider.
 * `available` is false when no model resolved, the published catalog does not
 * enable that embedding model, the runtime cannot embed, or no credential the
 * runtime actually receives is present.
 */
export const getMemoryEmbeddingAvailability = async (params: {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}): Promise<MemoryEmbeddingAvailability> => {
  const target = await resolveEffectiveMemoryEmbedding(params);
  if (!target.configured || !target.model || !target.provider) {
    return unavailable(target, 'not_configured');
  }

  if (!(await runtimeReportsEmbeddings(target.provider, target.model))) {
    return unavailable(target, 'model_not_enabled');
  }

  const platform = await platformEmbeddingGate(params.db, target.provider, target.model);
  if (platform.state === 'ready') {
    return { available: true, model: target.model, provider: target.provider };
  }
  if (platform.state === 'blocked') return unavailable(target, platform.reason);

  if (
    await userCredential({
      db: params.db,
      provider: target.provider,
      userId: params.userId,
      workspaceId: params.workspaceId,
    })
  ) {
    return { available: true, model: target.model, provider: target.provider };
  }

  // `MEMORY_USER_MEMORY_EMBEDDING_API_KEY` is intentionally ignored. Extraction
  // reads it, but search/save call `initModelRuntimeFromDB`, which only sees
  // the provider vault and the provider env key below.
  if (runtimeUsesEnvApiKey(target.provider)) {
    return { available: true, model: target.model, provider: target.provider };
  }

  return unavailable(target, 'missing_credentials');
};
