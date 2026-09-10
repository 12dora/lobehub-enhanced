import { ModelEmptyError } from '@lobechat/model-runtime';
import { describe, expect, it } from 'vitest';

import { isRetryableNetworkEmptyCompletion } from './serverCallLlmRetryPolicy';

const emptyNetworkDiagnostics = {
  contentLength: 0,
  fileCount: 0,
  finishReason: 'network_error',
  imageCount: 0,
  reasoningLength: 0,
  toolCallCount: 0,
};

describe('isRetryableNetworkEmptyCompletion', () => {
  it('retries an unbilled network-error empty completion', () => {
    expect(
      isRetryableNetworkEmptyCompletion(new ModelEmptyError(undefined, emptyNetworkDiagnostics)),
    ).toBe(true);
  });

  it('does not retry billed empty completions even with a network_error finish reason', () => {
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, cost: 0.12 }),
      ),
    ).toBe(false);
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, outputTokens: 8 }),
      ),
    ).toBe(false);
  });

  it('does not retry when generated files, images, tools, or text were produced', () => {
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, fileCount: 1 }),
      ),
    ).toBe(false);
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, imageCount: 1 }),
      ),
    ).toBe(false);
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, toolCallCount: 1 }),
      ),
    ).toBe(false);
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, contentLength: 1 }),
      ),
    ).toBe(false);
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, reasoningLength: 1 }),
      ),
    ).toBe(false);
  });

  it('does not retry other empty-completion finish reasons or non-ModelEmptyError values', () => {
    expect(
      isRetryableNetworkEmptyCompletion(
        new ModelEmptyError(undefined, { ...emptyNetworkDiagnostics, finishReason: 'stop' }),
      ),
    ).toBe(false);
    expect(isRetryableNetworkEmptyCompletion(new ModelEmptyError())).toBe(false);
    expect(isRetryableNetworkEmptyCompletion(new Error('network_error'))).toBe(false);
  });
});
