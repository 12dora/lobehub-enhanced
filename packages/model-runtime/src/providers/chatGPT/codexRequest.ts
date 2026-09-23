import { DEFAULT_FILE_INLINE_MAX_BYTES, DEFAULT_IMAGE_INLINE_MAX_BYTES } from '@lobechat/utils';
import { ModelProvider } from 'model-bank';
import OpenAI, { type APIError } from 'openai';

import { convertOpenAIResponseInputs } from '../../core/contextBuilders/openai';
import { convertOpenAIResponseUsage } from '../../core/usageConverters';
import type { GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { getModelPricing } from '../../utils/getModelPricing';
import {
  isGPT5ProResponsesModel,
  supportsGPT5ResponsesReasoningEffortNone,
} from '../openai/openaiModelId';

/**
 * Full JSON the Codex gateway returned. The OpenAI SDK only keeps `body.error`,
 * so a FastAPI `{ detail }` 400 becomes "status code (no body)" unless we stash it.
 */
export const UPSTREAM_ERROR_BODY = Symbol.for('lobehub.chatgpt.upstreamBody');

const UPSTREAM_BODY_LIMIT = 500;

const SECRET_TEXT = /bearer\s+[\w.~+/-]{8,}|\bsk-[\w-]{8,}/gi;
const LONG_OPAQUE_TOKEN = /\b[\w\-.]{24,}\b/g;
const SENSITIVE_KEY = /api[-_]?key|token|secret|password|authorization|cookie|session/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const redactSensitiveFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveFields(item));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : redactSensitiveFields(item),
    ]),
  );
};

/**
 * Clip upstream text for logs and thrown errors. Sensitive keyed fields, bearer
 * strings, `sk-` tokens, and long opaque tokens are replaced first.
 */
export const clipUpstreamText = (text: string): string => {
  let redacted = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      redacted = JSON.stringify(redactSensitiveFields(parsed));
    }
  } catch {
    // Plain text still goes through the token patterns below.
  }
  redacted = redacted
    .replaceAll(SECRET_TEXT, '[redacted]')
    .replaceAll(LONG_OPAQUE_TOKEN, '[redacted]');
  return redacted.length <= UPSTREAM_BODY_LIMIT ? redacted : redacted.slice(0, UPSTREAM_BODY_LIMIT);
};

const unionIncludesNull = (branch: unknown): boolean =>
  isRecord(branch) &&
  (branch.type === 'null' || (Array.isArray(branch.type) && branch.type.includes('null')));

const schemaAllowsNull = (schema: Record<string, unknown>): boolean => {
  if (schema.type === 'null') return true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  const unions = [
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
  ];
  return unions.some((branch) => unionIncludesNull(branch));
};

/**
 * Strict mode has no optional properties. Absence stays representable by
 * accepting null, which callers drop after parsing.
 */
const makeNullable = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (schemaAllowsNull(schema)) return schema;
  if (typeof schema.type === 'string') {
    const next: Record<string, unknown> = { ...schema, type: [schema.type, 'null'] };
    if (Array.isArray(schema.enum) && !schema.enum.includes(null)) {
      next.enum = [...schema.enum, null];
    }
    return next;
  }
  if (Array.isArray(schema.type)) return { ...schema, type: [...schema.type, 'null'] };
  if (Array.isArray(schema.anyOf)) {
    return { ...schema, anyOf: [...schema.anyOf, { type: 'null' }] };
  }
  if (Array.isArray(schema.oneOf)) {
    const { oneOf: _oneOf, ...rest } = schema;
    return { ...rest, anyOf: [...schema.oneOf, { type: 'null' }] };
  }
  return { anyOf: [schema, { type: 'null' }] };
};

const normalizeSchemaBranch = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((item) => normalizeStrictJsonSchema(item))
    : normalizeStrictJsonSchema(value);

/**
 * Codex rejects strict json_schema unless every object lists all of its
 * properties in `required` and sets `additionalProperties: false`.
 * Properties that were optional become a null union so the model can omit them.
 */
export const normalizeStrictJsonSchema = (schema: unknown): unknown => {
  if (!isRecord(schema)) return schema;

  const next: Record<string, unknown> = { ...schema };
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(schema[key])) {
      next[key] = (schema[key] as unknown[]).map((item) => normalizeStrictJsonSchema(item));
    }
  }
  if (schema.items) next.items = normalizeSchemaBranch(schema.items);
  if (isRecord(schema.$defs)) {
    next.$defs = Object.fromEntries(
      Object.entries(schema.$defs).map(([key, value]) => [key, normalizeStrictJsonSchema(value)]),
    );
  }

  if (!isRecord(schema.properties)) return next;

  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([key, value]) => [
      key,
      normalizeStrictJsonSchema(value),
    ]),
  );
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const missing = Object.keys(properties).filter((key) => !required.includes(key));
  for (const key of missing) {
    const value = properties[key];
    if (isRecord(value)) properties[key] = makeNullable(value);
  }

  next.properties = properties;
  next.type = schema.type ?? 'object';
  next.additionalProperties = false;
  next.required = [...required, ...missing];
  return next;
};

/**
 * Drop nulls that stand in for properties the original schema left optional.
 * Nested objects and arrays are walked the same way. Required nulls stay.
 */
export const omitNullOptionalProperties = (value: unknown, schema: unknown): unknown => {
  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema) ? schema.items : undefined;
    if (Array.isArray(itemSchema)) {
      return value.map((item, index) => omitNullOptionalProperties(item, itemSchema[index]));
    }
    return value.map((item) => omitNullOptionalProperties(item, itemSchema));
  }
  if (!isRecord(value) || !isRecord(schema) || !isRecord(schema.properties)) return value;

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [],
  );
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!required.has(key) && item === null) continue;
    next[key] = omitNullOptionalProperties(item, schema.properties[key]);
  }
  return next;
};

const UNSUPPORTED_CODEX_FIELDS = [
  'frequency_penalty',
  'logprobs',
  'max_output_tokens',
  'max_tokens',
  'presence_penalty',
  'safety_identifier',
  'service_tier',
  'temperature',
  'top_logprobs',
  'top_p',
  'user',
] as const;

/**
 * Fields chat already sends and Codex accepts. `store` defaults to true and
 * `stream` defaults to false; the Codex backend 400s on either default.
 * Sampling params are rejected as unsupported.
 */
export const applyCodexResponsesContract = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...payload };
  for (const field of UNSUPPORTED_CODEX_FIELDS) delete next[field];

  const reasoning = isRecord(next.reasoning) ? next.reasoning : {};
  next.include = ['reasoning.encrypted_content'];
  next.reasoning = { ...reasoning, summary: reasoning.summary ?? 'auto' };
  next.store = false;
  next.stream = true;
  return next;
};

const reasoningForGenerateObject = (
  payload: GenerateObjectPayload,
): Record<string, unknown> | undefined => {
  const { model, reasoning_effort: effort, thinking } = payload;
  if (isGPT5ProResponsesModel(model)) {
    return effort && effort !== 'max' ? { effort: 'high' } : undefined;
  }
  if (thinking?.type === 'disabled') {
    return supportsGPT5ResponsesReasoningEffortNone(model) ? { effort: 'none' } : undefined;
  }
  if (effort && effort !== 'max') return { effort };
  return undefined;
};

const promptCacheKey = (model: string, user?: string): string | undefined => {
  if (!user) return undefined;
  if (model.startsWith('gpt-') || /^o\d/.test(model) || model === 'chat-latest') {
    return `lobe:${user}:${model}`;
  }
  return undefined;
};

const toResponseTool = (tool: {
  function?: { description?: string; name?: string; parameters?: unknown };
  type?: string;
}): Record<string, unknown> => ({
  type: tool.type,
  ...tool.function,
});

export interface PreparedResponsesRequest {
  headers?: Record<string, string>;
  payload: any;
}

export type PrepareCodexResponses = (
  payload: Record<string, unknown>,
  options: unknown,
  client: OpenAI,
) => Promise<PreparedResponsesRequest>;

const readStatus = (error: unknown): number | undefined => {
  if (!isRecord(error)) return undefined;
  if (typeof error.status === 'number') return error.status;
  if (typeof error.statusCode === 'number') return error.statusCode;
  return undefined;
};

const readUpstreamBody = (error: unknown): unknown => {
  if (!error || typeof error !== 'object') return undefined;
  if (!(UPSTREAM_ERROR_BODY in error)) return undefined;
  return (error as Record<symbol, unknown>)[UPSTREAM_ERROR_BODY];
};

/**
 * Codex often returns `{ detail }` instead of `{ error: { message } }`. The SDK
 * then reports "400 status code (no body)". Keep the parsed JSON on the error.
 */
export class ChatGPTCodexOpenAI extends OpenAI {
  protected override makeStatusError(
    status: number,
    error: object,
    message: string | undefined,
    headers: Headers,
  ): APIError {
    const record =
      error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
    const nested = record && 'error' in record ? record.error : undefined;
    const nextMessage =
      record && (nested === undefined || nested === null)
        ? clipUpstreamText(JSON.stringify(record))
        : message;
    const apiError = super.makeStatusError(status, error, nextMessage, headers);
    if (record) {
      Object.defineProperty(apiError, UPSTREAM_ERROR_BODY, { enumerable: false, value: record });
    }
    return apiError;
  }
}

export class ChatGPTUpstreamError extends Error {
  readonly model: string;
  readonly provider = 'chatgpt';
  readonly status?: number;

  constructor(model: string, status: number | undefined, detail: string, cause?: unknown) {
    super(
      `[chatgpt/${model}] ${status ?? 'error'}: ${detail}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'ChatGPTUpstreamError';
    this.model = model;
    this.status = status;
  }
}

const looksLikeUpstreamFailure = (error: unknown): boolean => {
  if (error instanceof ChatGPTUpstreamError) return true;
  if (readStatus(error) !== undefined) return true;
  if (readUpstreamBody(error) !== undefined) return true;
  return error instanceof Error && /^\d{3}\s/.test(error.message);
};

/**
 * Rebuild a Codex/OpenAI failure so logs keep provider, model, and the response
 * body (500 chars, secrets stripped). Non-HTTP errors are returned unchanged.
 */
export const describeChatGPTUpstreamError = (error: unknown, model: string): unknown => {
  if (!looksLikeUpstreamFailure(error) || error instanceof ChatGPTUpstreamError) return error;

  const messageStatus = error instanceof Error ? /^(\d{3})\s/.exec(error.message)?.[1] : undefined;
  const status = readStatus(error) ?? (messageStatus ? Number(messageStatus) : undefined);
  const rawBody = readUpstreamBody(error);
  let detail = rawBody !== undefined ? clipUpstreamText(JSON.stringify(rawBody)) : '';
  if (!detail && error instanceof Error) detail = clipUpstreamText(error.message);
  if (!detail) detail = 'status code (no body)';
  if (status !== undefined && detail.startsWith(`${status} `)) {
    detail = detail.slice(`${status} `.length);
  }
  return new ChatGPTUpstreamError(model, status, detail, error);
};

interface CollectedResponse {
  functionCalls: Array<{ arguments?: unknown; name?: string; type?: string }>;
  outputText: string;
  usage?: OpenAI.Responses.ResponseUsage;
}

const isEventStream = (value: unknown): value is AsyncIterable<unknown> =>
  !!value &&
  typeof value === 'object' &&
  Symbol.asyncIterator in value &&
  !('output_text' in value) &&
  !('output' in value);

/** HTTP 4xx on the event itself. A failed generation with no status is not a 400. */
const clientErrorStatus = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (!isRecord(value)) continue;
    const status = typeof value.status === 'number' ? value.status : value.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) return status;
  }
  return undefined;
};

const readErrorRecord = (event: Record<string, unknown>): Record<string, unknown> | undefined => {
  const response = isRecord(event.response) ? event.response : undefined;
  if (isRecord(response?.error)) return response.error;
  if (isRecord(event.error)) return event.error;
  return undefined;
};

const failedDetail = (event: Record<string, unknown>): { detail: string; status?: number } => {
  const response = isRecord(event.response) ? event.response : undefined;
  const error = readErrorRecord(event);
  const message =
    typeof error?.message === 'string' && error.message.trim() ? error.message : 'response failed';
  const code =
    typeof error?.code === 'string' || typeof error?.code === 'number'
      ? String(error.code)
      : undefined;
  return {
    detail: code ? `response failed: ${message} (${code})` : `response failed: ${message}`,
    status: clientErrorStatus(error, response, event),
  };
};

const incompleteDetail = (event: Record<string, unknown>): { detail: string; status?: number } => {
  const response = isRecord(event.response) ? event.response : undefined;
  const details = isRecord(response?.incomplete_details)
    ? response.incomplete_details
    : isRecord(event.incomplete_details)
      ? event.incomplete_details
      : undefined;
  const reason =
    typeof details?.reason === 'string' && details.reason.trim() ? details.reason : 'unknown';
  return {
    detail: `response incomplete: ${reason}`,
    status: clientErrorStatus(response, event),
  };
};

const terminalFailure = (
  model: string,
  failure: { detail: string; status?: number },
): ChatGPTUpstreamError => new ChatGPTUpstreamError(model, failure.status, failure.detail);

const readCompletedPayload = (
  response: Record<string, unknown> | undefined,
): Pick<CollectedResponse, 'functionCalls' | 'outputText' | 'usage'> => {
  const functionCalls = Array.isArray(response?.output)
    ? response.output.filter(
        (item): item is CollectedResponse['functionCalls'][number] =>
          isRecord(item) && item.type === 'function_call',
      )
    : [];
  return {
    functionCalls,
    outputText: typeof response?.output_text === 'string' ? response.output_text : '',
    usage:
      response?.usage && typeof response.usage === 'object'
        ? (response.usage as OpenAI.Responses.ResponseUsage)
        : undefined,
  };
};

/**
 * A Codex stream is success only after `response.completed`. `response.failed`,
 * `response.incomplete`, and a stream that closes early are errors. The error
 * carries an HTTP status only when the event itself is 4xx, so the caller's
 * 400 backoff does not treat a generation failure as a bad request.
 */
const collectCodexResponse = async (result: unknown, model: string): Promise<CollectedResponse> => {
  if (isEventStream(result)) {
    let completedText = '';
    let functionCalls: CollectedResponse['functionCalls'] = [];
    let usage: OpenAI.Responses.ResponseUsage | undefined;
    let completed = false;
    let failure: { detail: string; status?: number } | undefined;

    for await (const event of result) {
      if (!isRecord(event)) continue;
      if (event.type === 'response.failed') {
        failure = failedDetail(event);
        continue;
      }
      if (event.type === 'response.incomplete') {
        failure = incompleteDetail(event);
        continue;
      }
      if (event.type !== 'response.completed') continue;
      completed = true;
      const payload = readCompletedPayload(isRecord(event.response) ? event.response : undefined);
      if (payload.outputText) completedText = payload.outputText;
      functionCalls = payload.functionCalls;
      usage = payload.usage ?? usage;
    }

    if (failure) throw terminalFailure(model, failure);
    if (!completed) {
      throw new ChatGPTUpstreamError(model, undefined, 'stream ended without response.completed');
    }
    return { functionCalls, outputText: completedText, usage };
  }

  const response = isRecord(result) ? result : {};
  if (response.status === 'failed') {
    throw terminalFailure(model, failedDetail({ response, type: 'response.failed' }));
  }
  if (response.status === 'incomplete') {
    throw terminalFailure(model, incompleteDetail({ response, type: 'response.incomplete' }));
  }
  const payload = readCompletedPayload(response);
  return payload;
};

const reportUsage = async (
  model: string,
  usage: OpenAI.Responses.ResponseUsage | undefined,
  options: GenerateObjectOptions | undefined,
) => {
  if (!usage || !options?.onUsage) return;
  try {
    const pricing = await getModelPricing(model, ModelProvider.ChatGPT, options.pricingContext);
    await options.onUsage(
      convertOpenAIResponseUsage(usage, { model, pricing, provider: ModelProvider.ChatGPT }),
    );
  } catch {
    // A pricing lookup must not discard a completed structured result.
  }
};

const parseJsonObject = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    console.error('parse json error:', text);
    return undefined;
  }
};

/**
 * Same Codex request chat uses (`store: false`, `stream: true`, encrypted
 * reasoning, sampling params stripped), then collect the final JSON.
 * Chat Completions does not exist on this backend.
 */
export const generateChatGPTObject = async (params: {
  client: OpenAI;
  options?: GenerateObjectOptions;
  payload: GenerateObjectPayload;
  prepare: PrepareCodexResponses;
}): Promise<unknown> => {
  const { client, options, payload, prepare } = params;
  const { messages, model, schema, tools } = payload;
  if (!tools && !schema) throw new Error('tools or schema is required');

  const input = await convertOpenAIResponseInputs(messages as never, {
    forceFileBase64: true,
    forceImageBase64: true,
    inlineFile: { maxBytes: DEFAULT_FILE_INLINE_MAX_BYTES, ownOriginOnly: true },
    inlineImage: { maxBytes: DEFAULT_IMAGE_INLINE_MAX_BYTES, ownOriginOnly: true },
    strictToolPairing: true,
  });

  const reasoning = reasoningForGenerateObject(payload);
  const cacheKey = promptCacheKey(model, options?.user);
  const request = applyCodexResponsesContract({
    input,
    model,
    ...(reasoning ? { reasoning } : {}),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    ...(tools
      ? {
          tool_choice: 'required',
          tools: tools.map((tool) => toResponseTool(tool)),
        }
      : {
          text: {
            format: {
              ...schema,
              schema: normalizeStrictJsonSchema(schema!.schema),
              strict: true,
              type: 'json_schema',
            },
          },
        }),
  });

  const prepared = await prepare(request, undefined, client);
  const headers = {
    ...(options?.headers as Record<string, string> | undefined),
    ...prepared.headers,
  };
  const created: unknown = await client.responses.create(prepared.payload as never, {
    headers,
    signal: options?.signal,
  });
  const collected = await collectCodexResponse(created, model);
  await reportUsage(model, collected.usage, options);

  if (tools) {
    try {
      return collected.functionCalls.map((item) => ({
        arguments: typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments,
        name: item.name,
      }));
    } catch (error) {
      console.error('parse tool call arguments error:', error);
      return undefined;
    }
  }

  if (!collected.outputText) return undefined;
  const parsed = parseJsonObject(collected.outputText);
  if (parsed === undefined) return undefined;
  return omitNullOptionalProperties(parsed, schema?.schema);
};
