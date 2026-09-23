import { omit } from 'es-toolkit';
import { type SWRResponse } from 'swr';

import { type QueryIdentityRolesResult } from '@/database/models/userMemory';
import { useClientDataSWR } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { type MemoryEmbeddingAvailability, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';

import { type PersonaData } from '../../initialState';
import { type UserMemoryStore } from '../../store';

const n = (namespace: string) => namespace;

/** Set (or, for `undefined`, forget) one scope's entry without touching the others. */
const withScopedAvailability = (
  map: Record<string, MemoryEmbeddingAvailability>,
  scope: string,
  value: MemoryEmbeddingAvailability | undefined,
): Record<string, MemoryEmbeddingAvailability> =>
  value ? { ...map, [scope]: value } : omit(map, [scope]);

type Setter = StoreSetter<UserMemoryStore>;
export const createHomeSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new HomeActionImpl(set, get, _api);

export class HomeActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    void get;
  }

  /**
   * Loads whether a memory embedding model is configured, once per page and
   * cache scope (`${userId}:${workspaceId}`, from `useCacheScope`). The result is
   * stored under that scope, and readers look up only the current scope, so a
   * previous account / workspace's `available: false` never hides the tool
   * after a switch — the new scope reads as unknown until its own check lands.
   *
   * The scope is part of the SWR key, and SWR only fires `onSuccess` / `onError`
   * for the key that is still current, so a response from an older scope that
   * lands late is discarded instead of being written under the new scope.
   *
   * The tools engine reads the result synchronously, so sending a message never
   * waits on this request. A failed check forgets the scope's entry (unknown) —
   * an error must never hide the memory tool.
   */
  useFetchMemoryEmbeddingAvailability = (
    enabled: boolean,
    scope: string,
  ): SWRResponse<MemoryEmbeddingAvailability> => {
    return useClientDataSWR<MemoryEmbeddingAvailability>(
      enabled ? userMemoryKeys.embeddingAvailability(scope) : null,
      () => userMemoryService.getEmbeddingAvailability(),
      {
        onError: () => {
          this.#set(
            (state) => ({
              memoryEmbeddingAvailabilityMap: withScopedAvailability(
                state.memoryEmbeddingAvailabilityMap,
                scope,
                undefined,
              ),
            }),
            false,
            n('useFetchMemoryEmbeddingAvailability/onError'),
          );
        },
        onSuccess: (data: MemoryEmbeddingAvailability | undefined) => {
          this.#set(
            (state) => ({
              memoryEmbeddingAvailabilityMap: withScopedAvailability(
                state.memoryEmbeddingAvailabilityMap,
                scope,
                typeof data?.available === 'boolean' ? data : undefined,
              ),
            }),
            false,
            n('useFetchMemoryEmbeddingAvailability/onSuccess'),
          );
        },
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      },
    );
  };

  useFetchPersona = (isLogin = true): SWRResponse<PersonaData | null> => {
    return useClientDataSWR(
      isLogin ? userMemoryKeys.persona() : null,
      () => userMemoryService.getPersona(),
      {
        onSuccess: (data: PersonaData | null | undefined) => {
          this.#set(
            {
              persona: data ?? undefined,
              personaInit: true,
            },
            false,
            n('useFetchPersona/onSuccess'),
          );
        },
      },
    );
  };

  useFetchTags = (): SWRResponse<QueryIdentityRolesResult> => {
    return useClientDataSWR(
      userMemoryKeys.tags(),
      () =>
        userMemoryService.queryIdentityRoles({
          page: 1,
          size: 64,
        }),
      {
        onSuccess: (data: QueryIdentityRolesResult | undefined) => {
          this.#set(
            {
              roles: data?.roles.map((item) => ({ count: item.count, tag: item.role })) || [],
              tags: data?.tags || [],
              tagsInit: true,
            },
            false,
            n('useFetchTags/onSuccess'),
          );
        },
      },
    );
  };
}

export type HomeAction = Pick<HomeActionImpl, keyof HomeActionImpl>;
