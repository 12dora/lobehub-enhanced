// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { notifications } from '../../schemas/notification';
import { reminderDeliveries, reminders } from '../../schemas/reminder';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import type { ReminderCreateInput } from '../reminder';
import { ReminderModel } from '../reminder';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'reminder-model-owner';
const otherUserId = 'reminder-model-other';
const model = new ReminderModel(serverDB, userId);
const otherModel = new ReminderModel(serverDB, otherUserId);

const fireAt = new Date('2026-09-17T01:00:00.000Z');
const laterFireAt = new Date('2026-09-18T01:00:00.000Z');

const createSample = (overrides: Partial<ReminderCreateInput> = {}) =>
  model.create({
    content: '交安全报告',
    creatorName: '王工',
    fireAt,
    recipients: [
      {
        deptName: '安环部',
        deptPath: '捷发 / 安环部',
        displayName: '胡玉琴A',
        kind: 'user',
        staffId: 'staff_hyq_a',
      },
    ],
    ...overrides,
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ReminderModel', () => {
  describe('create / listCreated', () => {
    it('creates a reminder with recipients and lists newest fire_at first', async () => {
      const later = await createSample({ content: 'later', fireAt: laterFireAt });
      const sooner = await createSample({ content: 'sooner', fireAt });

      expect(later.id).toMatch(/^rmd_/);
      expect(later.recipients).toHaveLength(1);
      expect(later.deliveryCounts).toEqual({ failed: 0, sent: 0, skipped: 0 });

      const listed = await model.listCreated();
      expect(listed.map((row) => row.id)).toEqual([later.id, sooner.id]);
      expect(listed[0].recipients[0]).toMatchObject({
        displayName: '胡玉琴A',
        kind: 'user',
        staffId: 'staff_hyq_a',
      });

      const otherListed = await otherModel.listCreated();
      expect(otherListed).toHaveLength(0);
    });

    it('filters listCreated by status', async () => {
      const created = await createSample();
      await model.cancel(created.id);
      await createSample({ content: 'still scheduled', fireAt: laterFireAt });

      const scheduled = await model.listCreated({ status: 'scheduled' });
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].content).toBe('still scheduled');
    });
  });

  describe('cancel', () => {
    it('cancels only the owner reminder', async () => {
      const created = await createSample();
      const canceled = await model.cancel(created.id);
      expect(canceled.status).toBe('canceled');
      expect(canceled.canceledAt).toBeInstanceOf(Date);

      const other = await otherModel.create({
        content: 'other',
        creatorName: '别人',
        fireAt,
        recipients: [{ displayName: 'x', kind: 'user', staffId: 'staff_x' }],
      });

      await expect(model.cancel(other.id)).rejects.toThrow(/not found/);
      const [unchanged] = await serverDB.select().from(reminders).where(eq(reminders.id, other.id));
      expect(unchanged.status).toBe('scheduled');
    });
  });

  describe('listDue / recordFire / listReceived / hideReceived', () => {
    it('lists due scheduled reminders', async () => {
      await createSample();
      await createSample({ content: 'future', fireAt: new Date('2030-01-01T00:00:00.000Z') });

      const due = await ReminderModel.listDue(serverDB, new Date('2026-09-17T02:00:00.000Z'), 10);
      expect(due).toHaveLength(1);
      expect(due[0].content).toBe('交安全报告');
    });

    it('records a one-shot fire as sent with deliveries and no inbox notification', async () => {
      const created = await createSample();
      const firedAt = new Date('2026-09-17T01:00:01.000Z');

      const updated = await ReminderModel.recordFire(serverDB, {
        deliveries: [
          { staffId: 'staff_hyq_a', status: 'sent', providerTaskId: 'task-1' },
          { failedReason: 'timeout', staffId: 'staff_other', status: 'failed' },
        ],
        firedAt,
        nextFireAt: null,
        reminderId: created.id,
      });

      expect(updated.status).toBe('sent');
      expect(updated.firedCount).toBe(1);
      expect(updated.lastFiredAt).toEqual(firedAt);

      const listed = await model.listCreated();
      expect(listed[0].deliveryCounts).toEqual({ failed: 1, sent: 1, skipped: 0 });

      const received = await model.listReceived({ staffId: 'staff_hyq_a' });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        content: '交安全报告',
        creatorName: '王工',
        reminderId: created.id,
        status: 'sent',
      });
      expect(received[0].id).toMatch(/^rmdl_/);

      const inbox = await serverDB.select().from(notifications);
      expect(inbox).toHaveLength(0);

      await model.hideReceived(received[0].id, 'staff_hyq_a');
      await expect(model.listReceived({ staffId: 'staff_hyq_a' })).resolves.toHaveLength(0);

      const [delivery] = await serverDB
        .select()
        .from(reminderDeliveries)
        .where(eq(reminderDeliveries.id, received[0].id));
      expect(delivery.hiddenByRecipient).toBe(true);
    });

    it('keeps a recurring reminder scheduled when nextFireAt is provided', async () => {
      const created = await createSample({
        repeatRule: { freq: 'weekly', time: '09:00', weekdays: [3] },
      });
      const next = new Date('2026-09-24T01:00:00.000Z');

      const updated = await ReminderModel.recordFire(serverDB, {
        deliveries: [{ staffId: 'staff_hyq_a', status: 'sent' }],
        firedAt: fireAt,
        nextFireAt: next,
        reminderId: created.id,
      });

      expect(updated.status).toBe('scheduled');
      expect(updated.fireAt).toEqual(next);
      expect(updated.firedCount).toBe(1);
    });

    it('marks a recurring reminder expired when nextFireAt is null', async () => {
      const created = await createSample({
        repeatRule: { freq: 'daily', time: '09:00', until: '2026-09-17' },
      });

      const updated = await ReminderModel.recordFire(serverDB, {
        deliveries: [
          { staffId: 'staff_hyq_a', status: 'skipped', failedReason: 'notify_app_not_configured' },
        ],
        firedAt: fireAt,
        nextFireAt: null,
        reminderId: created.id,
      });

      expect(updated.status).toBe('expired');
    });
  });
});
