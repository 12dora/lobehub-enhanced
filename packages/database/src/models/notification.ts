import { and, count, desc, eq, inArray, lt, or } from 'drizzle-orm';

import type {
  NewNotification,
  NewNotificationDelivery,
  NotificationDeliveryItem,
  NotificationItem,
} from '../schemas/notification';
import { notificationDeliveries, notifications } from '../schemas/notification';
import type { LobeChatDatabase } from '../type';

export class NotificationModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private ownership = () => eq(notifications.userId, this.userId);

  async list(
    opts: { category?: string; cursor?: string; limit?: number; unreadOnly?: boolean } = {},
  ) {
    const { cursor, limit = 20, category, unreadOnly } = opts;

    const conditions = [this.ownership(), eq(notifications.isArchived, false)];

    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    if (category) {
      conditions.push(eq(notifications.category, category));
    }

    if (cursor) {
      const cursorRow = await this.db
        .select({ createdAt: notifications.createdAt, id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.id, cursor), this.ownership()))
        .limit(1);

      if (cursorRow[0]) {
        // Composite cursor to handle identical createdAt timestamps
        const { createdAt: cursorTime, id: cursorId } = cursorRow[0];
        conditions.push(
          or(
            lt(notifications.createdAt, cursorTime),
            and(eq(notifications.createdAt, cursorTime), lt(notifications.id, cursorId)),
          )!,
        );
      }
    }

    return this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit);
  }

  async getUnreadCount(): Promise<number> {
    const [result] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(this.ownership(), eq(notifications.isRead, false), eq(notifications.isArchived, false)),
      );

    return result?.count ?? 0;
  }

  async markAsRead(ids: string[]) {
    if (ids.length === 0) return;

    return this.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(this.ownership(), inArray(notifications.id, ids)));
  }

  async markAllAsRead() {
    return this.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(
        and(this.ownership(), eq(notifications.isRead, false), eq(notifications.isArchived, false)),
      );
  }

  async archive(id: string) {
    return this.db
      .update(notifications)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(eq(notifications.id, id), this.ownership()));
  }

  async archiveAll() {
    return this.db
      .update(notifications)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(this.ownership(), eq(notifications.isArchived, false)));
  }

  // ─── Write-side (used by NotificationService in cloud) ─────────

  async create(data: Omit<NewNotification, 'userId'>) {
    const [result] = await this.db
      .insert(notifications)
      .values({ ...data, userId: this.userId })
      .onConflictDoNothing({
        target: [notifications.userId, notifications.dedupeKey],
      })
      .returning();

    return result ?? null;
  }

  async createDelivery(data: NewNotificationDelivery) {
    const [result] = await this.db.insert(notificationDeliveries).values(data).returning();

    return result;
  }

  async findByDedupeKey(dedupeKey: string): Promise<NotificationItem | null> {
    if (!dedupeKey) return null;

    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(this.ownership(), eq(notifications.dedupeKey, dedupeKey)))
      .limit(1);

    return row ?? null;
  }

  /**
   * Insert a notification and its deliveries in one transaction.
   * On `(userId, dedupeKey)` conflict the notification insert is skipped and
   * `{ notification: null, deliveries: [] }` is returned (caller should treat
   * that as already-notified).
   */
  async createWithDeliveries(
    data: Omit<NewNotification, 'userId'>,
    deliveries: Omit<NewNotificationDelivery, 'notificationId'>[] = [],
  ): Promise<{ deliveries: NotificationDeliveryItem[]; notification: NotificationItem | null }> {
    return this.db.transaction(async (tx) => {
      const [notification] = await tx
        .insert(notifications)
        .values({ ...data, userId: this.userId })
        .onConflictDoNothing({
          target: [notifications.userId, notifications.dedupeKey],
        })
        .returning();

      if (!notification) return { deliveries: [], notification: null };
      if (deliveries.length === 0) return { deliveries: [], notification };

      const rows = await tx
        .insert(notificationDeliveries)
        .values(deliveries.map((d) => ({ ...d, notificationId: notification.id })))
        .returning();

      return { deliveries: rows, notification };
    });
  }

  async updateDeliveryStatus(
    id: string,
    patch: {
      failedReason?: string | null;
      providerMessageId?: string | null;
      sentAt?: Date | null;
      status: NotificationDeliveryItem['status'];
    },
  ): Promise<NotificationDeliveryItem | null> {
    const [result] = await this.db
      .update(notificationDeliveries)
      .set(patch)
      .where(eq(notificationDeliveries.id, id))
      .returning();

    return result ?? null;
  }
}
