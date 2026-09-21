import { date, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

export type EnterpriseLookupProvider = 'qcc' | 'tianyancha';

/**
 * Per-user, per-Shanghai-day, per-provider call counts for 企业查询.
 * Daily totals are the sum of `call_count` across providers.
 */
export const enterpriseLookupDailyUsage = pgTable(
  'enterprise_lookup_daily_usage',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    usageDate: date('usage_date').notNull(),
    provider: text('provider').$type<EnterpriseLookupProvider>().notNull(),
    callCount: integer('call_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.usageDate, t.provider] })],
);

export type NewEnterpriseLookupDailyUsage = typeof enterpriseLookupDailyUsage.$inferInsert;
export type EnterpriseLookupDailyUsageItem = typeof enterpriseLookupDailyUsage.$inferSelect;
