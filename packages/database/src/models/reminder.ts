import { and, count, desc, eq, inArray, lte } from 'drizzle-orm';

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
  recipients: ReminderRecipientInput[];
  repeatRule?: ReminderRepeatRule | null;
  source?: ReminderSource;
  timezone?: string;
  topicId?: string | null;
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
  firedAt: Date;
  id: string;
  reminderId: string;
  status: ReminderDeliveryStatus;
}

export interface ReminderFireDeliveryInput {
  failedReason?: string | null;
  providerTaskId?: string | null;
  staffId: string;
  status: ReminderDeliveryStatus;
  userId?: string | null;
}

export interface ReminderRecordFireInput {
  deliveries: ReminderFireDeliveryInput[];
  firedAt: Date;
  nextFireAt: Date | null;
  reminderId: string;
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

  create = async (input: ReminderCreateInput): Promise<ReminderWithRecipients> => {
    return this.db.transaction(async (tx) => {
      const id = idGenerator('reminders');
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
          source: input.source ?? 'tool',
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
    });
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
        firedAt: reminderDeliveries.firedAt,
        id: reminderDeliveries.id,
        reminderId: reminderDeliveries.reminderId,
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

  hideReceived = async (deliveryId: string, staffId: string): Promise<void> => {
    await this.db
      .update(reminderDeliveries)
      .set({ hiddenByRecipient: true })
      .where(and(eq(reminderDeliveries.id, deliveryId), eq(reminderDeliveries.staffId, staffId)));
  };

  static listDue = async (
    db: LobeChatDatabase,
    now: Date,
    limit = DEFAULT_DUE_LIMIT,
  ): Promise<ReminderItem[]> => {
    return db
      .select()
      .from(reminders)
      .where(and(eq(reminders.status, 'scheduled'), lte(reminders.fireAt, now)))
      .orderBy(reminders.fireAt, reminders.id)
      .limit(clampLimit(limit, DEFAULT_DUE_LIMIT));
  };

  static recordFire = async (
    db: LobeChatDatabase,
    input: ReminderRecordFireInput,
  ): Promise<ReminderItem> => {
    return db.transaction(async (tx) => {
      if (input.deliveries.length > 0) {
        const values: NewReminderDelivery[] = input.deliveries.map((delivery) => ({
          failedReason: delivery.failedReason ?? null,
          firedAt: input.firedAt,
          id: idGenerator('reminderDeliveries'),
          providerTaskId: delivery.providerTaskId ?? null,
          reminderId: input.reminderId,
          staffId: delivery.staffId,
          status: delivery.status,
          userId: delivery.userId ?? null,
        }));
        await tx.insert(reminderDeliveries).values(values);
      }

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
        : existing.repeatRule
          ? 'expired'
          : 'sent';

      const [updated] = await tx
        .update(reminders)
        .set({
          fireAt: input.nextFireAt ?? existing.fireAt,
          firedCount: existing.firedCount + 1,
          lastFiredAt: input.firedAt,
          status: nextStatus,
        })
        .where(eq(reminders.id, input.reminderId))
        .returning();

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
