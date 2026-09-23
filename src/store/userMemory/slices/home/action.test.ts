import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MemoryEmbeddingAvailability, userMemoryService } from '@/services/userMemory';
import { userMemorySelectors, useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';
import { withSWR } from '~test-utils';

const SCOPE_A = 'user-1:workspace-a';
const SCOPE_B = 'user-1:workspace-b';

/** A non-retryable failure, so SWR's backoff retry doesn't outlive the test. */
const nonRetryableError = () =>
  Object.assign(new Error('network down'), { meta: { shouldRetry: false } });

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

interface HookProps {
  enabled: boolean;
  scope: string;
}

const renderAvailabilityHook = (props: Partial<HookProps> = {}) =>
  renderHook(
    ({ enabled, scope }: HookProps) =>
      useUserMemoryStore.getState().useFetchMemoryEmbeddingAvailability(enabled, scope),
    {
      initialProps: { enabled: props.enabled ?? true, scope: props.scope ?? SCOPE_A },
      wrapper: withSWR,
    },
  );

const availableIn = (scope: string) =>
  userMemorySelectors.memoryEmbeddingAvailable(scope)(useUserMemoryStore.getState());

beforeEach(() => {
  useUserMemoryStore.setState(initialState, false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFetchMemoryEmbeddingAvailability', () => {
  it('stores a confirmed "unavailable" result under the requesting scope', async () => {
    const spy = vi
      .spyOn(userMemoryService, 'getEmbeddingAvailability')
      .mockResolvedValue({ available: false, reason: 'not_configured' });

    renderAvailabilityHook();

    await waitFor(() => expect(availableIn(SCOPE_A)).toBe(false));
    expect(useUserMemoryStore.getState().memoryEmbeddingAvailabilityMap).toEqual({
      [SCOPE_A]: { available: false, reason: 'not_configured' },
    });
    expect(availableIn(SCOPE_B)).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('stores an available result', async () => {
    vi.spyOn(userMemoryService, 'getEmbeddingAvailability').mockResolvedValue({
      available: true,
    });

    renderAvailabilityHook();

    await waitFor(() => expect(availableIn(SCOPE_A)).toBe(true));
  });

  it('reads a newly switched scope as unknown until its own check lands', async () => {
    const requestB = createDeferred<MemoryEmbeddingAvailability>();
    vi.spyOn(userMemoryService, 'getEmbeddingAvailability')
      .mockResolvedValueOnce({ available: false, reason: 'not_configured' })
      .mockReturnValueOnce(requestB.promise);

    const { rerender } = renderAvailabilityHook({ scope: SCOPE_A });
    await waitFor(() => expect(availableIn(SCOPE_A)).toBe(false));

    rerender({ enabled: true, scope: SCOPE_B });

    // The previous scope's `false` must not hide the tool in the new scope.
    expect(availableIn(SCOPE_B)).toBeUndefined();

    await act(async () => {
      requestB.resolve({ available: true });
      await requestB.promise;
    });

    await waitFor(() => expect(availableIn(SCOPE_B)).toBe(true));
    expect(availableIn(SCOPE_A)).toBe(false);
  });

  it('does not let a stale response from the previous scope land on the new scope', async () => {
    const requestA = createDeferred<MemoryEmbeddingAvailability>();
    const requestB = createDeferred<MemoryEmbeddingAvailability>();
    const spy = vi
      .spyOn(userMemoryService, 'getEmbeddingAvailability')
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);

    const { rerender } = renderAvailabilityHook({ scope: SCOPE_A });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ enabled: true, scope: SCOPE_B });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    // Out of order: the new scope's request finishes first...
    await act(async () => {
      requestB.resolve({ available: true });
      await requestB.promise;
    });
    await waitFor(() => expect(availableIn(SCOPE_B)).toBe(true));

    // ...then the old scope's request lands late with "unavailable".
    await act(async () => {
      requestA.resolve({ available: false, reason: 'not_configured' });
      await requestA.promise;
    });

    expect(availableIn(SCOPE_B)).toBe(true);
    expect(useUserMemoryStore.getState().memoryEmbeddingAvailabilityMap[SCOPE_B]).toEqual({
      available: true,
    });
  });

  it('treats a failed check as unknown for that scope only', async () => {
    useUserMemoryStore.setState(
      {
        memoryEmbeddingAvailabilityMap: {
          [SCOPE_A]: { available: false },
          [SCOPE_B]: { available: false },
        },
      },
      false,
    );
    const spy = vi
      .spyOn(userMemoryService, 'getEmbeddingAvailability')
      .mockRejectedValue(nonRetryableError());

    const { result } = renderAvailabilityHook({ scope: SCOPE_A });

    await waitFor(() => expect(result.current.error).toBeDefined());
    await waitFor(() => expect(availableIn(SCOPE_A)).toBeUndefined());
    expect(availableIn(SCOPE_B)).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('treats a malformed payload as unknown', async () => {
    useUserMemoryStore.setState(
      { memoryEmbeddingAvailabilityMap: { [SCOPE_A]: { available: false } } },
      false,
    );
    vi.spyOn(userMemoryService, 'getEmbeddingAvailability').mockResolvedValue(
      {} as unknown as MemoryEmbeddingAvailability,
    );

    const { result } = renderAvailabilityHook();

    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() => expect(availableIn(SCOPE_A)).toBeUndefined());
  });

  it('does not request when disabled', () => {
    const spy = vi.spyOn(userMemoryService, 'getEmbeddingAvailability');

    const { result } = renderAvailabilityHook({ enabled: false });

    expect(result.current.data).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    expect(availableIn(SCOPE_A)).toBeUndefined();
  });
});
