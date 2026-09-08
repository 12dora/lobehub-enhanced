'use client';

import { useEffect, useState } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

/**
 * How long the footer keeps waiting for the model catalogue after the agent config has
 * landed. Long enough to absorb the deferred runtime-state fetch on a normal boot, short
 * enough that a failed or disabled fetch is never noticeable as a stuck composer.
 */
export const MODEL_CATALOG_WAIT_MS = 1500;

/**
 * Whether the composer footer (action bar + send area) should still show its skeleton.
 *
 * The footer is fed by **two** independent async sources, and gating on only one of them
 * is what makes the composer pop twice on a cold home page:
 *
 * 1. the agent config (`agentMap[agentId]`) — decides the model/provider, the effort
 *    level and which actions apply;
 * 2. the aiInfra provider runtime state (`enabledAiModels`) — decides the model's *display
 *    name* (`ModelLabel`) and whether the model even has a thinking-effort control
 *    (`ThinkingEffort` renders `null` without it).
 *
 * (2) is fetched deliberately late (`DeferredStoreInitialization`), so a footer released on
 * (1) alone paints `[raw model id | Send]` and then re-flows into
 * `[display name | Effort | Send]` — one visible flicker, right where the user is typing.
 *
 * Fail-open by construction: the wait is bounded by `MODEL_CATALOG_WAIT_MS` measured from
 * the moment the agent config lands, so a runtime-state fetch that errors, never runs
 * (logged out, module disabled) or simply takes too long releases the footer instead of
 * stranding it. The deadline is re-armed whenever the agent config goes back to loading.
 */
export const useComposerFooterLoading = (isAgentConfigLoading: boolean): boolean => {
  const isModelCatalogReady = useAiInfraStore(aiProviderSelectors.isInitAiProviderRuntimeState);
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);

  useEffect(() => {
    // The clock starts when the agent config lands, so a slow agent fetch never eats the
    // catalogue's grace period.
    if (isAgentConfigLoading) {
      setWaitedLongEnough(false);
      return;
    }

    if (isModelCatalogReady) return;

    const timer = setTimeout(() => setWaitedLongEnough(true), MODEL_CATALOG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [isAgentConfigLoading, isModelCatalogReady]);

  if (isAgentConfigLoading) return true;

  return !isModelCatalogReady && !waitedLongEnough;
};
