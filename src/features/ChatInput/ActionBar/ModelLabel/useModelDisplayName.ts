'use client';

import { useRef } from 'react';

import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

/**
 * The name to paint on the model pill, or `undefined` while it is genuinely unknown.
 *
 * The raw model id is a legitimate fallback for a model the catalogue does not carry —
 * but only once the catalogue is there to say so. Before that the name is *unknown*, not
 * absent, and painting the internal id would only be swapped for the real display name a
 * moment later, re-flowing the send row. `undefined` lets the caller hold a fixed-width
 * placeholder instead.
 *
 * The last name we actually knew for the current model is remembered, so a catalogue that
 * reloads (or briefly empties) never flips a resolved label back to the raw id.
 */
export const useModelDisplayName = (model: string, provider: string): string | undefined => {
  const enabledModel = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));
  const isModelCatalogReady = useAiInfraStore(aiProviderSelectors.isInitAiProviderRuntimeState);

  const lastKnown = useRef<{ key: string; name: string } | undefined>(undefined);

  const key = `${provider}/${model}`;
  const resolved = enabledModel?.displayName || undefined;

  if (resolved) lastKnown.current = { key, name: resolved };

  const remembered = lastKnown.current?.key === key ? lastKnown.current.name : undefined;

  return resolved ?? remembered ?? (isModelCatalogReady ? model : undefined);
};
