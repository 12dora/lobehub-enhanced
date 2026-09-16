import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { tasks } from './task';
import { users } from './user';

/**
 * Recurring fire rule stored on `reminders.repeat_rule`.
 * `weekdays` is 1..7 with Monday = 1. `time` is `HH:mm` in the row timezone.
 */
export interface ReminderRepeatRule {
  freq: 'daily' | 'monthly' | 'weekly';
  monthDays?: number[];
  time: string;
  until?: string;
  weekdays?: number[];
}

export type ReminderStatus = 'canceled' | 'expired' | 'failed' | 'scheduled' | 'sent';
export type ReminderSource = 'task' | 'tool' | 'ui';
export type ReminderRecipientKind = 'department' | 'user';
export type ReminderDeliveryStatus = 'failed' | 'sent' | 'skipped';

/**
 * First-class timed reminder, separate from agent tasks.
 * `fire_at` is the next (or only) fire instant. Recurring rows stay `scheduled`
 * until canceled or the rule's `until` date is passed.
 */
export const reminders = pgTable(
  'reminders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('reminders'))
      .notNull(),
    createdByUserId: text('created_by_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdByAgentId: text('created_by_agent_id'),
    /** Display name of the creator at insert time. */
    creatorName: text('creator_name').notNull(),
    content: text('content').notNull(),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    /** Next fire instant. */
    fireAt: timestamptz('fire_at').notNull(),
    repeatRule: jsonb('repeat_rule').$type<ReminderRepeatRule>(),
    status: text('status').$type<ReminderStatus>().notNull().default('scheduled'),
    firedCount: integer('fired_count').notNull().default(0),
    lastFiredAt: timestamptz('last_fired_at'),
    canceledAt: timestamptz('canceled_at'),
    source: text('source').$type<ReminderSource>().notNull().default('tool'),
    topicId: text('topic_id'),
    /**
     * Linked reminder-task row. Null on legacy reminders fired by reminderWorker.
     * ON DELETE CASCADE: deleting the task drops the profile + deliveries.
     */
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reminders_status_fire_at_idx').on(t.status, t.fireAt),
    uniqueIndex('reminders_task_id_unique')
      .on(t.taskId)
      .where(sql`${t.taskId} is not null`),
  ],
);

export const reminderRecipients = pgTable(
  'reminder_recipients',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('reminderRecipients'))
      .notNull(),
    reminderId: text('reminder_id')
      .references(() => reminders.id, { onDelete: 'cascade' })
      .notNull(),
    kind: text('kind').$type<ReminderRecipientKind>().notNull(),
    staffId: text('staff_id'),
    deptId: text('dept_id'),
    displayName: text('display_name').notNull(),
    deptName: text('dept_name').notNull().default(''),
    deptPath: text('dept_path').notNull().default(''),
    /** Department recipients: subtree member count at creation. */
    memberCount: integer('member_count'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('reminder_recipients_user_unique')
      .on(t.reminderId, t.kind, t.staffId)
      .where(sql`${t.staffId} is not null`),
    uniqueIndex('reminder_recipients_dept_unique')
      .on(t.reminderId, t.kind, t.deptId)
      .where(sql`${t.deptId} is not null`),
    index('reminder_recipients_reminder_id_idx').on(t.reminderId),
  ],
);

export const reminderDeliveries = pgTable(
  'reminder_deliveries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('reminderDeliveries'))
      .notNull(),
    reminderId: text('reminder_id')
      .references(() => reminders.id, { onDelete: 'cascade' })
      .notNull(),
    firedAt: timestamptz('fired_at').notNull(),
    staffId: text('staff_id').notNull(),
    /** AIHub user when the staffId maps to one; no FK — the target may not have an account. */
    userId: text('user_id'),
    status: text('status').$type<ReminderDeliveryStatus>().notNull(),
    failedReason: text('failed_reason'),
    /** DingTalk work-notice `task_id`. */
    providerTaskId: text('provider_task_id'),
    /** DingTalk 服务号 robot `processQueryKey` from `oToMessages/batchSend`. */
    robotMessageId: text('robot_message_id'),
    robotStatus: text('robot_status').$type<ReminderDeliveryStatus>(),
    robotFailedReason: text('robot_failed_reason'),
    hiddenByRecipient: boolean('hidden_by_recipient').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('reminder_deliveries_staff_id_fired_at_idx').on(t.staffId, t.firedAt.desc()),
    index('reminder_deliveries_reminder_id_idx').on(t.reminderId),
  ],
);

export type NewReminder = typeof reminders.$inferInsert;
export type ReminderItem = typeof reminders.$inferSelect;
export type NewReminderRecipient = typeof reminderRecipients.$inferInsert;
export type ReminderRecipientItem = typeof reminderRecipients.$inferSelect;
export type NewReminderDelivery = typeof reminderDeliveries.$inferInsert;
export type ReminderDeliveryItem = typeof reminderDeliveries.$inferSelect;
