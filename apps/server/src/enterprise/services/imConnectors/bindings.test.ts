// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { messengerAccountLinks, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { resolveDingTalkStaffId } from '@/server/services/messenger/platforms/dingtalk/resolveStaffId';
import { resolveMessengerPlatformBindings } from '@/server/services/messenger/resolveBinding';

import {
  IM_CONNECTOR_BINDINGS_LIST_MAX,
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

const cleanupFixtureUsers = async (extraIds: string[] = []) => {
  const ids = [...fixtureUserIds, ...extraIds];
  await db.delete(messengerAccountLinks).where(inArray(messengerAccountLinks.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
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
  vi.restoreAllMocks();
  await cleanupFixtureUsers();
});

describe('im connector bindings', () => {
  it('upserts a manual DingTalk link for a local account and lists it', async () => {
    const { item } = await upsertImConnectorBinding(db, {
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
    expect(listed).toMatchObject({ hasMore: false, total: 1 });
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
      hasMore: false,
      items: [{ userId: userA }],
      total: 1,
    });
    await expect(
      listImConnectorBindings(db, { platform: 'dingtalk', q: 'staff_alice' }),
    ).resolves.toMatchObject({
      hasMore: false,
      items: [{ userId: userB }],
      total: 1,
    });
  });

  it('replaces the existing row for the same AIHub user and records the previous platformUserId', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_old',
      userId: userA,
    });
    const { beforeDiff, item: replaced } = await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_new',
      platformUsername: 'New Nick',
      userId: userA,
    });

    expect(replaced.platformUserId).toBe('staff_new');
    expect(replaced.platformUsername).toBe('New Nick');
    expect(replaced.source).toBe('manual');
    expect(beforeDiff).toMatchObject({
      displaced: null,
      previousPlatformUserId: 'staff_old',
    });

    const listed = await listImConnectorBindings(db, { platform: 'dingtalk' });
    expect(listed.items).toHaveLength(1);
    expect(listed.total).toBe(1);
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
        boundVia: 'link',
        email: 'alice@dingtalk.jiefakj.com',
        id: userB,
        name: 'Alice',
      },
      code: 'PLATFORM_USER_ALREADY_BOUND',
    });
  });

  it('force-transfers a link row atomically and records the displaced owner', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_shared',
      platformUsername: 'Alice Ding',
      userId: userB,
    });

    const { beforeDiff, item } = await upsertImConnectorBinding(db, {
      force: true,
      platform: 'dingtalk',
      platformUserId: 'staff_shared',
      userId: userA,
    });

    expect(item).toMatchObject({
      platformUserId: 'staff_shared',
      source: 'manual',
      userId: userA,
    });
    expect(beforeDiff).toMatchObject({
      displaced: {
        boundVia: 'link',
        platformUserId: 'staff_shared',
        userEmail: 'alice@dingtalk.jiefakj.com',
        userId: userB,
        userName: 'Alice',
      },
    });

    const listed = await listImConnectorBindings(db, { platform: 'dingtalk' });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.userId).toBe(userA);
    await expect(
      MessengerAccountLinkModel.findByPlatformUser(db, 'dingtalk', 'staff_shared', ''),
    ).resolves.toMatchObject({ userId: userA });
  });

  it('leaves the other row intact when a forced insert fails', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_shared',
      userId: userB,
    });

    await expect(
      upsertImConnectorBinding(db, {
        force: true,
        persistBinding: async () => {
          throw new Error('simulated insert failure');
        },
        platform: 'dingtalk',
        platformUserId: 'staff_shared',
        userId: userA,
      }),
    ).rejects.toThrow('simulated insert failure');

    const listed = await listImConnectorBindings(db, { platform: 'dingtalk' });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      platformUserId: 'staff_shared',
      userId: userB,
    });
  });

  it('refuses when the DingTalk staffId is already bound via identity-email', async () => {
    const promise = upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'alice',
      userId: userA,
    });

    await expect(promise).rejects.toBeInstanceOf(ImConnectorPlatformUserAlreadyBoundError);
    await expect(promise).rejects.toMatchObject({
      boundUser: {
        boundVia: 'identity_email',
        email: 'alice@dingtalk.jiefakj.com',
        id: userB,
        name: 'Alice',
      },
      code: 'PLATFORM_USER_ALREADY_BOUND',
    });
  });

  it('force-allows a manual row over an identity-email mapping; links win inbound, both still push', async () => {
    const { beforeDiff, item } = await upsertImConnectorBinding(db, {
      force: true,
      platform: 'dingtalk',
      platformUserId: 'alice',
      userId: userA,
    });

    expect(item).toMatchObject({ platformUserId: 'alice', userId: userA });
    expect(beforeDiff).toMatchObject({
      displaced: { boundVia: 'identity_email', userId: userB },
    });

    await expect(
      MessengerAccountLinkModel.findByPlatformUser(db, 'dingtalk', 'alice', ''),
    ).resolves.toMatchObject({ userId: userA });
    await expect(resolveDingTalkStaffId(db, userA)).resolves.toBe('alice');
    await expect(resolveDingTalkStaffId(db, userB)).resolves.toBe('alice');
  });

  it('maps a unique-violation race to PLATFORM_USER_ALREADY_BOUND', async () => {
    await upsertImConnectorBinding(db, {
      platform: 'dingtalk',
      platformUserId: 'staff_shared',
      userId: userB,
    });

    const original = MessengerAccountLinkModel.findByPlatformUser;
    vi.spyOn(MessengerAccountLinkModel, 'findByPlatformUser')
      .mockImplementationOnce(async () => undefined)
      .mockImplementation((...args) => original(...args));

    const uniqueError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'messenger_account_links_platform_tenant_user_unique',
    });
    const persistBinding = vi.fn(async () => {
      throw uniqueError;
    });

    await expect(
      upsertImConnectorBinding(db, {
        persistBinding,
        platform: 'dingtalk',
        platformUserId: 'staff_shared',
        userId: userA,
      }),
    ).rejects.toMatchObject({
      boundUser: {
        boundVia: 'link',
        id: userB,
      },
      code: 'PLATFORM_USER_ALREADY_BOUND',
    });
    expect(persistBinding).toHaveBeenCalled();
  });

  it('sets hasMore when more than 200 bindings exist and reports the uncapped total', async () => {
    const extraCount = IM_CONNECTOR_BINDINGS_LIST_MAX + 1;
    const extraIds = Array.from({ length: extraCount }, (_, i) => `im-bind-a3-extra-${i}`);
    try {
      await db.insert(users).values(
        extraIds.map((id, i) => ({
          email: `extra${i}@example.com`,
          id,
          username: `extra${i}`,
        })),
      );
      await db.insert(messengerAccountLinks).values(
        extraIds.map((id, i) => ({
          platform: 'dingtalk',
          platformUserId: `staff_extra_${i}`,
          source: 'auto' as const,
          tenantId: '',
          userId: id,
        })),
      );

      const listed = await listImConnectorBindings(db, { platform: 'dingtalk' });
      expect(listed.items).toHaveLength(IM_CONNECTOR_BINDINGS_LIST_MAX);
      expect(listed.hasMore).toBe(true);
      expect(listed.total).toBe(extraCount);
    } finally {
      await cleanupFixtureUsers(extraIds);
    }
  });

  it('fills platformUsername from an optional DingTalk lookup', async () => {
    const { item } = await upsertImConnectorBinding(db, {
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
      hasMore: false,
      items: [],
      total: 0,
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
