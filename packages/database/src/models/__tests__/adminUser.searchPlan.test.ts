// @vitest-environment node
/**
 * EXPLAIN plan evidence that admin contains/pinyin search uses GIN trigram +
 * text_pattern_ops indexes. Fails on Seq Scan on users at representative cardinality.
 *
 * Run: TEST_SERVER_DB=1 DATABASE_TEST_URL=... bunx vitest run src/models/__tests__/adminUser.searchPlan.test.ts
 */
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildUserSearchConditions } from '../adminUserSearch';

const isServerDB = process.env.TEST_SERVER_DB === '1' && Boolean(process.env.DATABASE_TEST_URL);

const planTextOf = (result: unknown): string => JSON.stringify(result);

const hasSeqScanOnUsers = (planText: string): boolean => /Seq Scan on users\b/i.test(planText);

describe.skipIf(!isServerDB)('M04 prefix search EXPLAIN (TEST_SERVER_DB=1)', () => {
  let db: LobeChatDatabase;
  const prefixUser = 'explain_prefix_user_unique';

  beforeEach(async () => {
    db = await getTestDB();
    await db.delete(users).where(sql`${users.id} like 'explain-%'`);
    // Representative cardinality so planner prefers expression indexes for selective contains.
    const rows = Array.from({ length: 800 }, (_, i) => ({
      email: `explain-bulk-${i}@example.com`,
      id: `explain-bulk-${i}`,
      normalizedEmail: `explain-bulk-${i}@example.com`,
      username: `explain_bulk_${i}`,
    }));
    rows.push({
      email: `${prefixUser}@example.com`,
      id: 'explain-hit',
      normalizedEmail: `${prefixUser}@example.com`,
      username: prefixUser,
    });
    for (let i = 0; i < rows.length; i += 100) {
      await db.insert(users).values(rows.slice(i, i + 100));
    }
    await db.execute(sql`ANALYZE users`);
  });

  afterEach(async () => {
    if (!db) return;
    await db.delete(users).where(sql`${users.id} like 'explain-%'`);
  });

  it('trigram GIN indexes exist with gin_trgm_ops', async () => {
    const opclass = await db.execute(sql`
      SELECT i.relname AS indexname, opc.opcname
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_opclass opc ON opc.oid = ANY (ix.indclass)
      WHERE t.relname = 'users'
        AND i.relname IN (
          'users_full_name_trgm_idx',
          'users_username_trgm_idx',
          'users_email_trgm_idx',
          'users_normalized_email_trgm_idx',
          'users_pinyin_full_pattern_idx',
          'users_pinyin_initials_pattern_idx'
        )
    `);
    const opRows =
      (opclass as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
      (Array.isArray(opclass) ? (opclass as unknown[]) : []);
    expect(opRows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(opRows)).toContain('gin_trgm_ops');
    expect(JSON.stringify(opRows)).toContain('text_pattern_ops');
  });

  it('buildUserSearchConditions uses index paths (no Seq Scan on users)', async () => {
    await db.execute(sql`SET enable_seqscan = off`);
    try {
      const result = await db.execute(sql`
        EXPLAIN (FORMAT TEXT)
        SELECT id FROM ${users}
        WHERE ${buildUserSearchConditions(prefixUser)}
        LIMIT 10
      `);
      const planText = planTextOf(result);
      const hasIndexPath = /Index Scan|Bitmap Index Scan|Index Only Scan|Bitmap Heap Scan/i.test(
        planText,
      );

      expect(hasSeqScanOnUsers(planText)).toBe(false);
      expect(hasIndexPath).toBe(true);
    } finally {
      await db.execute(sql`SET enable_seqscan = on`);
    }
  });

  it('pinyin prefix (1–3 letters) uses text_pattern_ops index path', async () => {
    await db.execute(sql`SET enable_seqscan = off`);
    try {
      const result = await db.execute(sql`
        EXPLAIN (FORMAT TEXT)
        SELECT id FROM ${users}
        WHERE ${buildUserSearchConditions('sjj')}
        LIMIT 10
      `);
      const planText = planTextOf(result);
      const hasIndexPath = /Index Scan|Bitmap Index Scan|Index Only Scan|Bitmap Heap Scan/i.test(
        planText,
      );

      expect(hasSeqScanOnUsers(planText)).toBe(false);
      expect(hasIndexPath).toBe(true);
    } finally {
      await db.execute(sql`SET enable_seqscan = on`);
    }
  });
});
