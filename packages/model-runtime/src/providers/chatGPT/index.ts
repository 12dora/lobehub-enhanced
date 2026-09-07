import { BRANDING_NAME } from '@lobechat/business-const';
import { CURRENT_VERSION } from '@lobechat/const';
import type { OwnDeploymentOrigins } from '@lobechat/utils';
import { DEFAULT_FILE_INLINE_MAX_BYTES, DEFAULT_IMAGE_INLINE_MAX_BYTES } from '@lobechat/utils';
import { isRecord } from '@lobechat/utils/object';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import debug from 'debug';
import type { ChatModelCard } from 'model-bank';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { EffortControlKey } from '../../utils/effortControlRegistry';
import { EFFORT_CONTROL_REGISTRY, isEffortControlKey } from '../../utils/effortControlRegistry';
import type { ProcessableModelCard } from '../../utils/modelParse';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { params as openAIParams } from '../openai';
import { resolveCodexClientVersion } from './clientVersion';
import { createChatGPTImage } from './createImage';

const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CHATGPT_RESPONSES_LITE_HEADER = 'x-openai-internal-codex-responses-lite';
const CHATGPT_RESPONSES_LITE_MODEL_IDS = new Set([
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-astra',
]);
const USER_AGENT = `${BRANDING_NAME}/${CURRENT_VERSION}`;

interface ChatGPTClientOptions {
  chatgptAccountId?: string;
  ownOrigins?: OwnDeploymentOrigins | Promise<OwnDeploymentOrigins>;
}

interface ChatGPTAdditionalToolsInput {
  role: 'developer';
  tools: OpenAI.Responses.Tool[];
  type: 'additional_tools';
}

export { CODEX_CLIENT_VERSION } from './clientVersion';

/** Codex `/models` is undocumented — only "this route is not there" is a catalog fallback. */
const CODEX_MODELS_MISSING_STATUSES = new Set([404, 405, 501]);

/**
 * Catalog sync reads this after `processModelList` has already turned every
 * capability into a boolean. Empty object = live payload sent none of them.
 */
export const UPSTREAM_REPORTED_ABILITIES = 'upstreamReportedAbilities';

const UPSTREAM_ABILITY_KEYS = [
  'files',
  'functionCall',
  'imageOutput',
  'reasoning',
  'search',
  'video',
  'vision',
] as const;

const AUTH_ERROR_TYPE = /authentication|authorization|permission/i;
const AUTH_ERROR_CODE =
  /invalid[_-]?(?:token|api[_-]?key)|unauthorized|forbidden|token[_-]?expired|access[_-]?denied/i;

const collectErrorSignals = (value: unknown, into: string[]): void => {
  if (!isRecord(value)) return;
  if (typeof value.code === 'string') into.push(value.code);
  if (typeof value.type === 'string') into.push(value.type);
  if ('error' in value) collectErrorSignals(value.error, into);
  if ('body' in value) collectErrorSignals(value.body, into);
};

/** A 404/405/501 is "route missing" only when the payload does not say otherwise. */
const isCodexModelsEndpointMissing = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const status =
    (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  if (typeof status !== 'number' || !CODEX_MODELS_MISSING_STATUSES.has(status)) return false;
  const signals: string[] = [];
  collectErrorSignals(error, signals);
  return !signals.some((signal) => AUTH_ERROR_TYPE.test(signal) || AUTH_ERROR_CODE.test(signal));
};

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * ChatGPT / Codex tags that `applyModelExtendParams` serializes as
 * `reasoning_effort`. Searching the full registry would exact-match
 * `opus47Effort` (Anthropic `effort`) for low/medium/high/xhigh/max.
 */
export const CHATGPT_REASONING_EFFORT_CANDIDATES = [
  'gpt5ReasoningEffort',
  'gpt5_1ReasoningEffort',
  'gpt5_2ReasoningEffort',
  'gpt5_2ProReasoningEffort',
  'gpt5_6ReasoningEffort',
  'codexMaxReasoningEffort',
  'reasoningEffort',
] as const satisfies readonly EffortControlKey[];

/**
 * Map a live `supported_reasoning_levels` set onto the best candidate
 * effort-control tag. Exact set match wins (candidate order breaks ties).
 * Otherwise maximize coverage of live levels, preferring the smallest control
 * on ties. Future unknown levels must not remove the supported effort slider.
 */
export const matchEffortControlForLevels = (
  levels: readonly string[],
  candidates: readonly EffortControlKey[] = CHATGPT_REASONING_EFFORT_CANDIDATES,
): EffortControlKey | undefined => {
  const live = new Set(levels.filter((level) => level.length > 0));
  if (live.size === 0) return undefined;

  for (const key of candidates) {
    const registryLevels = EFFORT_CONTROL_REGISTRY[key].levels;
    if (registryLevels.length === live.size && registryLevels.every((level) => live.has(level))) {
      return key;
    }
  }

  let bestKey: EffortControlKey | undefined;
  let bestCoverage = 0;
  let bestSize = Number.POSITIVE_INFINITY;
  for (const key of candidates) {
    const registryLevels = EFFORT_CONTROL_REGISTRY[key].levels;
    const coverage = registryLevels.filter((level) => live.has(level)).length;
    if (coverage === 0 || coverage < bestCoverage) continue;
    if (coverage === bestCoverage && registryLevels.length >= bestSize) continue;
    bestKey = key;
    bestCoverage = coverage;
    bestSize = registryLevels.length;
  }
  return bestKey;
};

/** Observed Codex wire items are strings or `{ effort }`. */
const extractSupportedReasoningLevels = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;

  return raw.flatMap((item) => {
    if (typeof item === 'string' && item.length > 0) return [item];
    if (isRecord(item)) {
      const effort = asNonEmptyString(item.effort);
      return effort ? [effort] : [];
    }
    return [];
  });
};

const CATALOG_TTL = 60 * 60 * 1000;
const CATALOG_TIMEOUT = 10_000;
const MAX_CATALOGS = 64;
const catalogLog = debug('lobe-model-runtime:chatgpt:catalog');
interface CatalogEntry {
  reasoningLevels?: string[];
  supportedInApi?: boolean;
  useResponsesLite?: boolean;
}
interface CatalogCache {
  entries: Map<string, CatalogEntry>;
  expiresAt: number;
  inFlight?: Promise<unknown>;
}
// Runtime clients are recreated each turn. Only their account identity is client-local;
// catalog data and backoff are shared without retaining access tokens in cache keys.
const clientAccounts = new WeakMap<OpenAI, string>();
const catalogs = new Map<string, CatalogCache>();
const getCatalog = (client: OpenAI): CatalogCache => {
  const fingerprint = bytesToHex(sha256(new TextEncoder().encode(client.apiKey ?? ''))).slice(
    0,
    32,
  );
  const key = JSON.stringify([clientAccounts.get(client) ?? '', fingerprint, client.baseURL]);
  const now = Date.now();
  // Preserve this account's stale flags during refresh so failures can still use them.
  // Other expired, idle entries are removed lazily; insertion order supplies the LRU bound.
  for (const [storedKey, storedCache] of catalogs) {
    if (storedKey !== key && !storedCache.inFlight && storedCache.expiresAt <= now) {
      catalogs.delete(storedKey);
    }
  }
  let cache = catalogs.get(key);
  if (!cache) {
    cache = { entries: new Map(), expiresAt: 0 };
  }
  catalogs.delete(key);
  catalogs.set(key, cache);
  while (catalogs.size > MAX_CATALOGS) {
    const oldest = catalogs.keys().next().value;
    if (oldest !== undefined) catalogs.delete(oldest);
  }
  return cache;
};

const fetchCodexCatalog = (client: OpenAI): Promise<unknown> => {
  const cache = getCatalog(client);
  cache.inFlight ??= (async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const version = await resolveCodexClientVersion();
      // The SDK timeout only covers headers. Race the parsed APIPromise as well,
      // including when a response body or fetch shim ignores the abort signal.
      const payload: unknown = await Promise.race([
        client.get('/models', {
          maxRetries: 0,
          query: { client_version: version },
          signal: controller.signal,
          timeout: CATALOG_TIMEOUT,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('ChatGPT Codex catalog discovery timed out'));
          }, CATALOG_TIMEOUT);
        }),
      ]);
      if (!isRecord(payload) || (!Array.isArray(payload.models) && !Array.isArray(payload.data))) {
        throw new TypeError('ChatGPT Codex models payload was not a list');
      }
      const entries = new Map<string, CatalogEntry>();
      for (const raw of Array.isArray(payload.models)
        ? payload.models
        : (payload.data as unknown[])) {
        if (!isRecord(raw)) continue;
        const id = asNonEmptyString(raw.slug) ?? asNonEmptyString(raw.id);
        if (!id) continue;
        entries.set(id, {
          reasoningLevels: extractSupportedReasoningLevels(raw.supported_reasoning_levels),
          supportedInApi:
            typeof raw.supported_in_api === 'boolean' ? raw.supported_in_api : undefined,
          useResponsesLite:
            typeof raw.use_responses_lite === 'boolean' ? raw.use_responses_lite : undefined,
        });
      }
      cache.entries = entries;
      return payload;
    } finally {
      clearTimeout(timer);
      // Also back off after failures: chat must not retry a broken catalog on every turn.
      // Explicit admin models() calls can still retry immediately.
      cache.expiresAt = Date.now() + CATALOG_TTL;
      cache.inFlight = undefined;
    }
  })();
  return cache.inFlight;
};

const isResponsesLiteModel = async (
  client: OpenAI,
  model: string | undefined,
): Promise<boolean> => {
  if (!model) return false;
  const cache = getCatalog(client);
  if (cache.expiresAt <= Date.now()) {
    try {
      await fetchCodexCatalog(client);
    } catch {
      // Do not log SDK errors: they can contain account/request details.
      catalogLog('Catalog unavailable; using cached flags or static protocol fallback');
    }
  }
  return cache.entries.get(model)?.useResponsesLite ?? CHATGPT_RESPONSES_LITE_MODEL_IDS.has(model);
};

/**
 * Generalized `applyLiveGrokReasoningEffort`: drop every effort-control tag
 * (same family) and append the live-derived one. Non-effort tags stay.
 * No-op when live discovery found nothing.
 */
const applyLiveEffortExtendParam = (
  card: ChatModelCard,
  liveTag: EffortControlKey | undefined,
): ChatModelCard => {
  if (!liveTag) return card;

  const extendParams = [
    ...(card.settings?.extendParams ?? []).filter((param) => !isEffortControlKey(param)),
    liveTag,
  ];

  return {
    ...card,
    settings: {
      ...card.settings,
      extendParams,
    },
  };
};

/**
 * Live Codex payload is `{ models: [...] }` with `slug` / `display_name` /
 * `context_window` — not the OpenAI `{ data: [{ id }] }` shape.
 */
const mapCodexCatalog = (
  rawModels: unknown[],
): { cards: ProcessableModelCard[]; liveEffortById: Map<string, EffortControlKey> } => {
  const mapped: Array<ProcessableModelCard & { priority: number }> = [];
  const liveEffortById = new Map<string, EffortControlKey>();

  for (const raw of rawModels) {
    if (!isRecord(raw) || raw.visibility === 'hide') continue;
    // CLI-only models (e.g. Codex Spark) cannot be served by this API runtime.
    if (raw.supported_in_api === false) continue;
    const id = asNonEmptyString(raw.slug);
    if (!id) continue;

    const inputModalities = Array.isArray(raw.input_modalities) ? raw.input_modalities : undefined;
    const reasoningLevels = Array.isArray(raw.supported_reasoning_levels)
      ? raw.supported_reasoning_levels
      : undefined;
    const extractedLevels = extractSupportedReasoningLevels(raw.supported_reasoning_levels);
    const liveEffort = extractedLevels
      ? matchEffortControlForLevels(extractedLevels, CHATGPT_REASONING_EFFORT_CANDIDATES)
      : undefined;
    const displayName = asNonEmptyString(raw.display_name);
    const description = asNonEmptyString(raw.description);
    const contextWindowTokens = asFiniteNumber(raw.context_window);

    if (liveEffort) liveEffortById.set(id, liveEffort);

    mapped.push({
      id,
      functionCall: true,
      priority: asFiniteNumber(raw.priority) ?? Number.POSITIVE_INFINITY,
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      ...(inputModalities ? { vision: inputModalities.includes('image') } : {}),
      ...(reasoningLevels ? { reasoning: reasoningLevels.length > 0 } : {}),
      settings: {
        ...(typeof raw.use_responses_lite === 'boolean'
          ? { chatgptResponsesLite: raw.use_responses_lite }
          : {}),
        ...(liveEffort ? { extendParams: [liveEffort] } : {}),
      },
    });
  }

  mapped.sort((left, right) => left.priority - right.priority);
  return {
    cards: mapped.map(({ priority: _priority, ...card }) => card),
    liveEffortById,
  };
};

/**
 * Codex `/models` is chat-oriented and may omit image slugs (or list them
 * without `parameters`). Always union the static bank image cards by id so
 * admin sync / empty gated lists / 404 fallback all keep `gpt-image-2`.
 */
const unionChatGPTBankImageModels = async (
  processed: ChatModelCard[],
): Promise<ChatModelCard[]> => {
  const { chatgpt } = await import('model-bank');
  const bankImages = chatgpt.filter((model) => model.type === 'image');
  if (bankImages.length === 0) return processed;

  const seen = new Set(processed.map((card) => card.id));
  const missing = bankImages.filter((model) => !seen.has(model.id));
  if (missing.length === 0) return processed;

  const extra = await processModelList(missing, MODEL_LIST_CONFIGS.openai, 'chatgpt');
  return [...processed, ...extra];
};

const attachUpstreamAbilityProvenance = (
  cards: ChatModelCard[],
  rawModels: unknown[],
): ChatModelCard[] => {
  const reportedById = new Map<string, Record<string, boolean>>();
  for (const raw of rawModels) {
    if (!isRecord(raw) || typeof raw.id !== 'string') continue;
    const reported: Record<string, boolean> = {};
    for (const key of UPSTREAM_ABILITY_KEYS) {
      const value = raw[key];
      if (typeof value === 'boolean') reported[key] = value;
    }
    reportedById.set(raw.id, reported);
  }
  return cards.map((card) => {
    const reported = reportedById.get(card.id);
    if (!reported) return card;
    return { ...card, [UPSTREAM_REPORTED_ABILITIES]: reported };
  });
};

export const LobeChatGPTAI = createOpenAICompatibleRuntime<ChatGPTClientOptions>({
  baseURL: CHATGPT_CODEX_BASE_URL,
  chatCompletion: {
    forceFileBase64: true,
    forceImageBase64: true,
    inlineFile: { maxBytes: DEFAULT_FILE_INLINE_MAX_BYTES, ownOriginOnly: true },
    inlineImage: { maxBytes: DEFAULT_IMAGE_INLINE_MAX_BYTES, ownOriginOnly: true },
    useResponse: true,
  },
  createImage: createChatGPTImage,
  customClient: {
    createClient: ({ chatgptAccountId, ownOrigins: _ownOrigins, ...options }) => {
      const client = new OpenAI({
        ...options,
        defaultHeaders: {
          ...options.defaultHeaders,
          ...(chatgptAccountId && { 'ChatGPT-Account-Id': chatgptAccountId }),
          'User-Agent': USER_AGENT,
          'originator': 'lobehub',
          'session-id': crypto.randomUUID(),
          'version': CURRENT_VERSION,
        },
      });
      clientAccounts.set(client, chatgptAccountId ?? '');
      return client;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_CHATGPT_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_CHATGPT_RESPONSES === '1',
  },
  // Codex `/models` requires `client_version` and returns `{ models: [...] }`.
  // 404/405/501 (route missing) fall back to model-bank. Auth, rate-limit, and
  // transport failures must surface — those are the errors an operator can act on.
  models: async ({ client }) => {
    try {
      const payload = await fetchCodexCatalog(client);
      if (!isRecord(payload)) {
        throw new TypeError('ChatGPT Codex models payload was not a list');
      }

      // Live Codex shape. An empty `models` array is a real answer (old client
      // versions are gated to none) — do not fall back to model-bank.
      if (Array.isArray(payload.models)) {
        const { cards: modelList, liveEffortById } = mapCodexCatalog(payload.models);
        const processed = await processModelList(modelList, MODEL_LIST_CONFIGS.openai, 'chatgpt');
        return unionChatGPTBankImageModels(
          attachUpstreamAbilityProvenance(
            processed.map((card) => applyLiveEffortExtendParam(card, liveEffortById.get(card.id))),
            modelList,
          ),
        );
      }

      // Defensive: if the endpoint ever returns the public OpenAI list shape.
      if (Array.isArray(payload.data)) {
        const modelList = payload.data.filter(
          (item): item is ProcessableModelCard => isRecord(item) && typeof item.id === 'string',
        );
        return unionChatGPTBankImageModels(
          attachUpstreamAbilityProvenance(
            await processModelList(modelList, MODEL_LIST_CONFIGS.openai, 'chatgpt'),
            modelList,
          ),
        );
      }

      throw new TypeError('ChatGPT Codex models payload was not a list');
    } catch (error) {
      if (!(error instanceof TypeError) && !isCodexModelsEndpointMissing(error)) {
        throw error;
      }

      const { chatgpt } = await import('model-bank');

      return unionChatGPTBankImageModels(
        await processModelList(chatgpt, MODEL_LIST_CONFIGS.openai, 'chatgpt'),
      );
    }
  },
  provider: ModelProvider.ChatGPT,
  responses: {
    handlePayload: (payload) => {
      const handledPayload = openAIParams.responses?.handlePayload?.(payload) || payload;
      const { service_tier: _serviceTier, ...rest } = handledPayload;

      // The ChatGPT Codex backend manages output limits from the subscription
      // model catalog and rejects the public API's max_output_tokens field.
      return {
        ...rest,
        include: ['reasoning.encrypted_content'],
        max_tokens: undefined,
      };
    },
    prepareRequest: async (payload, _options, client) => {
      const { safety_identifier: _safetyIdentifier, ...subscriptionPayload } = payload;

      if (!(await isResponsesLiteModel(client, payload.model))) {
        return { payload: subscriptionPayload };
      }

      // Catalog-selected models use Responses Lite: tools move into the input
      // sequence, reasoning spans all turns, and the protocol header is required.
      const {
        input,
        instructions,
        parallel_tool_calls: _parallelToolCalls,
        reasoning,
        tool_choice: toolChoice,
        tools,
        ...rest
      } = subscriptionPayload;
      const additionalTools: ChatGPTAdditionalToolsInput = {
        role: 'developer',
        tools: tools || [],
        type: 'additional_tools',
      };
      const developerInstructions =
        instructions && typeof instructions === 'string'
          ? [
              {
                content: [{ text: instructions, type: 'input_text' as const }],
                role: 'developer' as const,
                type: 'message' as const,
              },
            ]
          : [];

      return {
        headers: { [CHATGPT_RESPONSES_LITE_HEADER]: 'true' },
        payload: {
          ...rest,
          input: [
            additionalTools as OpenAI.Responses.ResponseInputItem,
            ...developerInstructions,
            ...(Array.isArray(input) ? input : []),
          ],
          parallel_tool_calls: false,
          reasoning: { ...reasoning, context: 'all_turns' },
          tool_choice: toolChoice || 'auto',
        },
      };
    },
  },
});
