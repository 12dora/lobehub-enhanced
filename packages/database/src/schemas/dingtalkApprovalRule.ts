import type {
  ApprovalRuleAction,
  ApprovalRuleConditions,
  ApprovalRuleDisabledReason,
  ApprovalRuleRunStatus,
} from '@lobechat/types';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

/**
 * User-owned DingTalk approval automation rule. `staff_id` is the verified
 * DingTalk userId snapshot at creation. `expires_at` null means no expiry.
 */
export const dingtalkApprovalRules = pgTable(
  'dingtalk_approval_rules',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('dingtalkApprovalRules'))
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** DingTalk userId snapshot at creation. */
    staffId: text('staff_id').notNull(),
    name: text('name').notNull(),
    processCode: text('process_code').notNull(),
    processName: text('process_name').notNull(),
    conditions: jsonb('conditions').$type<ApprovalRuleConditions>().notNull(),
    action: text('action').$type<ApprovalRuleAction>().notNull(),
    remark: text('remark'),
    redirectToStaffId: text('redirect_to_staff_id'),
    redirectToName: text('redirect_to_name'),
    enabled: boolean('enabled').notNull().default(true),
    expiresAt: timestamptz('expires_at'),
    disabledReason: text('disabled_reason').$type<ApprovalRuleDisabledReason>(),
    dailyCount: integer('daily_count').notNull().default(0),
    dailyCountDate: date('daily_count_date'),
    lastRunAt: timestamptz('last_run_at'),
    createdByTopicId: text('created_by_topic_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dingtalk_approval_rules_user_id_idx').on(t.userId),
    index('dingtalk_approval_rules_enabled_process_code_idx').on(t.enabled, t.processCode),
  ],
);

export const dingtalkApprovalRuleRuns = pgTable(
  'dingtalk_approval_rule_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('dingtalkApprovalRuleRuns'))
      .notNull(),
    ruleId: text('rule_id')
      .references(() => dingtalkApprovalRules.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    processInstanceId: text('process_instance_id').notNull(),
    taskId: text('task_id').notNull(),
    instanceTitle: text('instance_title'),
    originatorName: text('originator_name'),
    action: text('action').$type<ApprovalRuleAction>().notNull(),
    status: text('status').$type<ApprovalRuleRunStatus>().notNull(),
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('dingtalk_approval_rule_runs_rule_id_task_id_unique').on(t.ruleId, t.taskId),
    index('dingtalk_approval_rule_runs_user_id_created_at_idx').on(t.userId, t.createdAt.desc()),
    index('dingtalk_approval_rule_runs_rule_id_created_at_idx').on(t.ruleId, t.createdAt.desc()),
  ],
);

export type NewDingtalkApprovalRule = typeof dingtalkApprovalRules.$inferInsert;
export type DingtalkApprovalRuleItem = typeof dingtalkApprovalRules.$inferSelect;
export type NewDingtalkApprovalRuleRun = typeof dingtalkApprovalRuleRuns.$inferInsert;
export type DingtalkApprovalRuleRunItem = typeof dingtalkApprovalRuleRuns.$inferSelect;
