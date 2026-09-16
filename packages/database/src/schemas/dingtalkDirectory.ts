import { boolean, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';

/**
 * DingTalk department tree mirrored from the notify app (服务号).
 * `path_names` is a display path such as `捷发 / 安环部`; root dept `1` contributes nothing.
 * `member_count` is **direct** members; subtree counts are computed at query time.
 */
export const dingtalkDepartments = pgTable(
  'dingtalk_departments',
  {
    deptId: text('dept_id').primaryKey().notNull(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    namePinyinFull: text('name_pinyin_full').notNull().default(''),
    namePinyinInitials: text('name_pinyin_initials').notNull().default(''),
    /** Display path, e.g. `捷发 / 安环部`. Root dept `1` contributes nothing. */
    pathNames: text('path_names').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Direct members of this department (not the subtree). */
    memberCount: integer('member_count').notNull().default(0),
    syncedAt: timestamptz('synced_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dingtalk_departments_parent_id_idx').on(t.parentId),
    index('dingtalk_departments_name_idx').on(t.name),
    index('dingtalk_departments_name_pinyin_full_idx').on(t.namePinyinFull),
    index('dingtalk_departments_name_pinyin_initials_idx').on(t.namePinyinInitials),
  ],
);

/**
 * DingTalk corp users mirrored from the notify app. Independent of AIHub `users`
 * — a staff member may never have logged in.
 */
export const dingtalkDirectoryUsers = pgTable(
  'dingtalk_directory_users',
  {
    staffId: text('staff_id').primaryKey().notNull(),
    name: text('name').notNull(),
    namePinyinFull: text('name_pinyin_full').notNull().default(''),
    namePinyinInitials: text('name_pinyin_initials').notNull().default(''),
    avatar: text('avatar'),
    unionId: text('union_id'),
    active: boolean('active').notNull().default(true),
    /** Smallest department = the membership whose `path_names` is longest. */
    leafDeptId: text('leaf_dept_id'),
    leafDeptName: text('leaf_dept_name').notNull().default(''),
    /** `path_names` of the leaf department. */
    deptPath: text('dept_path').notNull().default(''),
    syncedAt: timestamptz('synced_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dingtalk_directory_users_name_idx').on(t.name),
    index('dingtalk_directory_users_name_pinyin_full_idx').on(t.namePinyinFull),
    index('dingtalk_directory_users_name_pinyin_initials_idx').on(t.namePinyinInitials),
  ],
);

export const dingtalkUserDepartments = pgTable(
  'dingtalk_user_departments',
  {
    staffId: text('staff_id')
      .notNull()
      .references(() => dingtalkDirectoryUsers.staffId, { onDelete: 'cascade' }),
    deptId: text('dept_id')
      .notNull()
      .references(() => dingtalkDepartments.deptId, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.deptId] }),
    index('dingtalk_user_departments_dept_id_idx').on(t.deptId),
  ],
);

export type NewDingTalkDepartment = typeof dingtalkDepartments.$inferInsert;
export type DingTalkDepartmentItem = typeof dingtalkDepartments.$inferSelect;
export type NewDingTalkDirectoryUser = typeof dingtalkDirectoryUsers.$inferInsert;
export type DingTalkDirectoryUserItem = typeof dingtalkDirectoryUsers.$inferSelect;
export type NewDingTalkUserDepartment = typeof dingtalkUserDepartments.$inferInsert;
export type DingTalkUserDepartmentItem = typeof dingtalkUserDepartments.$inferSelect;
