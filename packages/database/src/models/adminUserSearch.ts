/**
 * Shared admin user search predicate.
 *
 * Contains ILIKE on display name / username / email, plus prefix LIKE on the
 * denormalized lowercase pinyin columns so 1–3 letter queries (`s` / `sj` /
 * `sjj` / `shao`) still hit `text_pattern_ops` indexes.
 */
import { desc, ilike, or, type SQL, sql } from 'drizzle-orm';

import { escapeLike, likeContains } from '../repositories/platformSearch';
import { users } from '../schemas/user';
import type { LobeChatDatabase, Transaction } from '../type';

export interface AdminUserSearchRow {
  avatar: string | null;
  email: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}

export const buildUserSearchConditions = (q: string): SQL => {
  const trimmed = q.trim();
  if (!trimmed) throw new Error('q is required for user search');

  const contains = likeContains(trimmed);
  const pinyinPrefix = `${escapeLike(trimmed.toLowerCase())}%`;

  return or(
    ilike(users.fullName, contains),
    ilike(users.username, contains),
    ilike(users.email, contains),
    ilike(users.normalizedEmail, contains),
    sql`${users.pinyinFull} LIKE ${pinyinPrefix} ESCAPE '\\'`,
    sql`${users.pinyinInitials} LIKE ${pinyinPrefix} ESCAPE '\\'`,
  )!;
};

export const searchUsers = async (
  db: LobeChatDatabase | Transaction,
  params: { limit: number; q: string },
): Promise<AdminUserSearchRow[]> => {
  const limit = Math.min(Math.max(params.limit, 1), 50);

  return db
    .select({
      avatar: users.avatar,
      email: users.email,
      fullName: users.fullName,
      id: users.id,
      username: users.username,
    })
    .from(users)
    .where(buildUserSearchConditions(params.q))
    .orderBy(desc(users.lastActiveAt), desc(users.id))
    .limit(limit);
};
