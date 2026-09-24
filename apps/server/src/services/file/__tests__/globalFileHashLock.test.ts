// @vitest-environment node
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';

import { lockGlobalFileHash } from '../globalFileHashLock';

const db = await getTestDB();

describe('lockGlobalFileHash', () => {
  it('takes a transaction advisory lock on hashtext(hash) and can be re-entered', async () => {
    await db.transaction(async (tx) => {
      await lockGlobalFileHash(tx, 'g9-lock-hash');
      await lockGlobalFileHash(tx, 'g9-lock-hash');
      const result = await tx.execute(sql`
        SELECT count(*)::int AS n
        FROM pg_locks
        WHERE locktype = 'advisory' AND granted
      `);
      const row = (result.rows ?? [])[0] as { n?: number } | undefined;
      expect(Number(row?.n ?? 0)).toBeGreaterThan(0);
    });
  });
});
