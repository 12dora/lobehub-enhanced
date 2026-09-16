import { and, count, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';

import type {
  NewReminderDelivery,
  ReminderDeliveryStatus,
  ReminderItem,
  ReminderRecipientItem,
  ReminderRepeatRule,
  ReminderSource,
  ReminderStatus,
} from '../schemas/reminder';
import { reminderDeliveries, reminderRecipients, reminders } from '../schemas/reminder';
import { tasks } from '../schemas/task';
import type { LobeChatDatabase, Transaction } from '../type';
import { idGenerator } from '../utils/idGenerator';

export interface ReminderRecipientInput {
  deptId?: string | null;
  deptName?: string;
  deptPath?: string;
  displayName: string;
  kind: 'department' | 'user';
  memberCount?: number | null;
  staffId?: string | null;
}

export interface ReminderCreateInput {
  content: string;
  createdByAgentId?: string | null;
  creatorName: string;
  fireAt: Date;
  /** Explicit id so a task can persist `config.reminder.reminderId` before insert. */
  id?: string;
  recipients: ReminderRecipientInput[];
  repeatRule?: ReminderRepeatRule | null;
  source?: ReminderSource;
  /** Linked reminder-task id. Null on legacy (tool/ui) rows. */
  taskId?: string | null;
  timezone?: string;
  topicId?: string | null;
}

export interface ReminderProfileUpdateInput {
  canceledAt?: Date | null;
  content?: string;
  fireAt?: Date;
  recipients?: ReminderRecipientInput[];
  repeatRule?: ReminderRepeatRule | null;
  status?: ReminderStatus;
  taskId?: string | null;
}

export interface ReminderDeliveryCounts {
  failed: number;
  sent: number;
  skipped: number;
}

export interface ReminderWithRecipients extends ReminderItem {
  deliveryCounts: ReminderDeliveryCounts;
  recipients: ReminderRecipientItem[];
}

export interface ReceivedReminder {
  content: string;
  creatorName: string;
  failedReason: string | null;
  firedAt: Date;
  id: string;
  reminderId: string;
  robotFailedReason: string | null;
  robotStatus: ReminderDeliveryStatus | null;
  status: ReminderDeliveryStatus;
}

export interface ReminderFireDeliveryInput {
  failedReason?: string | null;
  providerTaskId?: string | null;
  robotFailedReason?: string | null;
  robotMessageId?: string | null;
  robotStatus?: ReminderDeliveryStatus | null;
  staffId: string;
  status: ReminderDeliveryStatus;
  userId?: string | null;
}

export interface ReminderRecordFireInput {
  deliveries: ReminderFireDeliveryInput[];
  firedAt: Date;
  nextFireAt: Date | null;
  reminderId: string;
  /** Overrides the one-shot `sent` / recurring `expired` default (e.g. all recipients inactive). */
  status?: ReminderStatus;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_DUE_LIMIT = 50;

const emptyDeliveryCounts = (): ReminderDeliveryCounts => ({ failed: 0, sent: 0, skipped: 0 });

const clampLimit = (limit: number | undefined, fallback: number): number => {
  if (limit === undefined) return fallback;
  return Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);
};

export class ReminderModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  create = async (
    input: ReminderCreateInput,
    trx?: Transaction,
  ): Promise<ReminderWithRecipients> => {
    const run = async (tx: LobeChatDatabase | Transaction) => {
      const id = input.id ?? idGenerator('reminders');
      const [row] = await tx
        .insert(reminders)
        .values({
          content: input.content,
          createdByAgentId: input.createdByAgentId ?? null,
          createdByUserId: this.userId,
          creatorName: input.creatorName,
          fireAt: input.fireAt,
          id,
          repeatRule: input.repeatRule ?? null,
          source: input.source ?? (input.taskId ? 'task' : 'tool'),
          taskId: input.taskId ?? null,
          timezone: input.timezone ?? 'Asia/Shanghai',
          topicId: input.topicId ?? null,
        })
        .returning();

      const recipients =
        input.recipients.length === 0
          ? []
          : await tx
              .insert(reminderRecipients)
              .values(
                input.recipients.map((recipient) => ({
                  deptId: recipient.deptId ?? null,
                  deptName: recipient.deptName ?? '',
                  deptPath: recipient.deptPath ?? '',
                  displayName: recipient.displayName,
                  id: idGenerator('reminderRecipients'),
                  kind: recipient.kind,
                  memberCount: recipient.memberCount ?? null,
                  reminderId: id,
                  staffId: recipient.staffId ?? null,
                })),
              )
              .returning();

      return { ...row, deliveryCounts: emptyDeliveryCounts(), recipients };
    };

    if (trx) return run(trx);
    return this.db.transaction(run);
  };

  createForTask = async (
    input: ReminderCreateInput & { taskId: string },
    trx?: Transaction,
  ): Promise<ReminderWithRecipients> =>
    this.create({ ...input, source: input.source ?? 'task' }, trx);

  findByTaskId = async (taskId: string): Promise<ReminderWithRecipients | null> => {
    const [row] = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.taskId, taskId), eq(reminders.createdByUserId, this.userId)))
      .limit(1);
    if (!row) return null;
    const [attached] = await this.attachRecipientsAndCounts(this.db, [row]);
    return attached ?? null;
  };

  updateProfile = async (
    id: string,
    input: ReminderProfileUpdateInput,
  ): Promise<ReminderWithRecipients> => {
    return this.db.transaction(async (tx) => {
      const patch: Partial<ReminderItem> = {};
      if (input.content !== undefined) patch.content = input.content;
      if (input.fireAt !== undefined) patch.fireAt = input.fireAt;
      if (input.repeatRule !== undefined) patch.repeatRule = input.repeatRule;
      if (input.status !== undefined) patch.status = input.status;
      if (input.canceledAt !== undefined) patch.canceledAt = input.canceledAt;
      if (input.taskId !== undefined) patch.taskId = input.taskId;

      const [row] = Object.keys(patch).length
        ? await tx
            .update(reminders)
            .set(patch)
            .where(and(eq(reminders.id, id), eq(reminders.createdByUserId, this.userId)))
            .returning()
        : await tx
            .select()
            .from(reminders)
            .where(and(eq(reminders.id, id), eq(reminders.createdByUserId, this.userId)))
            .limit(1);

      if (!row) {
        throw new Error(`Reminder not found: ${id}`);
      }

      if (input.recipients) {
        await tx.delete(reminderRecipients).where(eq(reminderRecipients.reminderId, id));
        if (input.recipients.length > 0) {
          await tx.insert(reminderRecipients).values(
            input.recipients.map((recipient) => ({
              deptId: recipient.deptId ?? null,
              deptName: recipient.deptName ?? '',
              deptPath: recipient.deptPath ?? '',
              displayName: recipient.displayName,
              id: idGenerator('reminderRecipients'),
              kind: recipient.kind,
              memberCount: recipient.memberCount ?? null,
              reminderId: id,
              staffId: recipient.staffId ?? null,
            })),
          );
        }
      }

      const [attached] = await this.attachRecipientsAndCounts(tx, [row]);
      if (!attached) {
        throw new Error(`Reminder not found: ${id}`);
      }
      return attached;
    });
  };

  listCreatedByTasks = async (opts?: {
    includeFinished?: boolean;
    limit?: number;
  }): Promise<ReminderWithRecipients[]> => {
    const limit = clampLimit(opts?.limit, DEFAULT_LIST_LIMIT);
    const conditions = [eq(reminders.createdByUserId, this.userId), isNotNull(reminders.taskId)];
    if (!opts?.includeFinished) conditions.push(eq(reminders.status, 'scheduled'));

    const rows = await this.db
      .select()
      .from(reminders)
      .where(and(...conditions))
      .orderBy(desc(reminders.fireAt), desc(reminders.id))
      .limit(limit);

    return this.attachRecipientsAndCounts(this.db, rows);
  };

  listCreated = async (opts?: {
    limit?: number;
    status?: ReminderStatus;
  }): Promise<ReminderWithRecipients[]> => {
    const limit = clampLimit(opts?.limit, DEFAULT_LIST_LIMIT);
    const conditions = [eq(reminders.createdByUserId, this.userId)];
    if (opts?.status) conditions.push(eq(reminders.status, opts.status));

    const rows = await this.db
      .select()
      .from(reminders)
      .where(and(...conditions))
      .orderBy(desc(reminders.fireAt), desc(reminders.id))
      .limit(limit);

    return this.attachRecipientsAndCounts(this.db, rows);
  };

  listReceived = async (opts: { limit?: number; staffId: string }): Promise<ReceivedReminder[]> => {
    const limit = clampLimit(opts.limit, DEFAULT_LIST_LIMIT);

    return this.db
      .select({
        content: reminders.content,
        creatorName: reminders.creatorName,
        failedReason: reminderDeliveries.failedReason,
        firedAt: reminderDeliveries.firedAt,
        id: reminderDeliveries.id,
        reminderId: reminderDeliveries.reminderId,
        robotFailedReason: reminderDeliveries.robotFailedReason,
        robotStatus: reminderDeliveries.robotStatus,
        status: reminderDeliveries.status,
      })
      .from(reminderDeliveries)
      .innerJoin(reminders, eq(reminderDeliveries.reminderId, reminders.id))
      .where(
        and(
          eq(reminderDeliveries.staffId, opts.staffId),
          eq(reminderDeliveries.hiddenByRecipient, false),
        ),
      )
      .orderBy(desc(reminderDeliveries.firedAt), desc(reminderDeliveries.id))
      .limit(limit);
  };

  cancel = async (id: string): Promise<ReminderItem> => {
    const [row] = await this.db
      .update(reminders)
      .set({ canceledAt: new Date(), status: 'canceled' })
      .where(and(eq(reminders.id, id), eq(reminders.createdByUserId, this.userId)))
      .returning();

    if (!row) {
      throw new Error(`Reminder not found: ${id}`);
    }
    return row;
  };

  hideReceived = async (deliveryId: string, staffId: string): Promise<boolean> => {
    const rows = await this.db
      .update(reminderDeliveries)
      .set({ hiddenByRecipient: true })
      .where(and(eq(reminderDeliveries.id, deliveryId), eq(reminderDeliveries.staffId, staffId)))
      .returning({ id: reminderDeliveries.id });
    return rows.length > 0;
  };

  /**
   * Legacy sweep filter: scheduled, due, and not linked to a reminder task.
   * Exported so tests can assert `task_id IS NULL` without running Postgres.
   */
  static buildListDueCondition = (now: Date) =>
    and(eq(reminders.status, 'scheduled'), lte(reminders.fireAt, now), isNull(reminders.taskId));

  static listDue = async (
    db: LobeChatDatabase,
    now: Date,
    limit = DEFAULT_DUE_LIMIT,
  ): Promise<ReminderItem[]> => {
    return db
      .select()
      .from(reminders)
      .where(ReminderModel.buildListDueCondition(now))
      .orderBy(reminders.fireAt, reminders.id)
      .limit(clampLimit(limit, DEFAULT_DUE_LIMIT));
  };

  /**
   * Claim a fire slot before HTTP. Returns the updated row, or null when another
   * worker already claimed this occurrence (`last_fired_at >= slotStart`).
   * Stamps `tasks.last_heartbeat_at` in the same transaction.
   */
  static claimFireSlot = async (
    db: LobeChatDatabase,
    input: {
      firedAt: Date;
      nextFireAt: Date | null;
      reminderId: string;
      slotStart: Date;
      taskId: string;
    },
  ): Promise<ReminderItem | null> => {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(reminders)
        .set({
          fireAt: input.nextFireAt ?? input.firedAt,
          firedCount: sql`${reminders.firedCount} + 1`,
          lastFiredAt: input.firedAt,
        })
        .where(
          and(
            eq(reminders.id, input.reminderId),
            eq(reminders.status, 'scheduled'),
            or(isNull(reminders.lastFiredAt), lt(reminders.lastFiredAt, input.slotStart)),
          ),
        )
        .returning();

      if (!updated) return null;

      await tx
        .update(tasks)
        .set({ lastHeartbeatAt: input.firedAt, updatedAt: input.firedAt })
        .where(eq(tasks.id, input.taskId));

      return updated;
    });
  };

  static insertDeliveries = async (
    db: LobeChatDatabase,
    input: {
      deliveries: ReminderFireDeliveryInput[];
      firedAt: Date;
      reminderId: string;
    },
  ): Promise<void> => {
    if (input.deliveries.length === 0) return;
    const values: NewReminderDelivery[] = input.deliveries.map((delivery) => ({
      failedReason: delivery.failedReason ?? null,
      firedAt: input.firedAt,
      id: idGenerator('reminderDeliveries'),
      providerTaskId: delivery.providerTaskId ?? null,
      reminderId: input.reminderId,
      robotFailedReason: delivery.robotFailedReason ?? null,
      robotMessageId: delivery.robotMessageId ?? null,
      robotStatus: delivery.robotStatus ?? null,
      staffId: delivery.staffId,
      status: delivery.status,
      userId: delivery.userId ?? null,
    }));
    await db.insert(reminderDeliveries).values(values);
  };

  static recordFire = async (
    db: LobeChatDatabase,
    input: ReminderRecordFireInput,
  ): Promise<ReminderItem> => {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(reminders)
        .where(eq(reminders.id, input.reminderId))
        .limit(1);

      if (!existing) {
        throw new Error(`Reminder not found: ${input.reminderId}`);
      }

      const nextStatus: ReminderStatus = input.nextFireAt
        ? 'scheduled'
        : (input.status ?? (existing.repeatRule ? 'expired' : 'sent'));

      const [updated] = await tx
        .update(reminders)
        .set({
          fireAt: input.nextFireAt ?? input.firedAt,
          firedCount: sql`${reminders.firedCount} + 1`,
          lastFiredAt: input.firedAt,
          status: nextStatus,
        })
        .where(and(eq(reminders.id, input.reminderId), eq(reminders.status, 'scheduled')))
        .returning();

      if (!updated) {
        throw new Error(`Reminder not scheduled: ${input.reminderId}`);
      }

      if (input.deliveries.length > 0) {
        const values: NewReminderDelivery[] = input.deliveries.map((delivery) => ({
          failedReason: delivery.failedReason ?? null,
          firedAt: input.firedAt,
          id: idGenerator('reminderDeliveries'),
          providerTaskId: delivery.providerTaskId ?? null,
          reminderId: input.reminderId,
          robotFailedReason: delivery.robotFailedReason ?? null,
          robotMessageId: delivery.robotMessageId ?? null,
          robotStatus: delivery.robotStatus ?? null,
          staffId: delivery.staffId,
          status: delivery.status,
          userId: delivery.userId ?? null,
        }));
        await tx.insert(reminderDeliveries).values(values);
      }

      return updated;
    });
  };

  private attachRecipientsAndCounts = async (
    db: LobeChatDatabase | Transaction,
    rows: ReminderItem[],
  ): Promise<ReminderWithRecipients[]> => {
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const recipientRows = await db
      .select()
      .from(reminderRecipients)
      .where(inArray(reminderRecipients.reminderId, ids));

    const recipientsByReminder = new Map<string, ReminderRecipientItem[]>();
    for (const recipient of recipientRows) {
      const list = recipientsByReminder.get(recipient.reminderId) ?? [];
      list.push(recipient);
      recipientsByReminder.set(recipient.reminderId, list);
    }

    const countRows = await db
      .select({
        count: count(),
        reminderId: reminderDeliveries.reminderId,
        status: reminderDeliveries.status,
      })
      .from(reminderDeliveries)
      .innerJoin(reminders, eq(reminderDeliveries.reminderId, reminders.id))
      .where(
        and(
          inArray(reminderDeliveries.reminderId, ids),
          eq(reminderDeliveries.firedAt, reminders.lastFiredAt),
        ),
      )
      .groupBy(reminderDeliveries.reminderId, reminderDeliveries.status);

    const countsByReminder = new Map<string, ReminderDeliveryCounts>();
    for (const row of countRows) {
      const current = countsByReminder.get(row.reminderId) ?? emptyDeliveryCounts();
      if (row.status === 'sent' || row.status === 'failed' || row.status === 'skipped') {
        current[row.status] = row.count;
      }
      countsByReminder.set(row.reminderId, current);
    }

    return rows.map((row) => ({
      ...row,
      deliveryCounts: countsByReminder.get(row.id) ?? emptyDeliveryCounts(),
      recipients: recipientsByReminder.get(row.id) ?? [],
    }));
  };
}
