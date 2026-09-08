/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelDisplayName } from './useModelDisplayName';

const mocks = vi.hoisted(() => ({
  displayName: undefined as string | undefined,
  isModelCatalogReady: true,
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getEnabledModelById: () => () =>
      mocks.displayName ? { displayName: mocks.displayName } : undefined,
  },
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: () => mocks.isModelCatalogReady,
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

describe('useModelDisplayName', () => {
  beforeEach(() => {
    mocks.displayName = undefined;
    mocks.isModelCatalogReady = true;
  });

  it('prefers the catalogue display name', () => {
    mocks.displayName = 'GPT-5.5';

    const { result } = renderHook(() => useModelDisplayName('gpt-5.5', 'openai'));

    expect(result.current).toBe('GPT-5.5');
  });

  it('falls back to the raw id once the catalogue says it carries no name', () => {
    const { result } = renderHook(() => useModelDisplayName('gpt-5.5', 'openai'));

    expect(result.current).toBe('gpt-5.5');
  });

  it('reports the name as unknown while the catalogue has not resolved', () => {
    mocks.isModelCatalogReady = false;

    const { result } = renderHook(() => useModelDisplayName('gpt-5.5', 'openai'));

    // Not the raw id: the caller reserves the pill's width instead of painting an
    // internal id that would be replaced — and re-flow the row — a moment later.
    expect(result.current).toBeUndefined();
  });

  it('keeps the last known name when the catalogue empties under it', () => {
    mocks.displayName = 'GPT-5.5';

    const { rerender, result } = renderHook(() => useModelDisplayName('gpt-5.5', 'openai'));
    expect(result.current).toBe('GPT-5.5');

    mocks.displayName = undefined;
    mocks.isModelCatalogReady = false;
    rerender();

    expect(result.current).toBe('GPT-5.5');
  });

  it('forgets the remembered name when the model changes', () => {
    mocks.displayName = 'GPT-5.5';

    const { rerender, result } = renderHook(
      ({ model }: { model: string }) => useModelDisplayName(model, 'openai'),
      { initialProps: { model: 'gpt-5.5' } },
    );
    expect(result.current).toBe('GPT-5.5');

    mocks.displayName = undefined;
    mocks.isModelCatalogReady = false;
    rerender({ model: 'claude-opus-4.5' });

    expect(result.current).toBeUndefined();
  });
});
