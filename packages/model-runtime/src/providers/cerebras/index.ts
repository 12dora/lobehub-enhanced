import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import {
  createOpenAICompatibleRuntime,
  transformResponseToStream,
} from '../../core/openaiCompatibleFactory';
import { composeAbortSignal } from '../../utils/fetchTransport';
import { processMultiProviderModelList } from '../../utils/modelParse';

const DEFAULT_CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';

/**
 * Public catalog, default Cerebras format (omit `format`).
 * That pin returns `pricing.prompt` / `pricing.completion` as USD-per-token
 * decimal strings; `?format=huggingface` is the same numbers already × 1e6.
 */
const resolveCerebrasPublicModelsUrl = (baseURL?: string) => {
  const openaiBase = (baseURL || DEFAULT_CEREBRAS_BASE_URL).replace(/\/+$/, '');
  const origin = openaiBase.replace(/\/v1$/i, '');
  return `${origin}/public/v1/models`;
};

export interface CerebrasAuthModel {
  created?: number;
  id: string;
  object?: string;
  owned_by?: string;
}

export interface CerebrasPublicModel {
  capabilities?: {
    function_calling?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  };
  description?: string;
  id: string;
  limits?: {
    max_completion_tokens?: number;
    max_context_length?: number;
  };
  name?: string;
  pricing?: {
    completion?: number | string;
    prompt?: number | string;
  };
}

/** Public catalog is enrichment only; a hang must not stall the authenticated list. */
const PUBLIC_CATALOG_FETCH_TIMEOUT_MS = 10_000;

/**
 * Default Cerebras format: USD per single token. formatPricing expects
 * USD per million tokens, so × 1e6. 0.00000099 × 1e6 = 0.99.
 * Drop the unit unless the converted rate is a finite, non-negative number.
 */
const usdPerTokenToPerMillion = (value: number | string | undefined): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  const perMillion = n * 1e6;
  if (!Number.isFinite(perMillion) || perMillion < 0) return undefined;
  return perMillion;
};

const optionalBool = (value: boolean | undefined) =>
  typeof value === 'boolean' ? value : undefined;

const mapCerebrasPublicEnrichment = (pub: CerebrasPublicModel) => {
  const input = usdPerTokenToPerMillion(pub.pricing?.prompt);
  const output = usdPerTokenToPerMillion(pub.pricing?.completion);

  return {
    contextWindowTokens: pub.limits?.max_context_length,
    description: pub.description,
    displayName: pub.name,
    functionCall: optionalBool(pub.capabilities?.function_calling),
    maxOutput: pub.limits?.max_completion_tokens,
    pricing: input !== undefined || output !== undefined ? { input, output } : undefined,
    reasoning: optionalBool(pub.capabilities?.reasoning),
    vision: optionalBool(pub.capabilities?.vision),
  };
};

const loadCerebrasPublicCatalog = async (
  baseURL?: string,
  signal?: AbortSignal,
): Promise<Map<string, CerebrasPublicModel>> => {
  const catalog = new Map<string, CerebrasPublicModel>();
  const abort = composeAbortSignal(signal, PUBLIC_CATALOG_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(resolveCerebrasPublicModelsUrl(baseURL), {
      signal: abort.signal,
    });
    if (!response.ok) return catalog;

    const body = (await response.json()) as
      CerebrasPublicModel[] | { data?: CerebrasPublicModel[] };
    const list = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];

    for (const item of list) {
      if (item?.id) catalog.set(item.id, item);
    }
  } catch {
    // Public list is enrichment only; a failure or timeout must not fail /v1/models.
  } finally {
    abort.cleanup();
  }

  return catalog;
};

export const params = {
  baseURL: DEFAULT_CEREBRAS_BASE_URL,
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        frequency_penalty: _frequencyPenalty,
        presence_penalty: _presencePenalty,
        model,
        thinking,
        reasoning,
        reasoning_effort,
        effort,
        // Extract reasoning_format so it doesn't leak into ...rest and get sent twice
        reasoning_format: _incomingReasoningFormat,
        ...rest
      } = payload as any;

      const effortVal = reasoning_effort || reasoning?.effort || effort;
      const isThinkingDisabled = thinking?.type === 'disabled' || effortVal === 'none';
      const isThinkingEnabled = thinking?.type === 'enabled' || (effortVal && effortVal !== 'none');
      const lowerModel = model.toLowerCase();

      const isGlm = lowerModel.includes('glm');
      const isGemma4 = lowerModel.includes('gemma-4');
      const isGptOss = lowerModel.includes('gpt-oss');

      const cerebrasReasoningParams: Record<string, unknown> = {};

      if (isGlm) {
        if (isThinkingDisabled) {
          cerebrasReasoningParams.reasoning_effort = 'none';
        } else {
          cerebrasReasoningParams.reasoning_format = _incomingReasoningFormat || 'parsed';
        }
      } else if (isGemma4) {
        if (isThinkingDisabled) {
          cerebrasReasoningParams.reasoning_effort = 'none';
        } else if (isThinkingEnabled) {
          cerebrasReasoningParams.reasoning_effort = 'medium';
          cerebrasReasoningParams.reasoning_format = 'parsed';
        }
      } else if (isGptOss) {
        if (isThinkingDisabled) {
          cerebrasReasoningParams.reasoning_format = 'hidden';
        } else {
          const effortMap: Record<string, string> = {
            low: 'low',
            minimal: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'high',
            max: 'high',
          };
          cerebrasReasoningParams.reasoning_effort =
            (effortVal && effortMap[effortVal]) || 'medium';
          cerebrasReasoningParams.reasoning_format = _incomingReasoningFormat || 'parsed';
        }
      }

      // --- Reasoning context retention ---
      // Cerebras does not accept a standalone `reasoning_content` field.
      // Per docs: inject prior reasoning into the `content` of assistant messages.
      // GLM: wrap in <think>...</think> tags. GPT-OSS: prepend directly.
      const messages = ((rest.messages as any[]) || []).map((msg: any) => {
        if (msg.role !== 'assistant') return msg;

        const { reasoning_content, ...msgRest } = msg;
        if (!reasoning_content) return msg;

        const existingContent = typeof msgRest.content === 'string' ? msgRest.content : '';
        let newContent: string;
        if (isGlm) {
          newContent = `<think>${reasoning_content}</think>${existingContent}`;
        } else if (isGptOss) {
          newContent = `${reasoning_content}${existingContent}`;
        } else {
          // Gemma 4: docs don't specify a retention format; drop reasoning_content
          return msgRest;
        }

        return { ...msgRest, content: newContent };
      });

      return {
        ...rest,
        ...cerebrasReasoningParams,
        messages,
        model,
      } as any;
    },
    handleTransformResponseToStream: (data) => {
      const choices = data.choices || [];
      for (const choice of choices) {
        if (choice.message && 'reasoning' in choice.message) {
          (choice.message as any).reasoning_content = (choice.message as any).reasoning;
        }
      }
      return transformResponseToStream(data);
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_CEREBRAS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as
      CerebrasAuthModel[] | { data?: CerebrasAuthModel[] };
    const modelList = Array.isArray(modelsPage)
      ? modelsPage
      : Array.isArray(modelsPage?.data)
        ? modelsPage.data
        : [];

    const publicById = await loadCerebrasPublicCatalog(client.baseURL);

    const enriched = modelList
      .filter((model) => model?.id)
      .map((model) => {
        const pub = publicById.get(model.id);
        if (!pub) {
          // Missing from the public subset — no metadata, by design.
          return { id: model.id };
        }

        return { id: model.id, ...mapCerebrasPublicEnrichment(pub) };
      });

    return processMultiProviderModelList(enriched, 'cerebras');
  },
  provider: ModelProvider.Cerebras,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeCerebrasAI = createOpenAICompatibleRuntime(params);
