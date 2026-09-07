'use client';

import { type ReactNode, useEffect, useSyncExternalStore } from 'react';

import { type AdminToolScope, AdminToolScopeProvider } from '@/features/AdminToolScope';

/**
 * Skill Store modals (and the skill detail modals they open) are imperative:
 * `createModal` snapshots one React element and mounts it outside the page
 * tree, so the admin org scope cannot be inherited through context and a
 * scope captured at open time goes stale as soon as the org catalog refetches.
 *
 * The surface that owns the scope publishes it here on every change; the modal
 * subtree subscribes, so a toggle performed inside a modal is reflected by the
 * cards without reopening.
 */
let currentScope: AdminToolScope | null = null;

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => currentScope;

/** Publish the scope every Skill Store modal must render under. */
export const publishSkillStoreAdminScope = (scope: AdminToolScope | null) => {
  if (Object.is(scope, currentScope)) return;
  currentScope = scope;
  for (const listener of listeners) listener();
};

/**
 * Keeps the published scope in sync with the surface that opens the modals.
 * Openers rendered under the admin panel call this so detached modal trees read
 * the freshest catalog data; user surfaces publish `null` and keep writing to
 * the signed-in user's settings.
 */
export const useSkillStoreAdminScopeSync = (scope: AdminToolScope | null) => {
  useEffect(() => {
    publishSkillStoreAdminScope(scope);
  }, [scope]);

  // Reset on unmount only, so leaving the admin panel cannot leak the org scope
  // into a user surface. Kept separate from the sync effect above to avoid a
  // transient `null` between two scope objects.
  useEffect(
    () => () => {
      publishSkillStoreAdminScope(null);
    },
    [],
  );
};

/** Re-provides the live admin scope inside an imperative modal subtree. */
export const SkillStoreAdminScopeProvider = ({ children }: { children: ReactNode }) => {
  const scope = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return <AdminToolScopeProvider value={scope}>{children}</AdminToolScopeProvider>;
};
