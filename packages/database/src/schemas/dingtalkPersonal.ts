import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export type DingtalkPersonalAuthorizationStatus = 'active' | 'expired' | 'revoked';

/**
 * One DingTalk personal-data binding per AIHub user.
 * The dws token stays in the sidecar; this row stores only the profile.
 */
export const dingtalkPersonalAuthorizations = pgTable(
  'dingtalk_personal_authorizations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('dingtalkPersonalAuthorizations'))
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    corpId: text('corp_id').notNull(),
    staffId: text('staff_id').notNull(),
    /** `<corpId>:<staffId>` sent to the broker. Never taken from tool args. */
    profile: text('profile').notNull(),
    dingtalkUserName: text('dingtalk_user_name'),
    corpName: text('corp_name'),
    status: text('status').$type<DingtalkPersonalAuthorizationStatus>().notNull(),
    authorizedAt: timestamptz('authorized_at').notNull(),
    lastCheckedAt: timestamptz('last_checked_at'),
    lastUsedAt: timestamptz('last_used_at'),
    lastErrorCode: text('last_error_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('dingtalk_personal_authorizations_user_id_unique').on(t.userId),
    index('dingtalk_personal_authorizations_corp_id_staff_id_idx').on(t.corpId, t.staffId),
    uniqueIndex('dingtalk_personal_authorizations_profile_active_unique')
      .on(t.profile)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type NewDingtalkPersonalAuthorization = typeof dingtalkPersonalAuthorizations.$inferInsert;
export type DingtalkPersonalAuthorizationItem = typeof dingtalkPersonalAuthorizations.$inferSelect;
