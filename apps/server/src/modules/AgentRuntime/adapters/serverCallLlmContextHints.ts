import { type CallLLMPayload, stripAssistantReasoningForReplay } from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import type { ModelExtendParams } from '@lobechat/model-runtime';
import {
  applyModelExtendParams,
  clampEffortLevel,
  findEffortControl,
  isAggregationProviderForEffortLookup,
  isDeepSeekThinkingEligibleModel,
  isDeepSeekV4FamilyModel,
  isKimiAlwaysPreserveThinkingModel,
  narrowEffortLevels,
  readExtendParamsFromModelCards,
} from '@lobechat/model-runtime';
import type { LobeAgentChatConfig, UIChatMessage } from '@lobechat/types';
import { type ExtendParamsType, ModelProvider } from 'model-bank';
import { isProviderNativeFileInput } from 'model-bank/modelProviders';

import { AiModelModel } from '@/database/models/aiModel';

import type { RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';

interface ResolveServerCallLlmContextHintsInput {
  ctx: RuntimeExecutorContext;
  llmPayload: CallLLMPayload;
  model: string;
  provider: string;
}

/** Published catalog row, or a static-bank card, reduced to the effort fields. */
interface EffortSourceCard {
  config?: { deploymentName?: string };
  id: string;
  providerId: string;
  settings?: {
    defaultEffortLevel?: string | null;
    effortLevels?: readonly string[] | null;
    extendParams?: string[];
  };
}

const matchesEffortModelId = (item: EffortSourceCard, model: string) =>
  item.id === model || item.config?.deploymentName === model;

const findEffortSourceCard = (
  models: readonly EffortSourceCard[] | undefined,
  model: string,
  provider: string,
) => models?.find((item) => item.providerId === provider && matchesEffortModelId(item, model));

const nonEmptyExtendParams = (card: EffortSourceCard | undefined) => {
  const params = card?.settings?.extendParams;
  return params?.length ? params : undefined;
};

/**
 * Published models from the process-wide catalog projection. A miss or a
 * catalog error returns undefined so the caller can fall back to the static bank.
 */
const loadPublishedCatalogModels = async (
  db: RuntimeExecutorContext['serverDB'] | undefined,
): Promise<readonly EffortSourceCard[] | undefined> => {
  if (!db) return undefined;

  try {
    const [{ AiCatalogRuntimeAdapter }, { getEmptyAiProviderRuntimeState }] = await Promise.all([
      import('@/server/enterprise/services/aiCatalog/runtimeAdapter'),
      import('@/server/enterprise/services/aiCatalog/runtimeProjection'),
    ]);
    const state = await new AiCatalogRuntimeAdapter(db).resolve({
      upstreamState: getEmptyAiProviderRuntimeState(),
    });
    return state.enabledAiModels;
  } catch (error) {
    log('Failed to read the published AI catalog for model extend params: %O', error);
    return undefined;
  }
};

/**
 * Prefer the published card for this provider/model. Only a missing card falls
 * back to the static bank (same aggregator rule as `readExtendParamsFromModelCards`).
 */
const resolveEffortSource = (
  published: readonly EffortSourceCard[] | undefined,
  builtin: readonly EffortSourceCard[],
  model: string,
  provider: string,
): { card?: EffortSourceCard; extendParams?: string[] } => {
  const publishedCard = findEffortSourceCard(published, model, provider);
  if (publishedCard) {
    return { card: publishedCard, extendParams: nonEmptyExtendParams(publishedCard) };
  }

  const extendParams = readExtendParamsFromModelCards(builtin, model, provider);
  if (!extendParams) return {};

  const providerCard = findEffortSourceCard(builtin, model, provider);
  if (nonEmptyExtendParams(providerCard)) return { card: providerCard, extendParams };

  if (!isAggregationProviderForEffortLookup(provider)) return { extendParams };

  const idMatch = builtin.find(
    (item) => matchesEffortModelId(item, model) && !!nonEmptyExtendParams(item),
  );
  return { card: idMatch, extendParams };
};

/**
 * When the card narrows an effort control, map the stored level onto the levels
 * it actually offers (nearest, ties → stronger) before it is written to the payload.
 */
const clampChatConfigToCardEffort = (
  chatConfig: LobeAgentChatConfig,
  extendParams: readonly string[] | undefined,
  card: EffortSourceCard | undefined,
): LobeAgentChatConfig => {
  const settings = card?.settings;
  if (!extendParams?.length || !settings) return chatConfig;
  if (!settings.effortLevels?.length && !settings.defaultEffortLevel) return chatConfig;

  const control = findEffortControl(extendParams);
  if (!control) return chatConfig;

  const stored = chatConfig[control.definition.configKey];
  if (typeof stored !== 'string') return chatConfig;

  const offered = narrowEffortLevels(control.definition, settings);
  const clamped = clampEffortLevel(control.definition, stored, offered);
  if (clamped === stored) return chatConfig;

  return { ...chatConfig, [control.definition.configKey]: clamped } as LobeAgentChatConfig;
};

export interface ServerCallLlmContextHints {
  capabilities: {
    isCanUseAudio: (model: string, provider: string) => boolean;
    isCanUseFC: (model: string, provider: string) => boolean;
    isCanUseFiles: (model: string, provider: string) => boolean;
    isCanUseVideo: (model: string, provider: string) => boolean;
    isCanUseVision: (model: string, provider: string) => boolean;
  };
  messagesForContext: UIChatMessage[];
  modelDisplayName?: string;
  modelKnowledgeCutoff?: string;
  preserveThinkingForPayload?: boolean;
  resolvedExtendParams?: ModelExtendParams & { enabledSearch?: boolean };
  shouldReplayAssistantReasoning: boolean;
}

export const resolveServerCallLlmContextHints = async ({
  ctx,
  llmPayload,
  model,
  provider,
}: ResolveServerCallLlmContextHintsInput): Promise<ServerCallLlmContextHints> => {
  const agentConfig = ctx.agentConfig;
  const { loadModels } = await import('@/business/client/model-bank/loadModels');
  const [builtinModels, publishedModels] = await Promise.all([
    loadModels(),
    loadPublishedCatalogModels(ctx.serverDB),
  ]);

  const preserveThinkingConfigured =
    typeof agentConfig?.chatConfig?.preserveThinking === 'boolean'
      ? agentConfig.chatConfig.preserveThinking
      : undefined;
  const preserveThinkingRequested = preserveThinkingConfigured === true;

  const modelCard = builtinModels.find(
    (item) =>
      item.providerId === provider && (item.id === model || item.config?.deploymentName === model),
  );
  const canonicalModelCard = builtinModels.find(
    (item) => item.id === model || item.config?.deploymentName === model,
  );
  const modelKnowledgeCutoff =
    modelCard?.knowledgeCutoff ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.knowledgeCutoff : undefined);
  let modelDisplayName =
    modelCard?.displayName ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.displayName : undefined);

  // Custom/remote user models aren't in the bundled model bank, so both cards
  // miss. Fall back to the user's own AI model record so server-side runs still
  // surface identity (the inbox `{{model}}` fallback no longer exists).
  if (!modelDisplayName && ctx.serverDB && ctx.userId) {
    try {
      const aiModelModel = new AiModelModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const userModel = await aiModelModel.findByIdAndProvider(model, provider);
      modelDisplayName = userModel?.displayName ?? undefined;
    } catch (error) {
      log('Failed to resolve user model display name for %s: %O', model, error);
    }
  }

  // Published catalog card first (the same source the web client uses), then the
  // static bank. A published card with an empty extendParams list is authoritative:
  // it must not inherit another provider's controls. The bank fallback keeps the
  // LobeHub-only same-id rule — a CometAPI/custom empty card must not inherit
  // origin `hy3ReasoningEffort` (or similar) and emit unsupported params.
  const { card: effortCard, extendParams: modelExtendParams } = resolveEffortSource(
    publishedModels,
    builtinModels,
    model,
    provider,
  );

  const modelSupportsPreserveThinkingFromCard =
    Array.isArray(modelExtendParams) && modelExtendParams.includes('preserveThinking');
  // Kimi K2.7+ Code has preserved thinking always active and cannot opt out.
  const kimiForcesPreserveThinking =
    (provider === 'moonshot' || provider === BRANDING_PROVIDER) &&
    isKimiAlwaysPreserveThinkingModel(model);
  // DeepSeek V4 / reasoner thinking models MUST replay the real assistant
  // reasoning in history — this is mandatory, not opt-in. Their
  // Anthropic-compatible API rejects an assistant tool-call turn whose
  // thinking block is missing (HTTP 400), so stripping reasoning leaves the
  // payload builder no choice but to emit a whitespace-only placeholder
  // thinking block. Under large agentic context that degenerate history makes
  // the model emit its final answer *inside* the thinking block with empty
  // visible text (controlled replay: ~30% answer-in-thinking with the
  // placeholder vs ~2.5% when the genuine reasoning is replayed). The only
  // opt-out is a V4 model whose thinking the user explicitly disabled via
  // `deepseekV4ReasoningEffort: 'none'`. That flag is V4-specific and may
  // linger on an agent after switching models, so it must NOT suppress
  // replay for `deepseek-reasoner`, which is thinking-only and always
  // forces reasoning history in the payload builder — suppressing it there
  // would reintroduce the 400/answer-hidden behavior.
  const deepseekV4ThinkingDisabled =
    isDeepSeekV4FamilyModel(model) && agentConfig?.chatConfig?.deepseekV4ReasoningEffort === 'none';
  const deepseekForcesPreserveThinking =
    isDeepSeekThinkingEligibleModel(model) && !deepseekV4ThinkingDisabled;
  const modelForcesPreserveThinking = kimiForcesPreserveThinking || deepseekForcesPreserveThinking;
  const providerSupportsPreserveThinkingFallback =
    provider === 'qwen' || provider === 'zhipu' || provider === 'moonshot';
  const modelSupportsPreserveThinking =
    modelForcesPreserveThinking ||
    modelSupportsPreserveThinkingFromCard ||
    (!modelCard && providerSupportsPreserveThinkingFallback);

  const shouldReplayAssistantReasoning =
    (modelForcesPreserveThinking || preserveThinkingRequested) && modelSupportsPreserveThinking;
  const preserveThinkingForPayload = modelForcesPreserveThinking
    ? true
    : modelSupportsPreserveThinking && typeof preserveThinkingConfigured === 'boolean'
      ? preserveThinkingConfigured
      : undefined;

  const chatConfigForExtendParams = agentConfig?.chatConfig
    ? clampChatConfigToCardEffort(agentConfig.chatConfig, modelExtendParams, effortCard)
    : undefined;
  const resolvedModelExtendParams = chatConfigForExtendParams
    ? applyModelExtendParams({
        chatConfig: chatConfigForExtendParams,
        extendParams: modelExtendParams as ExtendParamsType[] | undefined,
        model,
      })
    : undefined;
  const searchDecision = ctx.searchDecision;
  const enabledSearch =
    searchDecision?.enabledSearch && searchDecision.useModelSearch ? true : undefined;
  const resolvedExtendParams =
    resolvedModelExtendParams || enabledSearch
      ? {
          ...resolvedModelExtendParams,
          ...(enabledSearch && { enabledSearch }),
        }
      : undefined;

  const messagesForContext = shouldReplayAssistantReasoning
    ? (llmPayload.messages as UIChatMessage[])
    : stripAssistantReasoningForReplay(llmPayload.messages as UIChatMessage[]);

  // Same id / deploymentName matching as the display-name lookup above, plus
  // a same-id fallback across providers when the exact pair is missing.
  const findModelInfo = (targetModel: string, targetProvider: string) =>
    builtinModels.find(
      (item) =>
        item.providerId === targetProvider &&
        (item.id === targetModel || item.config?.deploymentName === targetModel),
    ) ??
    builtinModels.find(
      (item) => item.id === targetModel || item.config?.deploymentName === targetModel,
    );

  return {
    capabilities: {
      isCanUseAudio: (targetModel, targetProvider) =>
        findModelInfo(targetModel, targetProvider)?.abilities?.audio ?? false,
      isCanUseFC: (targetModel, targetProvider) =>
        builtinModels.find((item) => item.id === targetModel && item.providerId === targetProvider)
          ?.abilities?.functionCall ?? true,
      // Native `file_url` parts need BOTH the model ability and a provider
      // runtime that implements the wire format (see `isProviderNativeFileInput`):
      // `abilities.files` alone is already set by catalogs whose providers have
      // no file part, and emitting it there would silently drop the document.
      // Invariant relied on downstream: only native-file providers can receive a
      // `file_url` part, so pass-through runtimes (azureai, cloudflare, …) never
      // see one. Ability resolution mirrors `isCanUseVision` below exactly.
      isCanUseFiles: (targetModel, targetProvider) =>
        isProviderNativeFileInput(targetProvider) &&
        (findModelInfo(targetModel, targetProvider)?.abilities?.files ?? false),
      isCanUseVideo: (targetModel, targetProvider) =>
        findModelInfo(targetModel, targetProvider)?.abilities?.video ?? false,
      isCanUseVision: (targetModel, targetProvider) =>
        findModelInfo(targetModel, targetProvider)?.abilities?.vision ?? false,
    },
    messagesForContext,
    modelDisplayName,
    modelKnowledgeCutoff,
    preserveThinkingForPayload,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
  };
};
