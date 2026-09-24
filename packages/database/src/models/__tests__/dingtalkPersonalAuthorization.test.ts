// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { dingtalkPersonalAuthorizations, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  DingtalkPersonalAuthorizationModel,
  type DingtalkPersonalAuthorizationUpsert,
} from '../dingtalkPersonalAuthorization';
import { isUniqueViolation } from '../platform/pgUniqueViolation';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'dpa-model-user-a';
const userB = 'dpa-model-user-b';
const userC = 'dpa-model-user-c';

const binding = (name: string): DingtalkPersonalAuthorizationUpsert => ({
  corpId: 'dingcorp',
  corpName: '示例公司',
  dingtalkUserName: name,
  profile: 'dingcorp:staff-a',
  staffId: 'staff-a',
});

const reset = async () => {
  await serverDB
    .delete(dingtalkPersonalAuthorizations)
    .where(inArray(dingtalkPersonalAuthorizations.userId, [userA, userB, userC]));
  await serverDB.delete(users).where(inArray(users.id, [userA, userB, userC]));
};

beforeEach(async () => {
  await reset();
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
});

afterEach(reset);

describe('DingtalkPersonalAuthorizationModel', () => {
  it('upserts one active row per user and keeps the id and authorizedAt', async () => {
    const model = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    const first = await model.upsertActive(binding('甲'));
    const second = await model.upsertActive({ ...binding('乙'), corpName: '新公司' });

    expect(first?.id.startsWith('dpa_')).toBe(true);
    expect(second?.id).toBe(first?.id);
    expect(second?.dingtalkUserName).toBe('乙');
    expect(second?.corpName).toBe('新公司');
    expect(second?.status).toBe('active');
    expect(second?.lastErrorCode).toBeNull();
    expect(second?.authorizedAt.toISOString()).toBe(first?.authorizedAt.toISOString());

    const rows = await serverDB
      .select()
      .from(dingtalkPersonalAuthorizations)
      .where(eq(dingtalkPersonalAuthorizations.userId, userA));
    expect(rows).toHaveLength(1);
  });

  it('scopes findMine, markExpired, and markRevoked to the owning user', async () => {
    const modelA = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    const modelB = new DingtalkPersonalAuthorizationModel(serverDB, userB);
    await modelA.upsertActive(binding('甲'));
    await modelB.upsertActive({
      ...binding('乙'),
      profile: 'dingcorp:staff-b',
      staffId: 'staff-b',
    });

    expect((await modelA.findMine())?.staffId).toBe('staff-a');
    expect((await modelB.findMine())?.staffId).toBe('staff-b');

    await modelA.markExpired('NOT_AUTHORIZED');
    expect((await modelA.findMine())?.status).toBe('expired');
    expect((await modelA.findMine())?.lastErrorCode).toBe('NOT_AUTHORIZED');
    expect((await modelB.findMine())?.status).toBe('active');

    await modelB.markRevoked();
    await modelA.markExpired('NOT_AUTHORIZED');
    expect((await modelB.findMine())?.status).toBe('revoked');
    expect(await DingtalkPersonalAuthorizationModel.countActive(serverDB)).toBe(0);
  });

  it('does not reactivate a revoke that happened after the login started', async () => {
    const model = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    await model.upsertActive(binding('甲'));
    await model.markRevoked();
    const blocked = await model.upsertActive(binding('甲'), {
      loginStartedAt: new Date(Date.now() - 60_000),
    });
    expect(blocked).toBeNull();
    expect((await model.findMine())?.status).toBe('revoked');

    const allowed = await model.upsertActive(binding('甲'), {
      loginStartedAt: new Date(Date.now() + 60_000),
    });
    expect(allowed?.status).toBe('active');
    expect(allowed?.lastErrorCode).toBeNull();
  });

  it('refreshes authorizedAt when an expired row becomes active again', async () => {
    const model = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    const first = await model.upsertActive(binding('甲'));
    await model.markExpired('NOT_AUTHORIZED');
    const again = await model.upsertActive(binding('甲'));
    expect(again?.status).toBe('active');
    expect(again?.lastErrorCode).toBeNull();
    expect(again?.id).toBe(first?.id);
    expect(again!.authorizedAt.getTime()).toBeGreaterThanOrEqual(first!.authorizedAt.getTime());
  });

  it('touches lastCheckedAt and skips lastUsedAt inside five minutes', async () => {
    const model = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    await model.upsertActive(binding('甲'));
    const checkedAt = new Date('2026-09-24T01:00:00.000Z');
    await model.touchChecked(checkedAt);
    expect((await model.findMine())?.lastCheckedAt?.toISOString()).toBe(checkedAt.toISOString());

    const firstUsed = new Date('2026-09-24T02:00:00.000Z');
    await model.touchLastUsed(firstUsed);
    await model.touchLastUsed(new Date('2026-09-24T02:04:00.000Z'));
    expect((await model.findMine())?.lastUsedAt?.toISOString()).toBe(firstUsed.toISOString());

    const later = new Date('2026-09-24T02:06:00.000Z');
    await model.touchLastUsed(later);
    expect((await model.findMine())?.lastUsedAt?.toISOString()).toBe(later.toISOString());
  });

  it('counts only active rows', async () => {
    const modelA = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    const modelB = new DingtalkPersonalAuthorizationModel(serverDB, userB);
    await modelA.upsertActive(binding('甲'));
    await modelB.upsertActive({
      ...binding('乙'),
      profile: 'dingcorp:staff-b',
      staffId: 'staff-b',
    });
    await modelB.markExpired('NOT_AUTHORIZED');
    expect(await DingtalkPersonalAuthorizationModel.countActive(serverDB)).toBe(1);
  });

  it('allows one active profile and leaves a revoked row untouched', async () => {
    const modelA = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    const modelB = new DingtalkPersonalAuthorizationModel(serverDB, userB);
    await modelA.upsertActive(binding('甲'));

    await expect(modelB.upsertActive(binding('乙'))).rejects.toSatisfy(isUniqueViolation);
    expect((await modelA.findMine())?.status).toBe('active');
    expect(await modelB.findMine()).toBeNull();

    const revoked = await modelA.markRevoked();
    expect(revoked).toBe(true);
    const stamped = await modelA.findMine();
    expect(await modelA.markRevoked()).toBe(false);
    expect((await modelA.findMine())?.updatedAt.toISOString()).toBe(
      stamped?.updatedAt.toISOString(),
    );

    await modelA.markExpired('NOT_AUTHORIZED');
    await modelA.touchChecked(new Date('2026-09-24T05:00:00.000Z'));
    expect(await modelA.upsertActive(binding('甲'), { onlyIfNotRevoked: true })).toBeNull();
    const after = await modelA.findMine();
    expect(after?.status).toBe('revoked');
    expect(after?.lastErrorCode).toBeNull();
    expect(after?.lastCheckedAt).toBeNull();
    expect(after?.updatedAt.toISOString()).toBe(stamped?.updatedAt.toISOString());

    const taken = await modelB.upsertActive(binding('乙'));
    expect(taken?.status).toBe('active');
    expect(await modelB.hasOtherActiveProfile(binding('乙').profile)).toBe(false);
    expect(await modelA.hasOtherActiveProfile(binding('甲').profile)).toBe(true);
  });

  it('revokes other active and expired rows in one claim, and rolls back a declined claim', async () => {
    await serverDB.insert(users).values({ id: userC });
    const modelA = new DingtalkPersonalAuthorizationModel(serverDB, userA);
    const modelB = new DingtalkPersonalAuthorizationModel(serverDB, userB);
    const modelC = new DingtalkPersonalAuthorizationModel(serverDB, userC);
    await modelA.upsertActive(binding('甲'));
    await serverDB.insert(dingtalkPersonalAuthorizations).values({
      authorizedAt: new Date('2026-09-24T00:00:00.000Z'),
      corpId: 'dingcorp',
      corpName: '示例公司',
      dingtalkUserName: '丙',
      id: 'dpa_model_c',
      profile: binding('甲').profile,
      staffId: 'staff-a',
      status: 'expired',
      userId: userC,
    });
    await modelB.upsertActive({
      ...binding('乙'),
      profile: 'dingcorp:staff-b',
      staffId: 'staff-b',
    });
    await modelB.markRevoked();

    const declined = await modelB.claimActiveProfile(binding('甲'), {
      loginStartedAt: new Date(Date.now() - 60_000),
    });
    expect(declined).toEqual({ displaced: [], row: null });
    expect((await modelA.findMine())?.status).toBe('active');
    expect((await modelC.findMine())?.status).toBe('expired');
    expect((await modelB.findMine())?.status).toBe('revoked');

    const claimed = await modelB.claimActiveProfile(binding('乙'), {
      loginStartedAt: new Date(Date.now() + 60_000),
    });
    expect(claimed.row?.status).toBe('active');
    expect(claimed.row?.userId).toBe(userB);
    expect(claimed.displaced.map((row) => row.userId).sort()).toEqual([userA, userC]);
    expect((await modelA.findMine())?.status).toBe('revoked');
    expect((await modelC.findMine())?.status).toBe('revoked');
    expect(await DingtalkPersonalAuthorizationModel.countActive(serverDB)).toBe(1);
  });
});
