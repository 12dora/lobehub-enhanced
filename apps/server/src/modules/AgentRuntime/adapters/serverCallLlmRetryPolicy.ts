import { ModelEmptyError } from '@lobechat/model-runtime';

export const NETWORK_EMPTY_COMPLETION_MAX_RETRIES = 3;
export const NETWORK_EMPTY_COMPLETION_MAX_ATTEMPTS = NETWORK_EMPTY_COMPLETION_MAX_RETRIES + 1;

/**
 * A stream that died on the transport before the model produced anything: no
 * content, no reasoning, no image, no tool call and — decisively — neither cost
 * nor output tokens, so the attempt billed nothing.
 *
 * `ModelEmptyCompletion` is non-retryable by spec precisely because "a retry is
 * a new, potentially billable provider request". That reasoning is what these
 * diagnostics rule out, which is why this narrow shape may retry while every
 * other empty completion still surfaces immediately.
 *
 * Deliberately provider-independent: the zero-output, zero-cost diagnostics
 * carry the whole safety argument on their own. A BYOK stream dropping
 * mid-flight is the same failure, and nothing about a first-party route makes
 * an unbilled network drop more retryable than a third-party one.
 *
 * Fork diagnostics also include `fileCount` (generated non-image files). A
 * file-only answer is visible output, so it must stay non-retryable.
 */
export const isRetryableNetworkEmptyCompletion = (error: unknown) => {
  if (!(error instanceof ModelEmptyError)) return false;

  const diagnostics = error.diagnostics;
  return (
    diagnostics?.finishReason === 'network_error' &&
    diagnostics.contentLength === 0 &&
    diagnostics.reasoningLength === 0 &&
    diagnostics.imageCount === 0 &&
    diagnostics.toolCallCount === 0 &&
    diagnostics.fileCount === 0 &&
    diagnostics.cost === undefined &&
    diagnostics.outputTokens === undefined
  );
};
