// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminAgentDraftDependencies } from './types';
import { useDependencyReadiness } from './useDependencyReadiness';

const MODEL = {
  modelKey: 'gpt-4.1',
  providerChecksum: 'a'.repeat(64),
  providerKey: 'openai',
  providerRevision: 4,
};

const SOURCE = {
  chatModels: [{ displayName: 'GPT-4.1', extendParams: [], modelKey: 'gpt-4.1', type: 'chat' }],
  providerChecksum: 'a'.repeat(64),
  providerKey: 'openai',
  providerRevision: 4,
};

const settled = (data: unknown) => ({ data, error: undefined, isLoading: false, mutate: vi.fn() });

const deps = (over: Partial<AdminAgentDraftDependencies> = {}): AdminAgentDraftDependencies => ({
  connectors: [],
  model: MODEL,
  skills: [],
  ...over,
});

/** Every catalog healthy and settled, so only the model under test decides the outcome. */
const run = (
  source: unknown,
  dependencies: AdminAgentDraftDependencies = deps(),
  onValidityChange = vi.fn(),
) => {
  const result = renderHook(() =>
    useDependencyReadiness({
      connectorDetail: settled(undefined),
      connectorDetailUsable: false,
      connectorId: undefined,
      connectorRefDetails: settled({}),
      connectors: settled({ items: [] }),
      connectorsListUsable: true,
      connectorsSettled: true,
      dependencies,
      onValidityChange,
      pendingConnectorIds: [],
      providers: settled({ items: [] }),
      providersUsable: true,
      skills: settled([]),
      skillsSettled: true,
      source: settled(source),
      sourceSettled: true,
    } as never),
  );
  return { onValidityChange, ...result };
};

describe('useDependencyReadiness model staleness', () => {
  it('offers a fresh pin, and stays ready, when the pin is behind but the model is published', () => {
    // The provider was republished for unrelated reasons: the admin has nothing to fix, so no
    // "Outdated" tag, no issue, and Save is not held shut. The fresh pin rides on the validity so
    // a submit can write it — the draft itself is never touched.
    const { onValidityChange, result } = run({
      ...SOURCE,
      providerChecksum: 'b'.repeat(64),
      providerRevision: 5,
    });

    expect(result.current.displayModelStale).toBe(false);
    expect(result.current.modelRepin).toEqual({
      modelKey: 'gpt-4.1',
      providerChecksum: 'b'.repeat(64),
      providerKey: 'openai',
      providerRevision: 5,
    });
    expect(onValidityChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ issues: [], ready: true }),
    );
  });

  it('flags the model when the provider no longer publishes it', () => {
    const { onValidityChange, result } = run({
      ...SOURCE,
      chatModels: [{ displayName: 'GPT-5', extendParams: [], modelKey: 'gpt-5', type: 'chat' }],
    });

    expect(result.current.displayModelStale).toBe(true);
    // A model that is gone is the admin's to answer — never silently swapped for a fresh pin.
    expect(result.current.modelRepin).toBeNull();
    expect(onValidityChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        issues: ['agentCatalog.dependency.issues.modelStale'],
        modelRepin: null,
        ready: false,
      }),
    );
  });

  it('flags the model when the pinned provider is gone from the catalog', () => {
    const { result } = run({ ...SOURCE, providerKey: 'anthropic' });
    expect(result.current.displayModelStale).toBe(true);
  });

  it('is ready, with no issue and no re-pin, once the pin matches the published source', () => {
    const { onValidityChange, result } = run(SOURCE);

    expect(result.current.displayModelStale).toBe(false);
    expect(result.current.modelRepin).toBeNull();
    expect(onValidityChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ issues: [], modelRepin: null, ready: true }),
    );
  });

  it('blocks Save with a stated reason when no model has been chosen', () => {
    const { onValidityChange } = run(SOURCE, deps({ model: null }));

    expect(onValidityChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        blockers: [{ message: 'agentCatalog.editor.blocked.model' }],
        issues: [],
        ready: false,
      }),
    );
  });
});
