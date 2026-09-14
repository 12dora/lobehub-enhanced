import type { UserPublicRef } from '@/server/enterprise/contracts/adminUsers';

export type { UserPublicRef };

/** Loose input accepted by the shared label helpers (picker rows, snapshots, refs). */
export interface UserLabelSource {
  email?: string | null;
  fullName?: string | null;
  id: string;
  username?: string | null;
}

const trim = (value: string | null | undefined): string | undefined => {
  const next = value?.trim();
  return next ? next : undefined;
};

/** `fullName || username || email || id` — single display rule for admin user identity. */
export const displayUserLabel = (user: UserPublicRef | UserLabelSource): string =>
  trim(user.fullName) || trim(user.username) || trim(user.email) || user.id;

/**
 * Secondary line under the display name: email if it is not already the primary,
 * otherwise username. Undefined when nothing distinct remains.
 */
export const displayUserSecondary = (
  user: UserPublicRef | UserLabelSource,
): string | undefined => {
  const primary = displayUserLabel(user);
  const email = trim(user.email);
  const username = trim(user.username);
  if (email && email !== primary) return email;
  if (username && username !== primary) return username;
  return undefined;
};
