import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@lobechat/types';

import { type UserMemoryStoreState } from './initialState';
import { userMemoryCacheKey } from './utils/cacheKey';

const EMPTY_RESULT: RetrieveMemoryResult = {
  activities: [],
  contexts: [],
  experiences: [],
  preferences: [],
};

type ActiveUserMemoriesResult = {
  fetchedAt: number;
  memories: RetrieveMemoryResult;
};

export const userMemorySelectors = {
  activeMemories: (state: UserMemoryStoreState): RetrieveMemoryResult | undefined => {
    if (!state.activeParamsKey) return undefined;

    return state.memoryMap[state.activeParamsKey];
  },
  activeMemoryFetchedAt: (state: UserMemoryStoreState): number | undefined => {
    if (!state.activeParamsKey) return undefined;

    return state.memoryFetchedAtMap[state.activeParamsKey];
  },
  activeParams: (state: UserMemoryStoreState): RetrieveMemoryParams | undefined =>
    state.activeParams,
  activeUserMemories:
    (enabled: boolean) =>
    (state: UserMemoryStoreState): ActiveUserMemoriesResult | undefined => {
      if (!enabled || !state.activeParamsKey) return undefined;

      const fetchedAt = state.memoryFetchedAtMap[state.activeParamsKey];
      const memories = state.memoryMap[state.activeParamsKey];

      if (fetchedAt === undefined || !memories) return undefined;

      return {
        fetchedAt,
        memories,
      };
    },
  memoriesByParams: (params?: RetrieveMemoryParams) => (state: UserMemoryStoreState) => {
    if (!params) return EMPTY_RESULT;

    const key = userMemoryCacheKey(params);

    return state.memoryMap[key] ?? EMPTY_RESULT;
  },
  /**
   * Embedding availability for one cache scope — pass the *current* scope so a
   * previous account / workspace's result never leaks in. `false` only when the
   * server confirmed no usable embedding model for that scope; `undefined` while
   * unknown (not loaded yet, fetch failed, or memory module off). Callers gate
   * on `=== false` so an unknown result keeps the memory tool available.
   */
  memoryEmbeddingAvailable:
    (scope: string) =>
    (state: UserMemoryStoreState): boolean | undefined =>
      state.memoryEmbeddingAvailabilityMap[scope]?.available,
  memoryFetchedAtByParams: (params?: RetrieveMemoryParams) => (state: UserMemoryStoreState) => {
    if (!params) return undefined;

    const key = userMemoryCacheKey(params);

    return state.memoryFetchedAtMap[key];
  },
};

export { agentMemorySelectors } from './slices/agent/selectors';
export { identitySelectors } from './slices/identity/selectors';
