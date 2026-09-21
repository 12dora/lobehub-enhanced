import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import type { ChatMethodOptions } from '../../types';

const retryLog = debug('lobe-supergrok:retry');

export const NETWORK_RETRY_DELAY_MS = 800;
/**
 * While frames are withheld (nothing meaningful emitted yet) the downstream connection would be
 * silent; gateways in front of the app may drop idle streams. SSE comment lines are ignored by parsers.
 */
export const HOLD_KEEPALIVE_INTERVAL_MS = 15_000;
const KEEPALIVE_FRAME = new TextEncoder().encode(': keepalive\n\n');

const NETWORK_ERROR_PATTERN =
  /ECONNRESET|terminated|socket hang up|UND_ERR_SOCKET|other side closed|fetch failed|EPIPE|ETIMEDOUT/i;

/** Protocol events that would duplicate visible output if the turn were retried. */
const MEANINGFUL_SSE_EVENTS = new Set([
  'base64_image',
  'content_part',
  'file',
  'flagged_reasoning_signature',
  'grounding',
  'reasoning',
  'reasoning_part',
  'reasoning_response_item',
  'reasoning_signature',
  'text',
  'tool_calls',
]);

const throwAborted: () => never = () => {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  throw error;
};

const collectErrorText = (value: unknown, visited = new WeakSet<object>(), depth = 0): string[] => {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'string') return value ? [value] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object' || visited.has(value)) return [];
  visited.add(value);

  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code;
    return [
      value.name,
      value.message,
      ...(typeof code === 'string' ? [code] : []),
      ...collectErrorText(value.cause, visited, depth + 1),
    ].filter((text) => text.length > 0);
  }

  if (!isRecord(value)) return [];
  return [
    ...collectErrorText(value.name, visited, depth + 1),
    ...collectErrorText(value.message, visited, depth + 1),
    ...collectErrorText(value.code, visited, depth + 1),
    ...collectErrorText(value.causeMessage, visited, depth + 1),
    ...collectErrorText(value.causeName, visited, depth + 1),
    ...collectErrorText(value.cause, visited, depth + 1),
    ...collectErrorText(value.error, visited, depth + 1),
    ...collectErrorText(value.body, visited, depth + 1),
    ...collectErrorText(value.errorType, visited, depth + 1),
  ];
};

const readHttpStatus = (
  value: unknown,
  visited: WeakSet<object>,
  depth = 0,
): number | undefined => {
  if (depth > 6 || !isRecord(value) || visited.has(value)) return undefined;
  visited.add(value);

  if (typeof value.status === 'number' && value.status >= 100 && value.status < 600) {
    return value.status;
  }
  if (typeof value.statusCode === 'number' && value.statusCode >= 100 && value.statusCode < 600) {
    return value.statusCode;
  }

  return (
    readHttpStatus(value.error, visited, depth + 1) ??
    readHttpStatus(value.body, visited, depth + 1) ??
    readHttpStatus(value.cause, visited, depth + 1)
  );
};

const isAbortFailure = (error: unknown, signal?: AbortSignal): boolean => {
  if (signal?.aborted) return true;

  return collectErrorText(error).some(
    (text) => text === 'AbortError' || text.includes('aborted') || text.includes('cancelled'),
  );
};

const isHttp4xxFailure = (error: unknown): boolean => {
  const status = readHttpStatus(error, new WeakSet());
  return status !== undefined && status >= 400 && status < 500;
};

const isNetworkFailure = (error: unknown): boolean =>
  collectErrorText(error).some((text) => NETWORK_ERROR_PATTERN.test(text));

const shouldRetryNetworkFailure = (error: unknown, signal?: AbortSignal): boolean => {
  if (isAbortFailure(error, signal)) return false;
  if (isHttp4xxFailure(error)) return false;
  return isNetworkFailure(error);
};

const waitForRetryDelay = async (signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) throwAborted();

  await new Promise<void>((resolve, reject) => {
    const handle: { timer?: ReturnType<typeof setTimeout> } = {};
    const onAbort = () => {
      if (handle.timer !== undefined) clearTimeout(handle.timer);
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    handle.timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, NETWORK_RETRY_DELAY_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const splitCompleteSseFrames = (buffer: string): { frames: string[]; rest: string } => {
  const separator = '\n\n';
  const last = buffer.lastIndexOf(separator);
  if (last === -1) return { frames: [], rest: buffer };

  const complete = buffer.slice(0, last);
  const rest = buffer.slice(last + separator.length);
  return {
    frames: complete.split(separator).filter((frame) => frame.trim().length > 0),
    rest,
  };
};

const readSseField = (frame: string, field: 'event' | 'data'): string | undefined => {
  const prefix = `${field}:`;
  for (const line of frame.split('\n')) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return undefined;
};

const parseJsonValue = (text: string | undefined): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const sseErrorIsRetryable = (frame: string, signal?: AbortSignal): boolean => {
  const data = readSseField(frame, 'data');
  return shouldRetryNetworkFailure(parseJsonValue(data) ?? data, signal);
};

const toStreamError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Stream failed');
};

const pumpChatStream = async ({
  allowRetry,
  body,
  controller,
  signal,
}: {
  allowRetry: boolean;
  body: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  signal?: AbortSignal;
}): Promise<'close' | 'errored' | 'retry'> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let held: Uint8Array[] = [];
  let buffer = '';
  let committed = false;

  const flushHeld = () => {
    for (const chunk of held) controller.enqueue(chunk);
    held = [];
  };

  const keepalive = setInterval(() => {
    if (committed) return;
    try {
      controller.enqueue(KEEPALIVE_FRAME);
    } catch {
      // Stream already closed or errored; nothing to keep alive.
    }
  }, HOLD_KEEPALIVE_INTERVAL_MS);
  if (typeof keepalive === 'object' && keepalive !== null && 'unref' in keepalive)
    keepalive.unref();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        flushHeld();
        return 'close';
      }
      if (!value) continue;

      if (committed) {
        controller.enqueue(value);
        continue;
      }

      held = [...held, value];
      buffer += decoder.decode(value, { stream: true });

      const { frames, rest } = splitCompleteSseFrames(buffer.replaceAll('\r\n', '\n'));
      buffer = rest;

      const sawMeaningful = frames.some((frame) => {
        const type = readSseField(frame, 'event');
        return Boolean(type && MEANINGFUL_SSE_EVENTS.has(type));
      });
      const errorFrame = frames.find((frame) => readSseField(frame, 'event') === 'error');

      if (sawMeaningful) {
        committed = true;
        flushHeld();
        continue;
      }

      if (errorFrame && allowRetry && sseErrorIsRetryable(errorFrame, signal)) {
        await reader.cancel().catch(() => undefined);
        return 'retry';
      }

      if (errorFrame) {
        committed = true;
        flushHeld();
      }
    }
  } catch (error) {
    if (committed || !allowRetry || !shouldRetryNetworkFailure(error, signal)) {
      flushHeld();
      controller.error(toStreamError(error));
      return 'errored';
    }
    await reader.cancel().catch(() => undefined);
    return 'retry';
  } finally {
    clearInterval(keepalive);
  }
};

const attachNetworkRetry = (
  response: Response,
  run: () => Promise<Response>,
  options?: ChatMethodOptions,
): Response => {
  if (!response.body) return response;

  const initialBody = response.body;
  const wrapped = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const first = await pumpChatStream({
          allowRetry: true,
          body: initialBody,
          controller,
          signal: options?.signal,
        });

        if (first !== 'retry') {
          if (first === 'close') controller.close();
          return;
        }

        retryLog('network reset before first chunk; retrying SuperGrok chat once');
        await waitForRetryDelay(options?.signal);
        const nextResponse = await run();
        if (!nextResponse.body) {
          controller.close();
          return;
        }

        const second = await pumpChatStream({
          allowRetry: false,
          body: nextResponse.body,
          controller,
          signal: options?.signal,
        });
        if (second === 'close') controller.close();
      } catch (error) {
        controller.error(toStreamError(error));
      }
    },
  });

  return new Response(wrapped, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};

/**
 * Retries the chat call once when the request or SSE body fails with a
 * network-class error before any content, reasoning, or tool-call chunk has
 * been forwarded to the caller.
 */
export const retryChatOnTransientNetworkError = async (
  run: () => Promise<Response>,
  options?: ChatMethodOptions,
): Promise<Response> => {
  try {
    const response = await run();
    return attachNetworkRetry(response, run, options);
  } catch (error) {
    if (!shouldRetryNetworkFailure(error, options?.signal)) throw error;

    retryLog('network reset before first chunk; retrying SuperGrok chat once');
    await waitForRetryDelay(options?.signal);
    return run();
  }
};
