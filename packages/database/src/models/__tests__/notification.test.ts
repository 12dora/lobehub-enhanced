import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { NotificationModel } from '../../models/notification';
import { notificationDeliveries, notifications } from '../../schemas/notification';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

describe('NotificationModel', () => {
  const returning = vi.fn();
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn((_payload?: unknown) => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const db = { insert } as unknown as LobeChatDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    returning.mockResolvedValue([{ id: 'notification-1' }]);
  });

  describe('create', () => {
    it('creates user-scoped notifications without persisting workspace context', async () => {
      const model = new NotificationModel(db, 'user-1');

      await model.create({
        category: 'workspace',
        content: 'You have been removed from the workspace.',
        dedupeKey: 'member_removed_workspace-1_user-1',
        title: 'Removed from workspace',
        type: 'workspace_member_removed',
      });

      const [payload] = values.mock.calls[0];

      expect(payload).toMatchObject({
        dedupeKey: 'member_removed_workspace-1_user-1',
        userId: 'user-1',
      });
      expect(payload).not.toHaveProperty('workspaceId');
      expect(onConflictDoNothing).toHaveBeenCalledWith({
        target: [notifications.userId, notifications.dedupeKey],
      });
    });
  });
});

// ─── Integration tests against a real PGlite database ─────────────
const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'notification-user';
const otherUserId = 'notification-other-user';

const baseNotification = (overrides: Record<string, unknown> = {}) => ({
  category: 'workspace',
  content: 'You have a new notification.',
  title: 'New notification',
  type: 'workspace_member_added',
  ...overrides,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('NotificationModel (integration)', () => {
  describe('create', () => {
    it('creates a user-scoped notification and returns the row', async () => {
      const model = new NotificationModel(serverDB, userId);

      const result = await model.create(baseNotification({ dedupeKey: 'dedupe-1' }));

      expect(result).not.toBeNull();
      expect(result!.id).toBeDefined();
      expect(result!.userId).toBe(userId);
      expect(result!.isRead).toBe(false);
      expect(result!.isArchived).toBe(false);
      expect(result!.dedupeKey).toBe('dedupe-1');
    });

    it('returns null on dedupe conflict (same userId + dedupeKey)', async () => {
      const model = new NotificationModel(serverDB, userId);

      const first = await model.create(baseNotification({ dedupeKey: 'dup-key' }));
      expect(first).not.toBeNull();

      const second = await model.create(
        baseNotification({ dedupeKey: 'dup-key', title: 'Second attempt' }),
      );
      expect(second).toBeNull();

      const rows = await model.list();
      expect(rows).toHaveLength(1);
    });

    it('allows duplicate creates when dedupeKey is null', async () => {
      const model = new NotificationModel(serverDB, userId);

      const first = await model.create(baseNotification());
      const second = await model.create(baseNotification());

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();

      const rows = await model.list();
      expect(rows).toHaveLength(2);
    });

    it('does not conflict across different users with the same dedupeKey', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);

      const a = await model.create(baseNotification({ dedupeKey: 'shared' }));
      const b = await otherModel.create(baseNotification({ dedupeKey: 'shared' }));

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });
  });

  describe('list', () => {
    it('returns only the current user notifications, newest first', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);

      const older = await model.create(baseNotification({ title: 'Older' }));
      // ensure a distinct, later createdAt
      await new Promise((resolve) => setTimeout(resolve, 5));
      const newer = await model.create(baseNotification({ title: 'Newer' }));
      await otherModel.create(baseNotification({ title: 'Other user' }));

      const rows = await model.list();

      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe(newer!.id);
      expect(rows[1].id).toBe(older!.id);
    });

    it('excludes archived notifications', async () => {
      const model = new NotificationModel(serverDB, userId);
      const kept = await model.create(baseNotification({ title: 'Kept' }));
      const archived = await model.create(baseNotification({ title: 'Archived' }));

      await model.archive(archived!.id);

      const rows = await model.list();
      expect(rows.map((r) => r.id)).toEqual([kept!.id]);
    });

    it('filters by unreadOnly', async () => {
      const model = new NotificationModel(serverDB, userId);
      const read = await model.create(baseNotification({ title: 'Read' }));
      const unread = await model.create(baseNotification({ title: 'Unread' }));

      await model.markAsRead([read!.id]);

      const rows = await model.list({ unreadOnly: true });
      expect(rows.map((r) => r.id)).toEqual([unread!.id]);
    });

    it('filters by category', async () => {
      const model = new NotificationModel(serverDB, userId);
      await model.create(baseNotification({ category: 'workspace', title: 'WS' }));
      const budget = await model.create(baseNotification({ category: 'budget', title: 'Budget' }));

      const rows = await model.list({ category: 'budget' });
      expect(rows.map((r) => r.id)).toEqual([budget!.id]);
    });

    it('respects the limit option', async () => {
      const model = new NotificationModel(serverDB, userId);
      await model.create(baseNotification({ title: 'A' }));
      await model.create(baseNotification({ title: 'B' }));
      await model.create(baseNotification({ title: 'C' }));

      const rows = await model.list({ limit: 2 });
      expect(rows).toHaveLength(2);
    });

    it('paginates with a cursor', async () => {
      const model = new NotificationModel(serverDB, userId);
      const first = await model.create(baseNotification({ title: '1' }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await model.create(baseNotification({ title: '2' }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      const third = await model.create(baseNotification({ title: '3' }));

      const page1 = await model.list({ limit: 1 });
      expect(page1.map((r) => r.id)).toEqual([third!.id]);

      const page2 = await model.list({ cursor: third!.id, limit: 1 });
      expect(page2.map((r) => r.id)).toEqual([second!.id]);

      const page3 = await model.list({ cursor: second!.id, limit: 1 });
      expect(page3.map((r) => r.id)).toEqual([first!.id]);
    });

    it('ignores a cursor that does not belong to the user', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);
      await model.create(baseNotification({ title: 'Mine' }));
      const otherRow = await otherModel.create(baseNotification({ title: 'Theirs' }));

      // cursor belongs to another user → cursor condition is skipped, all own rows returned
      const rows = await model.list({ cursor: otherRow!.id });
      expect(rows).toHaveLength(1);
    });

    it('returns an empty array when the user has no notifications', async () => {
      const model = new NotificationModel(serverDB, userId);
      expect(await model.list()).toEqual([]);
    });
  });

  describe('getUnreadCount', () => {
    it('counts only unread, non-archived notifications for the user', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);

      const read = await model.create(baseNotification({ title: 'Read' }));
      await model.create(baseNotification({ title: 'Unread 1' }));
      await model.create(baseNotification({ title: 'Unread 2' }));
      const archived = await model.create(baseNotification({ title: 'Archived' }));
      await otherModel.create(baseNotification({ title: 'Other' }));

      await model.markAsRead([read!.id]);
      await model.archive(archived!.id);

      expect(await model.getUnreadCount()).toBe(2);
    });

    it('returns 0 when there are no notifications', async () => {
      const model = new NotificationModel(serverDB, userId);
      expect(await model.getUnreadCount()).toBe(0);
    });
  });

  describe('markAsRead', () => {
    it('marks the given notifications as read', async () => {
      const model = new NotificationModel(serverDB, userId);
      const a = await model.create(baseNotification({ title: 'A' }));
      const b = await model.create(baseNotification({ title: 'B' }));

      await model.markAsRead([a!.id]);

      const rows = await model.list();
      const aRow = rows.find((r) => r.id === a!.id);
      const bRow = rows.find((r) => r.id === b!.id);
      expect(aRow!.isRead).toBe(true);
      expect(bRow!.isRead).toBe(false);
    });

    it('returns early (no-op) for an empty id list', async () => {
      const model = new NotificationModel(serverDB, userId);
      await model.create(baseNotification({ title: 'A' }));

      const result = await model.markAsRead([]);
      expect(result).toBeUndefined();
      expect(await model.getUnreadCount()).toBe(1);
    });

    it('does not mark notifications owned by another user', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);
      const otherRow = await otherModel.create(baseNotification({ title: 'Theirs' }));

      await model.markAsRead([otherRow!.id]);

      expect(await otherModel.getUnreadCount()).toBe(1);
    });
  });

  describe('markAllAsRead', () => {
    it('marks all unread notifications for the user as read', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);
      await model.create(baseNotification({ title: 'A' }));
      await model.create(baseNotification({ title: 'B' }));
      await otherModel.create(baseNotification({ title: 'Other' }));

      await model.markAllAsRead();

      expect(await model.getUnreadCount()).toBe(0);
      expect(await otherModel.getUnreadCount()).toBe(1);
    });
  });

  describe('archive', () => {
    it('archives a single notification owned by the user', async () => {
      const model = new NotificationModel(serverDB, userId);
      const row = await model.create(baseNotification({ title: 'A' }));

      await model.archive(row!.id);

      const [persisted] = await serverDB
        .select()
        .from(notifications)
        .where(eq(notifications.id, row!.id));
      expect(persisted.isArchived).toBe(true);
    });

    it('does not archive a notification owned by another user', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);
      const otherRow = await otherModel.create(baseNotification({ title: 'Theirs' }));

      await model.archive(otherRow!.id);

      const [persisted] = await serverDB
        .select()
        .from(notifications)
        .where(eq(notifications.id, otherRow!.id));
      expect(persisted.isArchived).toBe(false);
    });
  });

  describe('archiveAll', () => {
    it('archives all non-archived notifications for the user', async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);
      await model.create(baseNotification({ title: 'A' }));
      await model.create(baseNotification({ title: 'B' }));
      await otherModel.create(baseNotification({ title: 'Other' }));

      await model.archiveAll();

      expect(await model.list()).toEqual([]);
      expect(await otherModel.list()).toHaveLength(1);
    });
  });

  describe('createDelivery', () => {
    it('creates a delivery row for a notification', async () => {
      const model = new NotificationModel(serverDB, userId);
      const notification = await model.create(baseNotification({ title: 'A' }));

      const delivery = await model.createDelivery({
        channel: 'email',
        notificationId: notification!.id,
        providerMessageId: 'resend-123',
        sentAt: new Date(),
        status: 'sent',
      });

      expect(delivery.id).toBeDefined();
      expect(delivery.notificationId).toBe(notification!.id);
      expect(delivery.channel).toBe('email');
      expect(delivery.status).toBe('sent');

      const [persisted] = await serverDB
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, delivery.id));
      expect(persisted.providerMessageId).toBe('resend-123');
    });
  });

  describe('findByDedupeKey', () => {
    it('returns the row for the current user', async () => {
      const model = new NotificationModel(serverDB, userId);
      const created = await model.create(baseNotification({ dedupeKey: 'task:1:done:t1' }));

      const found = await model.findByDedupeKey('task:1:done:t1');
      expect(found?.id).toBe(created!.id);
    });

    it("does not return another user's row with the same key", async () => {
      const model = new NotificationModel(serverDB, userId);
      const otherModel = new NotificationModel(serverDB, otherUserId);
      await otherModel.create(baseNotification({ dedupeKey: 'shared-key' }));

      expect(await model.findByDedupeKey('shared-key')).toBeNull();
    });
  });

  describe('createWithDeliveries', () => {
    it('inserts the notification and delivery rows together', async () => {
      const model = new NotificationModel(serverDB, userId);

      const { notification, deliveries } = await model.createWithDeliveries(
        baseNotification({ dedupeKey: 'with-deliveries' }),
        [{ channel: 'inbox', status: 'sent', sentAt: new Date() }],
      );

      expect(notification).not.toBeNull();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].channel).toBe('inbox');
      expect(deliveries[0].notificationId).toBe(notification!.id);
    });

    it('returns null on dedupe conflict and writes no extra deliveries', async () => {
      const model = new NotificationModel(serverDB, userId);
      await model.createWithDeliveries(baseNotification({ dedupeKey: 'dup-del' }), [
        { channel: 'inbox', status: 'sent' },
      ]);

      const second = await model.createWithDeliveries(
        baseNotification({ dedupeKey: 'dup-del', title: 'Second' }),
        [{ channel: 'dingtalk', status: 'sent' }],
      );

      expect(second.notification).toBeNull();
      expect(second.deliveries).toEqual([]);

      const rows = await serverDB
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.channel, 'dingtalk'));
      expect(rows).toHaveLength(0);
    });
  });

  describe('updateDeliveryStatus', () => {
    it('patches status and failedReason', async () => {
      const model = new NotificationModel(serverDB, userId);
      const notification = await model.create(baseNotification({ title: 'A' }));
      const delivery = await model.createDelivery({
        channel: 'dingtalk',
        notificationId: notification!.id,
        status: 'pending',
      });

      const updated = await model.updateDeliveryStatus(delivery.id, {
        failedReason: 'timeout',
        status: 'failed',
      });

      expect(updated?.status).toBe('failed');
      expect(updated?.failedReason).toBe('timeout');
    });
  });
});
