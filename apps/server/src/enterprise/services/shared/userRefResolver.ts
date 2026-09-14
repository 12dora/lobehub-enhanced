import { UserModel } from '@/database/models/user';
import type { UserItem } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

import type { UserPublicRef } from '../../contracts/shared/userPublicRef';

const FIND_BY_IDS_CHUNK = 200;

const toPublicRef = (user: UserItem): UserPublicRef => ({
  avatar: user.avatar ?? null,
  email: user.email ?? null,
  fullName: user.fullName ?? null,
  id: user.id,
  username: user.username ?? null,
});

/**
 * Batch-resolve user ids to public refs. Unknown / deleted ids are omitted
 * (callers treat a missing map entry as `null`).
 */
export const resolveUserRefs = async (
  db: LobeChatDatabase | Transaction,
  ids: Iterable<string>,
): Promise<Map<string, UserPublicRef>> => {
  const unique = [...new Set([...ids].filter((id) => id.length > 0))];
  const refs = new Map<string, UserPublicRef>();
  if (unique.length === 0) return refs;

  for (let i = 0; i < unique.length; i += FIND_BY_IDS_CHUNK) {
    const chunk = unique.slice(i, i + FIND_BY_IDS_CHUNK);
    const rows = await UserModel.findByIds(db as LobeChatDatabase, chunk);
    for (const row of rows) {
      refs.set(row.id, toPublicRef(row));
    }
  }
  return refs;
};

export const userRefOf = (
  id: string | null | undefined,
  refs: Map<string, UserPublicRef>,
): UserPublicRef | null => (id ? (refs.get(id) ?? null) : null);
