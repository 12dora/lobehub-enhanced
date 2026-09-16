// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { messengerAccountLinks, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { resolveDingTalkStaffId } from '@/server/services/messenger/platforms/dingtalk/resolveStaffId';
import { resolveMessengerPlatformBindings } from '@/server/services/messenger/resolveBinding';

import {
  ImConnectorBindingUserNotFoundError,
  ImConnectorPlatformUserAlreadyBoundError,
  listImConnectorBindings,
  removeImConnectorBinding,
  upsertImConnectorBinding,
} from './bindings';

const db: LobeChatDatabase = await getTestDB();

const userA = 'im-bind-a3-admin';
const userB = 'im-bind-a3-alice';
const fixtureUserIds = [userA, userB];

const cleanupFixtureUsers = async () => {
  await db
    .delete(messengerAccountLinks)
    .where(inArray(messengerAccountLinks.userId, fixtureUserIds));
  await db.delete(users).where(inArray(users.id, fixtureUserIds));
};

beforeEach(async () => {
  await cleanupFixtureUsers();
  await db.insert(users).values([
    {
      email: 'admin@jiefakj.com',
      fullName: 'Break Glass',
      id: userA,
      username: 'admin',
    },
    {
      email: 'alice@dingtalk.jiefakj.com',
      fullName: 'Alice',
      id: userB,
      username: 'alice',
    },
  ]);
});

afterEach(async () => {
  await cleanupFixtureUsers();
});

describe('im connector bindings', () => {
  it('upserts a manual DingTalk link for a local account and lists it', async () => {
    const item = await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_breakglass',
      platformUsername: 'Admin',
      userId: userA,
    });

    expect(item).toMatchObject({
      platformUserId: 'staff_breakglass',
      platformUsername: 'Admin',
      source: 'manual',
      userEmail: 'admin@jiefakj.com',
      userId: userA,
      userName: 'Break Glass',
    });

    const listed = await listImConnectorBindings(db, { platform: 'dingtalk' });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.source).toBe('manual');
    expect(listed.items[0]?.userEmail).toBe('admin@jiefakj.com');
  });

  it('filters bound users by q across email and DingTalk user id', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_breakglass',
      userId: userA,
    });
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_alice',
      platformUsername: 'Alice Ding',
      userId: userB,
    });

    await expect(
      listImConnectorBindings(db, { platform: 'dingtalk', q: 'admin@jiefakj' }),
    ).resolves.toMatchObject({
      items: [{ userId: userA }],
    });
    await expect(
      listImConnectorBindings(db, { platform: 'dingtalk', q: 'staff_alice' }),
    ).resolves.toMatchObject({
      items: [{ userId: userB }],
    });
  });

  it('replaces the existing row for the same AIHub user', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_old',
      userId: userA,
    });
    const replaced = await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_new',
      platformUsername: 'New Nick',
      userId: userA,
    });

    expect(replaced.platformUserId).toBe('staff_new');
    expect(replaced.platformUsername).toBe('New Nick');
    expect(replaced.source).toBe('manual');

    const listed = await listImConnectorBindings(db, { platform: 'dingtalk' });
    expect(listed.items).toHaveLength(1);
  });

  it('refuses when the DingTalk user is already bound to another AIHub user', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_shared',
      userId: userB,
    });

    const promise = upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_shared',
      userId: userA,
    });

    await expect(promise).rejects.toBeInstanceOf(ImConnectorPlatformUserAlreadyBoundError);
    await expect(promise).rejects.toMatchObject({
      boundUser: {
        email: 'alice@dingtalk.jiefakj.com',
        id: userB,
        name: 'Alice',
      },
      code: 'PLATFORM_USER_ALREADY_BOUND',
    });
  });

  it('fills platformUsername from an optional DingTalk lookup', async () => {
    const item = await upsertImConnectorBinding(db, {
      lookupStaff: async () => ({ name: 'Corp Alice' }),
      platform: 'dingtalk',
      platformUserId: 'staff_lookup',
      userId: userA,
    });
    expect(item.platformUsername).toBe('Corp Alice');
  });

  it('throws when the AIHub user does not exist', async () => {
    await expect(
      upsertImConnectorBinding(db, {
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        userId: 'missing-user',
      }),
    ).rejects.toBeInstanceOf(ImConnectorBindingUserNotFoundError);
  });

  it('removes a binding', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_breakglass',
      userId: userA,
    });

    await expect(
      removeImConnectorBinding(db, { platform: 'dingtalk', userId: userA }),
    ).resolves.toMatchObject({
      before: { platformUserId: 'staff_breakglass', userId: userA },
      success: true,
    });
    await expect(listImConnectorBindings(db, { platform: 'dingtalk' })).resolves.toEqual({
      items: [],
    });
  });

  it('honours a manual messenger_account_links row in push and availablePlatforms resolution', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_breakglass',
      platformUsername: 'Admin',
      userId: userA,
    });

    await expect(resolveDingTalkStaffId(db, userA)).resolves.toBe('staff_breakglass');
    await expect(resolveMessengerPlatformBindings(db, userA, ['dingtalk'])).resolves.toEqual({
      dingtalk: { linked: true, platformUsername: 'Admin' },
    });
  });
});
