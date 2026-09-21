// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  dingtalkApprovalRuleRuns,
  dingtalkApprovalRules,
} from '../../schemas/dingtalkApprovalRule';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import type { DingtalkApprovalRuleCreateInput } from '../dingtalkApprovalRule';
import {
  DingtalkApprovalRuleEnableBlockedError,
  DingtalkApprovalRuleModel,
  quotaNotifyTaskId,
  RUN_CLAIM_IN_PROGRESS,
} from '../dingtalkApprovalRule';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'dar-model-owner';
const otherUserId = 'dar-model-other';
const model = new DingtalkApprovalRuleModel(serverDB, userId);
const otherModel = new DingtalkApprovalRuleModel(serverDB, otherUserId);

const conditions = { match: 'all' as const };

const createSample = (overrides: Partial<DingtalkApprovalRuleCreateInput> = {}) =>
  model.create({
    action: 'agree',
    conditions,
    name: '自动同意请假',
    processCode: 'PROC-LEAVE',
    processName: '请假审批',
    staffId: 'staff_hyq_a',
    ...overrides,
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'wang@example.com', fullName: '王工', id: userId, username: 'wang' },
    { email: 'other@example.com', fullName: '别人', id: otherUserId, username: 'other' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('DingtalkApprovalRuleModel', () => {
  describe('create / findById / list / countActive', () => {
    it('creates a user-scoped rule and lists enabled rules newest first', async () => {
      const first = await createSample({ name: '较早' });
      const second = await createSample({ name: '较晚', processCode: 'PROC-EXPENSE' });

      expect(first.id).toMatch(/^dar_/);
      expect(first.enabled).toBe(true);
      expect(first.userId).toBe(userId);
      expect(first.dailyCount).toBe(0);

      const found = await model.findById(first.id);
      expect(found?.name).toBe('较早');
      expect(await otherModel.findById(first.id)).toBeNull();

      const listed = await model.list();
      expect(listed.map((row) => row.id)).toEqual([second.id, first.id]);
      expect(await otherModel.list()).toHaveLength(0);
      await expect(model.countActive()).resolves.toBe(2);
    });

    it('hides disabled rules unless includeDisabled is set', async () => {
      const created = await createSample();
      await model.update(created.id, { enabled: false });

      await expect(model.list()).resolves.toHaveLength(0);
      const all = await model.list({ includeDisabled: true });
      expect(all).toHaveLength(1);
      expect(all[0].disabledReason).toBe('user');
      await expect(model.countActive()).resolves.toBe(0);
    });
  });

  describe('update / delete', () => {
    it('updates only the owner rule and throws for another user', async () => {
      const created = await createSample();
      const updated = await model.update(created.id, { name: '改名', remark: 'ok' });
      expect(updated.name).toBe('改名');
      expect(updated.remark).toBe('ok');

      const other = await otherModel.create({
        action: 'refuse',
        conditions,
        name: '别人的规则',
        processCode: 'PROC-OTHER',
        processName: '其他',
        staffId: 'staff_x',
      });
      await expect(model.update(other.id, { name: '劫持' })).rejects.toThrow(/not found/);
    });

    it('owner enable is a CAS that cannot clear an admin stop or an expired rule', async () => {
      const created = await createSample();
      await model.update(created.id, { enabled: false });
      const reenabled = await model.update(created.id, { enabled: true });
      expect(reenabled.enabled).toBe(true);
      expect(reenabled.disabledReason).toBeNull();

      await DingtalkApprovalRuleModel.adminDisable(serverDB, created.id);
      await expect(model.update(created.id, { enabled: true })).rejects.toBeInstanceOf(
        DingtalkApprovalRuleEnableBlockedError,
      );
      const [adminStopped] = await serverDB
        .select()
        .from(dingtalkApprovalRules)
        .where(eq(dingtalkApprovalRules.id, created.id));
      expect(adminStopped.enabled).toBe(false);
      expect(adminStopped.disabledReason).toBe('admin');

      const expired = await createSample({
        expiresAt: new Date(Date.now() - 60_000),
        name: '已过期',
        processCode: 'PROC-EXPIRED-ENABLE',
      });
      await model.update(expired.id, { enabled: false });
      await expect(model.update(expired.id, { enabled: true })).rejects.toMatchObject({
        blocked: 'expired',
        name: 'DingtalkApprovalRuleEnableBlockedError',
      });
      const [stillExpired] = await serverDB
        .select()
        .from(dingtalkApprovalRules)
        .where(eq(dingtalkApprovalRules.id, expired.id));
      expect(stillExpired.enabled).toBe(false);
      expect(stillExpired.disabledReason).toBe('user');
    });

    it('deletes only the owner rule and cascades runs', async () => {
      const created = await createSample();
      await DingtalkApprovalRuleModel.recordRun(serverDB, {
        action: 'agree',
        processInstanceId: 'inst-1',
        ruleId: created.id,
        status: 'succeeded',
        taskId: 'task-1',
        userId,
      });

      await expect(model.delete(created.id)).resolves.toBe(true);
      await expect(model.findById(created.id)).resolves.toBeNull();
      const runs = await serverDB.select().from(dingtalkApprovalRuleRuns);
      expect(runs).toHaveLength(0);

      const other = await otherModel.create({
        action: 'agree',
        conditions,
        name: 'other',
        processCode: 'PROC-OTHER',
        processName: '其他',
        staffId: 'staff_x',
      });
      await expect(model.delete(other.id)).resolves.toBe(false);
      expect(await otherModel.findById(other.id)).not.toBeNull();
    });
  });

  describe('listRuns / recordRun', () => {
    it('records a run once per (rule, task) and lists newest first', async () => {
      const created = await createSample();
      const inserted = await DingtalkApprovalRuleModel.recordRun(serverDB, {
        action: 'agree',
        processInstanceId: 'inst-1',
        ruleId: created.id,
        status: 'succeeded',
        taskId: 'task-1',
        userId,
      });
      const duplicate = await DingtalkApprovalRuleModel.recordRun(serverDB, {
        action: 'agree',
        processInstanceId: 'inst-1',
        ruleId: created.id,
        status: 'failed',
        taskId: 'task-1',
        userId,
      });
      const later = await DingtalkApprovalRuleModel.recordRun(serverDB, {
        action: 'agree',
        processInstanceId: 'inst-2',
        ruleId: created.id,
        status: 'skipped_quota',
        taskId: 'task-2',
        userId,
      });

      expect(inserted).toBe(true);
      expect(duplicate).toBe(false);
      expect(later).toBe(true);

      const listed = await model.listRuns(created.id);
      expect(listed).toHaveLength(2);
      expect(listed[0].id).toMatch(/^darr_/);
      expect(listed.map((row) => row.taskId)).toEqual(['task-2', 'task-1']);
      expect(listed[0].status).toBe('skipped_quota');

      expect(await otherModel.listRuns(created.id)).toEqual([]);
    });

    it('hides the synthetic quota-notify row from listRuns', async () => {
      const created = await createSample();
      await expect(
        DingtalkApprovalRuleModel.tryRecordQuotaNotify(serverDB, {
          action: 'agree',
          date: '2026-09-21',
          ruleId: created.id,
          userId,
        }),
      ).resolves.toBe(true);
      await expect(
        DingtalkApprovalRuleModel.tryRecordQuotaNotify(serverDB, {
          action: 'agree',
          date: '2026-09-21',
          ruleId: created.id,
          userId,
        }),
      ).resolves.toBe(false);

      await DingtalkApprovalRuleModel.recordRun(serverDB, {
        action: 'agree',
        processInstanceId: 'inst-1',
        ruleId: created.id,
        status: 'succeeded',
        taskId: 'task-real',
        userId,
      });

      const listed = await model.listRuns(created.id);
      expect(listed.map((row) => row.taskId)).toEqual(['task-real']);
      expect(listed.some((row) => row.taskId === quotaNotifyTaskId('2026-09-21'))).toBe(false);
    });

    it('claims with IN_PROGRESS and reclaims a stale in-progress row', async () => {
      const created = await createSample();
      await expect(
        DingtalkApprovalRuleModel.claimRun(serverDB, {
          action: 'agree',
          processInstanceId: 'inst-claim',
          ruleId: created.id,
          status: 'failed',
          taskId: 'task-claim',
          userId,
        }),
      ).resolves.toBe('inserted');

      await expect(
        DingtalkApprovalRuleModel.claimRun(serverDB, {
          action: 'agree',
          processInstanceId: 'inst-claim',
          ruleId: created.id,
          status: 'failed',
          taskId: 'task-claim',
          userId,
        }),
      ).resolves.toBe(false);

      const [claimed] = await serverDB.select().from(dingtalkApprovalRuleRuns);
      expect(claimed).toMatchObject({
        errorCode: RUN_CLAIM_IN_PROGRESS,
        status: 'failed',
        taskId: 'task-claim',
      });

      const now = new Date(Date.now() + 11 * 60 * 1000);
      await expect(
        DingtalkApprovalRuleModel.reclaimStaleRun(serverDB, {
          now,
          ruleId: created.id,
          taskId: 'task-claim',
        }),
      ).resolves.toBe(true);
      await expect(
        DingtalkApprovalRuleModel.reclaimStaleRun(serverDB, {
          now,
          ruleId: created.id,
          taskId: 'task-claim',
        }),
      ).resolves.toBe(false);

      await DingtalkApprovalRuleModel.updateRun(serverDB, {
        errorCode: 'DINGTALK_FORBIDDEN',
        ruleId: created.id,
        status: 'failed',
        taskId: 'task-claim',
      });
      await expect(
        DingtalkApprovalRuleModel.reclaimStaleRun(serverDB, {
          now: new Date(now.getTime() + 11 * 60 * 1000),
          ruleId: created.id,
          taskId: 'task-claim',
        }),
      ).resolves.toBe(false);
    });

    it('updates a claimed run status and can delete it for retry', async () => {
      const created = await createSample();
      await expect(
        DingtalkApprovalRuleModel.recordRun(serverDB, {
          action: 'comment',
          errorCode: RUN_CLAIM_IN_PROGRESS,
          processInstanceId: 'inst-claim',
          ruleId: created.id,
          status: 'failed',
          taskId: 'task-claim',
          userId,
        }),
      ).resolves.toBe(true);

      await expect(
        DingtalkApprovalRuleModel.updateRun(serverDB, {
          ruleId: created.id,
          status: 'succeeded',
          taskId: 'task-claim',
        }),
      ).resolves.toBe(true);

      const [updated] = await model.listRuns(created.id);
      expect(updated.status).toBe('succeeded');
      expect(updated.errorCode).toBeNull();

      await expect(
        DingtalkApprovalRuleModel.updateRun(serverDB, {
          errorCode: 'DINGTALK_UNAVAILABLE',
          ruleId: created.id,
          status: 'failed',
          taskId: 'task-claim',
        }),
      ).resolves.toBe(false);
      const [stillSucceeded] = await model.listRuns(created.id);
      expect(stillSucceeded).toMatchObject({ errorCode: null, status: 'succeeded' });

      await expect(
        DingtalkApprovalRuleModel.deleteRun(serverDB, {
          ruleId: created.id,
          taskId: 'task-claim',
        }),
      ).resolves.toBe(true);
      expect(await model.listRuns(created.id)).toEqual([]);

      await expect(
        DingtalkApprovalRuleModel.recordRun(serverDB, {
          action: 'comment',
          processInstanceId: 'inst-claim',
          ruleId: created.id,
          status: 'succeeded',
          taskId: 'task-claim',
          userId,
        }),
      ).resolves.toBe(true);
    });

    it('refuses updateRun unless the row is still IN_PROGRESS', async () => {
      const created = await createSample();
      await DingtalkApprovalRuleModel.recordRun(serverDB, {
        action: 'agree',
        errorCode: RUN_CLAIM_IN_PROGRESS,
        processInstanceId: 'inst-cas',
        ruleId: created.id,
        status: 'failed',
        taskId: 'task-cas',
        userId,
      });
      await expect(
        DingtalkApprovalRuleModel.updateRun(serverDB, {
          ruleId: created.id,
          status: 'succeeded',
          taskId: 'task-cas',
        }),
      ).resolves.toBe(true);
      await expect(
        DingtalkApprovalRuleModel.updateRun(serverDB, {
          errorCode: 'DINGTALK_FORBIDDEN',
          ruleId: created.id,
          status: 'failed',
          taskId: 'task-cas',
        }),
      ).resolves.toBe(false);
    });
  });

  describe('bumpDailyCount / disable / adminDisable / truncateExpiry / listAllActiveRules / adminList', () => {
    it('resets the daily counter when the date changes', async () => {
      const created = await createSample();
      await expect(
        DingtalkApprovalRuleModel.bumpDailyCount(serverDB, created.id, '2026-09-21'),
      ).resolves.toBe(1);
      await expect(
        DingtalkApprovalRuleModel.bumpDailyCount(serverDB, created.id, '2026-09-21'),
      ).resolves.toBe(2);
      await expect(
        DingtalkApprovalRuleModel.bumpDailyCount(serverDB, created.id, '2026-09-22'),
      ).resolves.toBe(1);

      const [row] = await serverDB
        .select()
        .from(dingtalkApprovalRules)
        .where(eq(dingtalkApprovalRules.id, created.id));
      expect(row.dailyCountDate).toBe('2026-09-22');
      expect(row.lastRunAt).toBeInstanceOf(Date);
    });

    it('reserves up to cap atomically and can roll back a same-day increment', async () => {
      const created = await createSample();
      await expect(
        DingtalkApprovalRuleModel.bumpDailyCount(serverDB, created.id, '2026-09-21', { cap: 20 }),
      ).resolves.toBe(1);
      for (let i = 0; i < 19; i += 1) {
        await DingtalkApprovalRuleModel.bumpDailyCount(serverDB, created.id, '2026-09-21', {
          cap: 20,
        });
      }
      await expect(
        DingtalkApprovalRuleModel.bumpDailyCount(serverDB, created.id, '2026-09-21', { cap: 20 }),
      ).resolves.toBeNull();

      const [atCap] = await serverDB
        .select()
        .from(dingtalkApprovalRules)
        .where(eq(dingtalkApprovalRules.id, created.id));
      expect(atCap.dailyCount).toBe(20);

      await expect(
        DingtalkApprovalRuleModel.rollbackDailyCount(serverDB, created.id, '2026-09-21'),
      ).resolves.toBe(19);
      await expect(
        DingtalkApprovalRuleModel.bumpDailyCount(serverDB, created.id, '2026-09-21', { cap: 20 }),
      ).resolves.toBe(20);
      await expect(
        DingtalkApprovalRuleModel.rollbackDailyCount(serverDB, created.id, '2026-09-22'),
      ).resolves.toBe(20);
    });

    it('disables by reason and adminDisable uses admin', async () => {
      const created = await createSample();
      const disabled = await DingtalkApprovalRuleModel.disable(serverDB, created.id, 'tier_off');
      expect(disabled?.enabled).toBe(false);
      expect(disabled?.disabledReason).toBe('tier_off');

      const other = await createSample({ name: 'second' });
      const admin = await DingtalkApprovalRuleModel.adminDisable(serverDB, other.id);
      expect(admin?.disabledReason).toBe('admin');
      expect(admin?.enabled).toBe(false);
    });

    it('truncates missing or far expiries and lists only active rules', async () => {
      const now = Date.now();
      const maxExpiresAt = new Date(now + 90 * 24 * 60 * 60 * 1000);
      const farAt = new Date(now + 200 * 24 * 60 * 60 * 1000);
      const nearAt = new Date(now + 10 * 24 * 60 * 60 * 1000);
      const expiredAt = new Date(now - 24 * 60 * 60 * 1000);

      const none = await createSample({ name: 'none', expiresAt: null });
      const far = await createSample({
        expiresAt: farAt,
        name: 'far',
        processCode: 'PROC-FAR',
      });
      const near = await createSample({
        expiresAt: nearAt,
        name: 'near',
        processCode: 'PROC-NEAR',
      });
      const expired = await createSample({
        expiresAt: expiredAt,
        name: 'expired',
        processCode: 'PROC-OLD',
      });
      await DingtalkApprovalRuleModel.disable(serverDB, expired.id, 'expired');

      const affected = await DingtalkApprovalRuleModel.truncateExpiry(serverDB, maxExpiresAt);
      expect(affected.map((row) => row.id).sort()).toEqual([none.id, far.id].sort());
      expect(affected.every((row) => row.expiresAt?.getTime() === maxExpiresAt.getTime())).toBe(
        true,
      );

      const atCap = await DingtalkApprovalRuleModel.listRulesAtOrOverMaxExpiry(
        serverDB,
        maxExpiresAt,
      );
      expect(atCap.map((row) => row.id).sort()).toEqual([none.id, far.id].sort());

      const laterCap = new Date(maxExpiresAt.getTime() + 1000);
      const atCapLater = await DingtalkApprovalRuleModel.listRulesAtOrOverMaxExpiry(
        serverDB,
        laterCap,
      );
      expect(atCapLater.map((row) => row.id)).toEqual(expect.arrayContaining([none.id, far.id]));

      const [nearRow] = await serverDB
        .select()
        .from(dingtalkApprovalRules)
        .where(eq(dingtalkApprovalRules.id, near.id));
      expect(nearRow.expiresAt).toEqual(nearAt);

      const active = await DingtalkApprovalRuleModel.listAllActiveRules(serverDB);
      expect(active.map((row) => row.id).sort()).toEqual([none.id, far.id, near.id].sort());
    });

    it('joins user display name/email and filters by q with pagination', async () => {
      await createSample({ name: '请假自动同意' });
      await otherModel.create({
        action: 'comment',
        conditions,
        name: '报销备注',
        processCode: 'PROC-EXPENSE',
        processName: '报销审批',
        staffId: 'staff_x',
      });

      const page1 = await DingtalkApprovalRuleModel.adminList(serverDB, { page: 1, pageSize: 1 });
      expect(page1.total).toBe(2);
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]).toMatchObject({
        userDisplayName: expect.any(String),
        userEmail: expect.any(String),
      });

      const filtered = await DingtalkApprovalRuleModel.adminList(serverDB, { q: '王工' });
      expect(filtered.total).toBe(1);
      expect(filtered.items[0].userEmail).toBe('wang@example.com');
      expect(filtered.items[0].name).toBe('请假自动同意');
    });
  });
});
