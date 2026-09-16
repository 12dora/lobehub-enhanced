'use client';

import { mutate } from '@/libs/swr';

import { ADMIN_IM_CONNECTOR_BINDINGS_KEY } from '../swrKeys';

/**
 * Drop every cached 绑定用户 page after a write.
 *
 * The search term is part of the key, so the hook-bound `mutate()` would only revalidate the `q`
 * currently on screen: unbinding a searched row and then clearing the box serves a cached list
 * that still contains it, disagreeing with the 已绑定员工 counter until the next revalidation.
 * Matched by predicate rather than by key literal for the same reason `infra/invalidate.ts` is —
 * `useClientDataSWR` appends the active workspace id, so an exact-key mutate silently no-ops.
 */
export const invalidateAdminImConnectorBindings = (): Promise<unknown> =>
  mutate((key) => Array.isArray(key) && key[0] === ADMIN_IM_CONNECTOR_BINDINGS_KEY);
