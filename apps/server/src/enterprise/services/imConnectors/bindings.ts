import type { SQL } from 'drizzle-orm';
import { and, count, desc, eq, or, sql } from 'drizzle-orm';

import { buildUserSearchConditions } from '@/database/models/adminUserSearch';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { UserModel } from '@/database/models/user';
import { likeContains } from '@/database/repositories/platformSearch';
import { messengerAccountLinks, users } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

import type {
  AdminImConnectorBindingItem,
  AdminImConnectorBindingsListInput,
  ImConnectorPlatform,
} from '../../contracts/adminImConnectors';

/** DingTalk is a global-token bot; `messenger_account_links.tenant_id` is `''`. */
export const IM_CONNECTOR_BINDING_TENANT_ID = '';

export const IM_CONNECTOR_BINDINGS_LIST_MAX = 200;

export const PLATFORM_USER_ALREADY_BOUND = 'PLATFORM_USER_ALREADY_BOUND';

export interface BoundImConnectorUser {
  email: string | null;
  id: string;
  name: string | null;
}

export class ImConnectorPlatformUserAlreadyBoundError extends Error {
  readonly boundUser: BoundImConnectorUser;
  readonly code = PLATFORM_USER_ALREADY_BOUND;

  constructor(boundUser: BoundImConnectorUser) {
    super(PLATFORM_USER_ALREADY_BOUND);
    this.boundUser = boundUser;
    this.name = 'ImConnectorPlatformUserAlreadyBoundError';
  }
}

export class ImConnectorBindingUserNotFoundError extends Error {
  readonly code = 'PLATFORM_NOT_FOUND' as const;
  readonly userId: string;

  constructor(userId: string) {
    super('PLATFORM_NOT_FOUND');
    this.name = 'ImConnectorBindingUserNotFoundError';
    this.userId = userId;
  }
}

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const displayName = (user: {
  fullName?: string | null;
  username?: string | null;
}): string | null => emptyToNull(user.fullName) ?? emptyToNull(user.username);

const toBindingItem = (row: {
  createdAt: Date;
  platformUserId: string;
  platformUsername: string | null;
  source: string | null;
  userEmail: string | null;
  userFullName: string | null;
  userId: string;
  userUsername: string | null;
}): AdminImConnectorBindingItem => ({
  createdAt: row.createdAt.toISOString(),
  platformUserId: row.platformUserId,
  platformUsername: row.platformUsername,
  source: row.source === 'manual' ? 'manual' : 'auto',
  userEmail: row.userEmail,
  userId: row.userId,
  userName: displayName({ fullName: row.userFullName, username: row.userUsername }),
});

const bindingSearchCondition = (q: string): SQL => {
  const contains = likeContains(q.trim().toLowerCase());
  return or(
    buildUserSearchConditions(q),
    sql`lower(${messengerAccountLinks.platformUserId}) LIKE ${contains} ESCAPE '\\'`,
    sql`lower(${coalesceUsername()}) LIKE ${contains} ESCAPE '\\'`,
  )!;
};

const coalesceUsername = () => sql`coalesce(${messengerAccountLinks.platformUsername}, '')`;

export const countImConnectorLinkedUsers = async (
  db: LobeChatDatabase | Transaction,
  platform: string,
): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(messengerAccountLinks)
    .where(eq(messengerAccountLinks.platform, platform));
  return Number(row?.value ?? 0);
};

/**
 * Bound users already counted on the connector card (`linkedUsers`) — same
 * `messenger_account_links` rows, joined to AIHub users for admin display.
 */
export const listImConnectorBindings = async (
  db: LobeChatDatabase | Transaction,
  input: AdminImConnectorBindingsListInput,
): Promise<{ items: AdminImConnectorBindingItem[] }> => {
  const q = input.q?.trim();
  const conditions: SQL[] = [eq(messengerAccountLinks.platform, input.platform)];
  if (q) conditions.push(bindingSearchCondition(q));

  const rows = await db
    .select({
      createdAt: messengerAccountLinks.createdAt,
      platformUserId: messengerAccountLinks.platformUserId,
      platformUsername: messengerAccountLinks.platformUsername,
      source: messengerAccountLinks.source,
      userEmail: users.email,
      userFullName: users.fullName,
      userId: messengerAccountLinks.userId,
      userUsername: users.username,
    })
    .from(messengerAccountLinks)
    .innerJoin(users, eq(messengerAccountLinks.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(messengerAccountLinks.createdAt), desc(messengerAccountLinks.userId))
    .limit(IM_CONNECTOR_BINDINGS_LIST_MAX);

  return { items: rows.map(toBindingItem) };
};

const loadBindingItem = async (
  db: LobeChatDatabase | Transaction,
  platform: ImConnectorPlatform,
  userId: string,
): Promise<AdminImConnectorBindingItem | undefined> => {
  const [row] = await db
    .select({
      createdAt: messengerAccountLinks.createdAt,
      platformUserId: messengerAccountLinks.platformUserId,
      platformUsername: messengerAccountLinks.platformUsername,
      source: messengerAccountLinks.source,
      userEmail: users.email,
      userFullName: users.fullName,
      userId: messengerAccountLinks.userId,
      userUsername: users.username,
    })
    .from(messengerAccountLinks)
    .innerJoin(users, eq(messengerAccountLinks.userId, users.id))
    .where(
      and(
        eq(messengerAccountLinks.platform, platform),
        eq(messengerAccountLinks.tenantId, IM_CONNECTOR_BINDING_TENANT_ID),
        eq(messengerAccountLinks.userId, userId),
      ),
    )
    .limit(1);
  return row ? toBindingItem(row) : undefined;
};

export const upsertImConnectorBinding = async (
  db: LobeChatDatabase | Transaction,
  params: {
    lookupStaff?: (staffId: string) => Promise<{ name: string | null } | null>;
    platform: ImConnectorPlatform;
    platformUserId: string;
    platformUsername?: string | null;
    userId: string;
  },
): Promise<AdminImConnectorBindingItem> => {
  const user = await UserModel.findById(db, params.userId);
  if (!user) throw new ImConnectorBindingUserNotFoundError(params.userId);

  const platformUserId = params.platformUserId.trim();
  let platformUsername = emptyToNull(params.platformUsername);

  if (params.lookupStaff) {
    try {
      const contact = await params.lookupStaff(platformUserId);
      if (contact && !platformUsername) platformUsername = emptyToNull(contact.name);
    } catch (error) {
      console.error('[admin.imConnectors.bindings.upsert] staff lookup failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  const owned = await MessengerAccountLinkModel.findByPlatformUser(
    db,
    params.platform,
    platformUserId,
    IM_CONNECTOR_BINDING_TENANT_ID,
  );
  if (owned && owned.userId !== params.userId) {
    const other = await UserModel.findById(db, owned.userId);
    throw new ImConnectorPlatformUserAlreadyBoundError({
      email: other?.email ?? null,
      id: owned.userId,
      name: displayName({ fullName: other?.fullName, username: other?.username }),
    });
  }

  const now = new Date();
  const existingForUser = await new MessengerAccountLinkModel(db, params.userId).findByPlatform(
    params.platform,
    IM_CONNECTOR_BINDING_TENANT_ID,
  );

  if (existingForUser) {
    await db
      .update(messengerAccountLinks)
      .set({
        platformUserId,
        platformUsername,
        source: 'manual',
        updatedAt: now,
      })
      .where(eq(messengerAccountLinks.id, existingForUser.id));
  } else {
    await db.insert(messengerAccountLinks).values({
      platform: params.platform,
      platformUserId,
      platformUsername,
      source: 'manual',
      tenantId: IM_CONNECTOR_BINDING_TENANT_ID,
      userId: params.userId,
      workspaceId: null,
    });
  }

  const item = await loadBindingItem(db, params.platform, params.userId);
  if (!item) throw new Error('IM connector binding upsert could not resolve the final row');
  return item;
};

export const removeImConnectorBinding = async (
  db: LobeChatDatabase | Transaction,
  params: { platform: ImConnectorPlatform; userId: string },
): Promise<{ before: AdminImConnectorBindingItem | null; success: true }> => {
  const before = (await loadBindingItem(db, params.platform, params.userId)) ?? null;
  await new MessengerAccountLinkModel(db, params.userId).deleteByPlatform(
    params.platform,
    IM_CONNECTOR_BINDING_TENANT_ID,
  );
  return { before, success: true };
};
