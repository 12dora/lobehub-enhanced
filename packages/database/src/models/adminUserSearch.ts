/**
 * Shared admin user search predicate.
 *
 * Contains `lower(field) LIKE '%q%'` on display name / username / email (GIN
 * trigram indexes `users_*_trgm_idx`) plus prefix LIKE on the denormalized
 * lowercase pinyin columns so 1–3 letter queries (`s` / `sj` / `sjj` / `shao`)
 * still hit `text_pattern_ops` btree indexes. Every OR branch is indexable;
 * the planner should BitmapOr rather than Seq Scan `users`.
 */
import { desc, or, type SQL, sql } from 'drizzle-orm';

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

  const contains = likeContains(trimmed.toLowerCase());
  const pinyinPrefix = `${escapeLike(trimmed.toLowerCase())}%`;

  return or(
    sql`lower(${users.fullName}) LIKE ${contains} ESCAPE '\\'`,
    sql`lower(${users.username}) LIKE ${contains} ESCAPE '\\'`,
    sql`lower(${users.email}) LIKE ${contains} ESCAPE '\\'`,
    sql`lower(${users.normalizedEmail}) LIKE ${contains} ESCAPE '\\'`,
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
