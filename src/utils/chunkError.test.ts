import { toast } from '@lobehub/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isChunkLoadError, notifyChunkError } from './chunkError';

vi.mock('@lobehub/ui', () => ({
  toast: { error: vi.fn() },
}));

const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload },
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://app/assets/chat-a1b2.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Failed to load module script',
    'Loading chunk 42 failed',
  ])('detects "%s"', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('detects the error by name', () => {
    const error = new Error('boom');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('ignores unrelated errors and empty values', () => {
    expect(isChunkLoadError(new Error('Request failed with status 500'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('notifyChunkError', () => {
  it('reloads once and does not reload again for a second failure in the same window', () => {
    notifyChunkError();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();

    notifyChunkError();

    // Still one reload: a stale chunk that fails again right away must never loop.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('recovers again after the cooldown, so a later deploy in the same tab still self-heals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    notifyChunkError();
    expect(reload).toHaveBeenCalledTimes(1);

    // Same tab, a later deploy: the earlier reload must not latch recovery off.
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
    notifyChunkError();

    expect(reload).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
