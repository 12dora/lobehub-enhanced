import type { UserPublicRef } from '@/server/enterprise/contracts/adminUsers';

export type { UserPublicRef };

/** Loose input accepted by the shared label helpers (picker rows, snapshots, refs). */
export interface UserLabelSource {
  email?: string | null;
  fullName?: string | null;
  id: string;
  username?: string | null;
}

const trim = (value: string | null | undefined): string | undefined => value?.trim() || undefined;

/** `fullName || username || email || id` — single display rule for admin user identity. */
export const displayUserLabel = (user: UserPublicRef | UserLabelSource): string =>
  trim(user.fullName) || trim(user.username) || trim(user.email) || user.id;

/**
 * Secondary line under the display name: email if it is not already the primary,
 * otherwise username. Undefined when nothing distinct remains.
 */
export const displayUserSecondary = (user: UserPublicRef | UserLabelSource): string | undefined => {
  const primary = displayUserLabel(user);
  const email = trim(user.email);
  const username = trim(user.username);
  if (email && email !== primary) return email;
  if (username && username !== primary) return username;
  return undefined;
};

/**
 * Read a resolved `UserPublicRef` next to a raw id field (unknown/deleted → null).
 * Used until every serializer types the companion field on the contract.
 */
export const pickResolvedUserRef = (record: object, key: string): UserPublicRef | null => {
  const value = (record as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id) return null;
  return {
    avatar: typeof row.avatar === 'string' ? row.avatar : null,
    email: typeof row.email === 'string' ? row.email : null,
    fullName: typeof row.fullName === 'string' ? row.fullName : null,
    id: row.id,
    username: typeof row.username === 'string' ? row.username : null,
  };
};
