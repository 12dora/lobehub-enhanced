const NON_EMPTY = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined') return undefined;
  return trimmed;
};

const STOP_RETRY_ERROR_TYPES = new Set([
  'InvalidProviderAPIKey',
  'NoOpenAIAPIKey',
  'EmbeddingNotConfigured',
]);

export interface MemoryFailureDescription {
  detail: string;
  errorType?: string;
  /**
   * The model must not call memory tools again in this turn.
   * Set for a missing embedding key or an embedding model that is not configured.
   */
  stopRetry: boolean;
}

const nestedMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return NON_EMPTY(error);
  return NON_EMPTY((error as { message?: unknown }).message);
};

/**
 * Model-runtime throws plain payloads (`{ errorType, error }`), not `Error`.
 * Interpolating `.message` on those payloads becomes the literal word "undefined".
 */
export const describeMemoryFailure = (error: unknown): MemoryFailureDescription => {
  let errorType: string | undefined;
  let message: string | undefined;

  if (error instanceof Error) {
    errorType = NON_EMPTY((error as { errorType?: unknown }).errorType);
    message = NON_EMPTY(error.message) || nestedMessage((error as { error?: unknown }).error);
  } else if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    errorType = NON_EMPTY(record.errorType);
    message = NON_EMPTY(record.message) || nestedMessage(record.error);
  } else {
    message = NON_EMPTY(error);
  }

  const detail = [errorType, message].filter(Boolean).join(': ') || 'unknown error';
  const stopRetry =
    (errorType !== undefined && STOP_RETRY_ERROR_TYPES.has(errorType)) ||
    /not configured/i.test(detail) ||
    (/embedding/i.test(detail) && /unavailable|missing credential/i.test(detail));

  return { detail, errorType, stopRetry };
};

const STOP_RETRY_SENTENCE =
  ' Do not retry memory tools in this turn. Continue without memory and do not mention this failure to the user.';

export const formatMemoryToolError = (action: string, error: unknown): string => {
  const { detail, stopRetry } = describeMemoryFailure(error);
  return `${action} with error detail: ${detail}.${stopRetry ? STOP_RETRY_SENTENCE : ''}`;
};

export const formatMemorySaveError = (prefix: string, error: unknown): string => {
  const { detail, stopRetry } = describeMemoryFailure(error);
  return `${prefix}: ${detail}.${stopRetry ? STOP_RETRY_SENTENCE : ''}`;
};

export const memoryUnavailableReason = (reason: string | undefined): string => {
  if (reason === 'not_configured') {
    return `Memory embedding is not configured.${STOP_RETRY_SENTENCE}`;
  }
  if (reason === 'missing_credentials') {
    return `Memory embedding provider has no usable credentials.${STOP_RETRY_SENTENCE}`;
  }
  return `Memory search is unavailable${reason ? ` (${reason})` : ''}.${STOP_RETRY_SENTENCE}`;
};
