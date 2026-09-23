// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { noteRuntimeError } from './noteRuntimeError';

const recordRuntimeError = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('./runtimeErrors', () => ({
  recordRuntimeError,
}));

describe('noteRuntimeError', () => {
  beforeEach(() => {
    recordRuntimeError.mockClear();
  });

  it('forwards the failure without blocking the caller', async () => {
    noteRuntimeError('memory', new Error('embed down'), { operation: 'searchMemory' });

    await vi.waitFor(() => {
      expect(recordRuntimeError).toHaveBeenCalledWith('memory', expect.any(Error), {
        operation: 'searchMemory',
      });
    });
  });

  it('swallows a recorder that rejects', async () => {
    recordRuntimeError.mockRejectedValueOnce(new Error('redis down'));

    expect(() => noteRuntimeError('sandbox', 'boom')).not.toThrow();
    await vi.waitFor(() => {
      expect(recordRuntimeError).toHaveBeenCalled();
    });
  });
});
