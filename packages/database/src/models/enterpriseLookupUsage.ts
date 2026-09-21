import { and, eq, sql } from 'drizzle-orm';

import type { EnterpriseLookupProvider } from '../schemas/enterpriseLookup';
import { enterpriseLookupDailyUsage } from '../schemas/enterpriseLookup';
import type { LobeChatDatabase, Transaction } from '../type';

const usageLockKey = (userId: string, date: string) => `enterprise-lookup-usage:${userId}:${date}`;

export class EnterpriseLookupUsageModel {
  constructor(private readonly db: LobeChatDatabase) {}

  getDailyTotal = async (userId: string, date: string): Promise<number> => {
    return this.sumForDay(this.db, userId, date);
  };

  /**
   * Atomic upsert of +1 for `(userId, date, provider)`. Returns the new
   * user/day total across all providers.
   */
  increment = async (
    userId: string,
    date: string,
    provider: EnterpriseLookupProvider,
  ): Promise<number> => {
    return this.withUserDayLock(userId, date, async (tx) => {
      await this.bump(tx, userId, date, provider);
      return this.sumForDay(tx, userId, date);
    });
  };

  /**
   * Hold a per-user/day advisory lock, reject when `limit > 0` and the
   * cross-provider total is already at the cap, otherwise increment. `limit`
   * 0 means unlimited (still records usage).
   */
  reserve = async (
    userId: string,
    date: string,
    provider: EnterpriseLookupProvider,
    limit: number,
  ): Promise<boolean> => {
    return this.withUserDayLock(userId, date, async (tx) => {
      const used = await this.sumForDay(tx, userId, date);
      if (limit > 0 && used >= limit) return false;
      await this.bump(tx, userId, date, provider);
      return true;
    });
  };

  /** Drop one reserved call for `(userId, date, provider)`. Never goes below 0. */
  release = async (
    userId: string,
    date: string,
    provider: EnterpriseLookupProvider,
  ): Promise<void> => {
    await this.withUserDayLock(userId, date, async (tx) => {
      await tx
        .update(enterpriseLookupDailyUsage)
        .set({
          callCount: sql`GREATEST(${enterpriseLookupDailyUsage.callCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(enterpriseLookupDailyUsage.userId, userId),
            eq(enterpriseLookupDailyUsage.usageDate, date),
            eq(enterpriseLookupDailyUsage.provider, provider),
          ),
        );
    });
  };

  private withUserDayLock = async <T>(
    userId: string,
    date: string,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${usageLockKey(userId, date)})::bigint)`,
      );
      return work(tx);
    });

  private bump = async (
    tx: Transaction,
    userId: string,
    date: string,
    provider: EnterpriseLookupProvider,
  ): Promise<void> => {
    await tx
      .insert(enterpriseLookupDailyUsage)
      .values({
        callCount: 1,
        provider,
        usageDate: date,
        userId,
      })
      .onConflictDoUpdate({
        set: {
          callCount: sql`${enterpriseLookupDailyUsage.callCount} + 1`,
          updatedAt: new Date(),
        },
        target: [
          enterpriseLookupDailyUsage.userId,
          enterpriseLookupDailyUsage.usageDate,
          enterpriseLookupDailyUsage.provider,
        ],
      });
  };

  private sumForDay = async (
    db: LobeChatDatabase | Transaction,
    userId: string,
    date: string,
  ): Promise<number> => {
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${enterpriseLookupDailyUsage.callCount}), 0)::int`,
      })
      .from(enterpriseLookupDailyUsage)
      .where(
        and(
          eq(enterpriseLookupDailyUsage.userId, userId),
          eq(enterpriseLookupDailyUsage.usageDate, date),
        ),
      );

    return Number(row?.total ?? 0);
  };
}
