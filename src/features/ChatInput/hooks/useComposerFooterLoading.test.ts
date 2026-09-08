/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MODEL_CATALOG_WAIT_MS, useComposerFooterLoading } from './useComposerFooterLoading';

const mocks = vi.hoisted(() => ({ isModelCatalogReady: false }));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: () => mocks.isModelCatalogReady,
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

describe('useComposerFooterLoading', () => {
  beforeEach(() => {
    mocks.isModelCatalogReady = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps loading while the agent config is still hydrating', () => {
    mocks.isModelCatalogReady = true;

    const { result } = renderHook(() => useComposerFooterLoading(true));

    expect(result.current).toBe(true);
  });

  it('releases immediately when both sources are already resolved', () => {
    mocks.isModelCatalogReady = true;

    const { result } = renderHook(() => useComposerFooterLoading(false));

    expect(result.current).toBe(false);
  });

  it('holds the skeleton while the model catalogue is still pending', () => {
    const { result } = renderHook(() => useComposerFooterLoading(false));

    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(MODEL_CATALOG_WAIT_MS - 1);
    });

    expect(result.current).toBe(true);
  });

  it('releases as soon as the model catalogue initialises', () => {
    const { rerender, result } = renderHook(() => useComposerFooterLoading(false));
    expect(result.current).toBe(true);

    mocks.isModelCatalogReady = true;
    rerender();

    expect(result.current).toBe(false);
  });

  it('fails open on the deadline so a stalled or absent catalogue never strands it', () => {
    const { result } = renderHook(() => useComposerFooterLoading(false));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(MODEL_CATALOG_WAIT_MS);
    });

    expect(result.current).toBe(false);
  });

  it('starts the deadline only once the agent config has landed', () => {
    const { rerender, result } = renderHook(
      ({ agentLoading }: { agentLoading: boolean }) => useComposerFooterLoading(agentLoading),
      { initialProps: { agentLoading: true } },
    );

    // A slow agent fetch must not eat the catalogue's grace period.
    act(() => {
      vi.advanceTimersByTime(MODEL_CATALOG_WAIT_MS * 2);
    });
    expect(result.current).toBe(true);

    rerender({ agentLoading: false });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(MODEL_CATALOG_WAIT_MS);
    });
    expect(result.current).toBe(false);
  });

  it('re-arms the deadline when the agent config goes back to loading', () => {
    const { rerender, result } = renderHook(
      ({ agentLoading }: { agentLoading: boolean }) => useComposerFooterLoading(agentLoading),
      { initialProps: { agentLoading: false } },
    );

    act(() => {
      vi.advanceTimersByTime(MODEL_CATALOG_WAIT_MS);
    });
    expect(result.current).toBe(false);

    rerender({ agentLoading: true });
    expect(result.current).toBe(true);

    rerender({ agentLoading: false });
    expect(result.current).toBe(true);
  });
});
