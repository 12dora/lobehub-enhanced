import { describe, expect, it } from 'vitest';

import { describeMemoryFailure, formatMemoryToolError } from './serializeError';

describe('describeMemoryFailure', () => {
  it('reads errorType from a plain model-runtime payload', () => {
    const described = describeMemoryFailure({
      error: {},
      errorType: 'InvalidProviderAPIKey',
    });

    expect(described.detail).toBe('InvalidProviderAPIKey');
    expect(described.detail).not.toContain('undefined');
    expect(described.stopRetry).toBe(true);
  });

  it('includes a nested error message when the payload has one', () => {
    expect(
      describeMemoryFailure({
        error: { message: 'provider rejected the key' },
        errorType: 'InvalidProviderAPIKey',
      }).detail,
    ).toBe('InvalidProviderAPIKey: provider rejected the key');
  });

  it('tells the model not to retry memory after an invalid embedding key', () => {
    const text = formatMemoryToolError('searchUserMemory', {
      errorType: 'InvalidProviderAPIKey',
    });

    expect(text).toContain('searchUserMemory with error detail: InvalidProviderAPIKey');
    expect(text).toContain('Do not retry memory tools in this turn');
    expect(text).not.toContain('undefined');
  });

  it('does not add the retry warning for an ordinary Error', () => {
    const text = formatMemoryToolError('addContextMemory', new Error('database down'));

    expect(text).toBe('addContextMemory with error detail: database down.');
  });
});
