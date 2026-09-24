import { type SQL, sql } from 'drizzle-orm';

/**
 * Transaction-scoped lock for one `global_files.hash_id`.
 *
 * The orphan sweep holds this from the post-delete re-check through DeleteObject.
 * Reuse paths hold it across the `accessed_at` bump and a reinsert, so a row
 * cannot commit between that re-check and the object delete.
 *
 * `hashtext` returns int4. `pg_advisory_xact_lock(bigint)` does not accept int4,
 * so the key is cast. The same expression must be used on every side.
 */
export interface GlobalFileHashLockDb {
  execute: (query: SQL) => unknown;
}

export const lockGlobalFileHash = async (
  tx: GlobalFileHashLockDb,
  hashId: string,
): Promise<void> => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${hashId}::text)::bigint)`);
};
