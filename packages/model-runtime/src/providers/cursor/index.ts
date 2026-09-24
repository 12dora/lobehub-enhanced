import type { ChatModelCard } from '@lobechat/types';
import createDebug from 'debug';
import { cursor as cursorChatModels, loadModels } from 'model-bank';

import { deriveCursorConversationId, isUuidV4 } from '../../browserProfile';
import type { LobeRuntimeAI } from '../../core/BaseAI';
import { CursorStream } from '../../core/streams/cursor';
import type { ChatMethodOptions, ChatStreamPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { debugStream } from '../../utils/debugStream';
import { EFFORT_CONTROL_REGISTRY } from '../../utils/effortControlRegistry';
import type { FamilyCardPools } from '../../utils/familyInherit';
import { inheritFamilyCard, stampFamilyInheritedKeys } from '../../utils/familyInherit';
import { StreamingResponse } from '../../utils/response';
import type { CursorListedModel, CursorModelGroup } from './modelGroups';
import { groupCursorModels, parseCursorModelId, resolveCursorModelId } from './modelGroups';
import { isCursorToolsActive } from './toolProtocol';
import type { CursorTurnBody } from './turn';
import { buildCursorTurn } from './turn';

export type { CursorListedModel, CursorModelGroup };
export { groupCursorModels, parseCursorModelId, resolveCursorModelId };

const log = createDebug('lobe-cursor:runtime');

export const CURSOR_TRANSPORT_ORIGIN = 'https://cursor.local';

/**
 * Private runtime→transport header (never leaves this process: the transport strips it
 * before spawning the CLI). Carries the stable per-conversation chat id that becomes
 * `cursor-agent --new-session-id <uuid>`, so every turn of one AIHub conversation is
 * one Cursor session instead of a brand-new chat per turn.
 */
export const CURSOR_CONVERSATION_HEADER = 'x-aihub-conversation';

/**
 * Private runtime→transport header (never leaves this process: the transport strips it
 * before spawning the CLI). Carries the stored-connection account id that keys the
 * per-connection CLI config-seed directory. Same shape as ChatGPT Web:
 * `platform:<providerId>[:rev:<n>]` / `user:<userId>:<workspace>:<providerId>`.
 */
export const CURSOR_ACCOUNT_HEADER = 'x-aihub-account';

const DEFAULT_PROVIDER = 'cursor';
const DEBUG_FLAG = 'DEBUG_CURSOR_CHAT_COMPLETION';
const TRANSPORT_UNAVAILABLE = 'Cursor Agent transport unavailable';
const CURSOR_CATALOG = new Map(cursorChatModels.map((model) => [model.id, model]));
/** Levels the CLI transport accepts. Anything else (ultra, no_think, …) is omitted. */
const CURSOR_TRANSPORT_EFFORTS: ReadonlySet<string> = new Set(
  EFFORT_CONTROL_REGISTRY.cursorReasoningEffort.levels,
);

interface CursorLocalOverride {
  contextWindowTokens?: number;
  description?: string;
  displayName: string;
  functionCall?: boolean;
  reasoning?: boolean;
  releasedAt?: string;
  search?: boolean;
  settings?: ChatModelCard['settings'];
  vision?: boolean;
}

/**
 * Ids that also exist on another provider. They stay out of the global bank
 * (an id-only fallback would attach the wrong card) and are applied only here.
 * Abilities match the previous Cursor `auto` bank card, including vision: false.
 */
const CURSOR_LOCAL_OVERRIDES: Readonly<Record<string, CursorLocalOverride>> = {
  auto: {
    contextWindowTokens: 200_000,
    description: 'Lets Cursor pick a model for each message.',
    displayName: 'Auto (Cursor)',
    functionCall: true,
    reasoning: false,
    releasedAt: '2026-08-11',
    search: true,
    settings: { searchImpl: 'params' },
    vision: false,
  },
};

const cursorTransportEffort = (
  value: ChatStreamPayload['reasoning_effort'],
): ChatStreamPayload['reasoning_effort'] | undefined =>
  value && CURSOR_TRANSPORT_EFFORTS.has(value) ? value : undefined;

const toCursorLocalOverrideCard = (id: string, override: CursorLocalOverride): ChatModelCard => ({
  contextWindowTokens: override.contextWindowTokens,
  description: override.description,
  displayName: override.displayName,
  enabled: false,
  functionCall: override.functionCall,
  id,
  reasoning: override.reasoning,
  releasedAt: override.releasedAt,
  search: override.search,
  settings: override.settings ? { ...override.settings } : undefined,
  type: 'chat',
  vision: override.vision,
});

type CursorCatalogEntry = (typeof cursorChatModels)[number];

/** Copy bank settings so a caller `push` cannot mutate the shared catalog array. */
const cloneCursorSettings = (
  settings: CursorCatalogEntry['settings'] | undefined,
): ChatModelCard['settings'] => {
  if (!settings) return undefined;
  const extendParams = settings.extendParams;
  const effortLevels = settings.effortLevels;
  return {
    ...settings,
    ...(Array.isArray(extendParams) ? { extendParams: [...extendParams] } : {}),
    ...(Array.isArray(effortLevels) ? { effortLevels: [...effortLevels] } : {}),
  };
};

/** Map a model-bank entry onto a chat card. Settings arrays are copied. */
export const toCursorKnownModelCard = (
  id: string,
  remoteName: string | undefined,
  known: Pick<CursorCatalogEntry, 'abilities' | 'contextWindowTokens' | 'displayName' | 'settings'>,
): ChatModelCard => {
  const displayName = known.displayName || remoteName || id;
  const reasoning = known.abilities?.reasoning;
  return {
    contextWindowTokens: known.contextWindowTokens,
    displayName,
    enabled: false,
    functionCall: known.abilities?.functionCall,
    id,
    reasoning,
    search: known.abilities?.search,
    settings: cloneCursorSettings(known.settings),
    type: 'chat',
    vision: known.abilities?.vision,
  };
};

/**
 * Stamp the live group's effort control onto a card without marking those keys
 * family-inherited. Sync persists unstamped keys and would otherwise drop them
 * on a row that already has metadata.
 */
const applyCursorEffort = (card: ChatModelCard, group: CursorModelGroup): ChatModelCard => {
  const extendParams = [...(card.settings?.extendParams ?? [])];
  if (!extendParams.includes('cursorReasoningEffort')) {
    extendParams.push('cursorReasoningEffort');
  }
  card.settings = {
    ...card.settings,
    defaultEffortLevel: group.defaultLevel,
    effortLevels: [...group.levels],
    extendParams,
  };
  return card;
};

/** One concrete id. A single level does not grow an effort selector. */
const toCursorListedCard = (
  model: { id: string; name?: string },
  pools: FamilyCardPools,
): ChatModelCard => {
  const id = model.id;
  const known = CURSOR_CATALOG.get(id);
  if (known) return toCursorKnownModelCard(id, model.name, known);
  const local = CURSOR_LOCAL_OVERRIDES[id];
  if (local) return toCursorLocalOverrideCard(id, local);

  const displayName = model.name || id;
  const contextWindowTokens = /1m/i.test(displayName) ? 1_000_000 : undefined;
  const base: ChatModelCard = {
    displayName,
    enabled: false,
    id,
    reasoning: undefined,
    type: 'chat',
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
  };
  const inherited = inheritFamilyCard(id, pools, {
    extendParams: false,
    includeCursorDonors: true,
    type: 'chat',
  });
  if (!inherited) return base;

  const abilities = inherited.abilities;
  const abilityKeys: string[] = [];
  if (typeof abilities?.files === 'boolean') {
    base.files = abilities.files;
    abilityKeys.push('files');
  }
  if (typeof abilities?.functionCall === 'boolean') {
    base.functionCall = abilities.functionCall;
    abilityKeys.push('functionCall');
  }
  if (typeof abilities?.reasoning === 'boolean') {
    base.reasoning = abilities.reasoning;
    abilityKeys.push('reasoning');
  }
  if (typeof abilities?.search === 'boolean') {
    base.search = abilities.search;
    abilityKeys.push('search');
  }
  if (typeof abilities?.vision === 'boolean') {
    base.vision = abilities.vision;
    abilityKeys.push('vision');
  }
  if (typeof abilities?.imageOutput === 'boolean') {
    base.imageOutput = abilities.imageOutput;
    abilityKeys.push('imageOutput');
  }
  if (typeof abilities?.video === 'boolean') {
    base.video = abilities.video;
    abilityKeys.push('video');
  }
  const settings = cloneCursorSettings(inherited.settings);
  const settingKeys = settings ? Object.keys(settings) : [];
  if (settings) base.settings = settings;
  stampFamilyInheritedKeys(base, { abilities: abilityKeys, settings: settingKeys });
  return base;
};

const toCursorGroupCard = (group: CursorModelGroup, pools: FamilyCardPools): ChatModelCard => {
  const known = CURSOR_CATALOG.get(group.baseId);
  const card = known
    ? toCursorKnownModelCard(group.baseId, group.displayName, known)
    : toCursorListedCard({ id: group.baseId, name: group.displayName }, pools);
  return applyCursorEffort(card, group);
};

export interface LobeCursorAIParams {
  /**
   * Stored-connection account id from the server/runtime seam. Hop-by-hop only —
   * sent as {@link CURSOR_ACCOUNT_HEADER} and stripped by the transport.
   */
  accountId?: string;
  apiKey?: string;
  baseURL?: string;
  /** Stable per-conversation key supplied by the server/runtime seam. */
  conversationKey?: string;
  fetch?: typeof fetch;
  id?: string;
  /** Installation-wide UUIDv4; scopes the derived chat id to this deployment. */
  installationId?: string;
}

interface CursorModelsResponse {
  models?: Array<{ id?: string; name?: string }>;
}

interface CursorErrorBody {
  error?: { code?: string; message?: string };
}

const isAbortError = (error: unknown): boolean =>
  (error as { name?: unknown } | undefined)?.name === 'AbortError';

const isRuntimeError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'errorType' in error;

export class LobeCursorAI implements LobeRuntimeAI {
  baseURL: string;
  provider: string;

  private readonly accountId?: string;
  private readonly apiKey?: string;
  private readonly conversationId?: string;
  private readonly fetchImpl: typeof fetch;

  constructor({
    accountId,
    apiKey,
    baseURL,
    conversationKey,
    fetch: customFetch,
    id,
    installationId,
  }: LobeCursorAIParams = {}) {
    this.accountId =
      typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
    this.apiKey = apiKey;
    this.baseURL = (baseURL ?? CURSOR_TRANSPORT_ORIGIN).replace(/\/+$/, '');
    this.provider = id || DEFAULT_PROVIDER;
    this.fetchImpl = customFetch ?? ((input, init) => globalThis.fetch(input, init));
    // Both halves are required: without the installation id two deployments sharing one
    // Cursor account could derive the same chat id, and without a conversation key there
    // is no conversation to be stable across. Missing or malformed → no header, and the
    // CLI mints its own id exactly as before.
    this.conversationId =
      installationId && isUuidV4(installationId) && conversationKey
        ? deriveCursorConversationId(installationId, conversationKey)
        : undefined;
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions): Promise<Response> {
    const inputStartAt = Date.now();
    const turn = buildCursorTurn({
      messages: payload.messages,
      model: payload.model,
      tool_choice: payload.tool_choice,
      tools: payload.tools,
    });
    const effort = cursorTransportEffort(payload.reasoning_effort);
    const body: CursorTurnBody = effort ? { ...turn, effort } : turn;

    const response = await this.request(`${this.baseURL}/v1/turn`, {
      body: JSON.stringify({
        ...body,
        ...(payload.enabledSearch ? { enabledSearch: true } : {}),
      }),
      headers: {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
        ...(this.conversationId ? { [CURSOR_CONVERSATION_HEADER]: this.conversationId } : {}),
      },
      method: 'POST',
      signal: options?.signal,
    });

    if (!response.body) {
      throw this.toRuntimeError(
        AgentRuntimeErrorType.ProviderBizError,
        'Cursor Agent returned an empty stream',
      );
    }

    let responseBody = response.body;
    if (process.env[DEBUG_FLAG] === '1') {
      const [prod, useForDebug] = responseBody.tee();
      debugStream(useForDebug).catch(console.error);
      responseBody = prod;
    }

    const stream = CursorStream(responseBody, {
      callbacks: options?.callback,
      inputStartAt,
      model: payload.model,
      parseToolCalls: isCursorToolsActive(payload.tools, payload.tool_choice),
      provider: this.provider,
    });

    return StreamingResponse(stream, { headers: options?.headers });
  }

  async models(): Promise<ChatModelCard[]> {
    const response = await this.request(`${this.baseURL}/v1/models`, {
      headers: { Accept: 'application/json' },
      method: 'GET',
    });

    let json: CursorModelsResponse;
    try {
      json = (await response.json()) as CursorModelsResponse;
    } catch {
      throw this.toRuntimeError(
        AgentRuntimeErrorType.ProviderBizError,
        'Cursor Agent models response was not JSON',
      );
    }

    const models = Array.isArray(json.models) ? json.models : [];
    const listed = models.filter(
      (model): model is { id: string; name?: string } =>
        typeof model?.id === 'string' && model.id.length > 0,
    );
    const { groups } = groupCursorModels(listed);
    const groupByBase = new Map(groups.map((group) => [group.baseId, group]));
    const needsInheritance = listed.some((model) => {
      const group = groupByBase.get(parseCursorModelId(model.id).baseId);
      const id = group ? group.baseId : model.id;
      return !CURSOR_CATALOG.has(id) && !Object.hasOwn(CURSOR_LOCAL_OVERRIDES, id);
    });
    const globalCards = needsInheritance ? await loadModels() : [];
    const providerCards = needsInheritance ? [...CURSOR_CATALOG.values()] : [];
    const pools = { globalCards, providerCards };

    const cards: ChatModelCard[] = [];
    const emitted = new Set<string>();
    for (const model of listed) {
      const group = groupByBase.get(parseCursorModelId(model.id).baseId);
      if (group) {
        if (emitted.has(group.baseId)) continue;
        emitted.add(group.baseId);
        cards.push(toCursorGroupCard(group, pools));
        continue;
      }
      cards.push(toCursorListedCard(model, pools));
    }
    return cards;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(this.accountId ? { [CURSOR_ACCOUNT_HEADER]: this.accountId } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      if (isAbortError(error) || isRuntimeError(error)) throw error;
      log('transport request failed: %s', error instanceof Error ? error.name : typeof error);
      throw this.toRuntimeError(AgentRuntimeErrorType.ProviderBizError, TRANSPORT_UNAVAILABLE);
    }

    if (!response.ok) throw await this.toHttpError(response);
    return response;
  }

  private async toHttpError(response: Response) {
    const text = await response.text().catch(() => '');
    let body: CursorErrorBody = {};
    if (text) {
      try {
        body = JSON.parse(text) as CursorErrorBody;
      } catch {
        body = { error: { message: text.slice(0, 500) } };
      }
    }

    const code = body.error?.code;
    const message = body.error?.message || `Cursor Agent request failed (${response.status})`;
    const errorType =
      code === 'unauthorized' || response.status === 401
        ? AgentRuntimeErrorType.OAuthAuthorizationExpired
        : AgentRuntimeErrorType.ProviderBizError;

    throw this.toRuntimeError(errorType, message, { code, status: response.status });
  }

  private toRuntimeError(
    errorType: (typeof AgentRuntimeErrorType)[keyof typeof AgentRuntimeErrorType],
    message: string,
    error: Record<string, unknown> = {},
  ) {
    return AgentRuntimeError.chat({
      error: { message, ...error },
      errorType,
      message,
      provider: this.provider,
    });
  }
}
