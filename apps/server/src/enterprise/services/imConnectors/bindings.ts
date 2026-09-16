import type { SQL } from 'drizzle-orm';
import { and, count, desc, eq, or, sql } from 'drizzle-orm';

import { buildUserSearchConditions } from '@/database/models/adminUserSearch';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { UserModel } from '@/database/models/user';
import { likeContains } from '@/database/repositories/platformSearch';
import { messengerAccountLinks, users } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { buildDingTalkIdentityEmail } from '@/server/services/messenger/platforms/dingtalk/const';
import { staffIdFromDingTalkIdentityEmail } from '@/server/services/messenger/platforms/dingtalk/resolveStaffId';

import type {
  AdminImConnectorBindingItem,
  AdminImConnectorBindingsListInput,
  AdminImConnectorBindingsListOutput,
  ImConnectorBindingBoundVia,
  ImConnectorBindingSource,
  ImConnectorPlatform,
} from '../../contracts/adminImConnectors';

/** DingTalk is a global-token bot; `messenger_account_links.tenant_id` is `''`. */
export const IM_CONNECTOR_BINDING_TENANT_ID = '';

export const IM_CONNECTOR_BINDINGS_LIST_MAX = 200;

export const PLATFORM_USER_ALREADY_BOUND = 'PLATFORM_USER_ALREADY_BOUND';

/**
 * Unique index that maps one IM identity `(platform, tenant, platformUserId)`
 * to a single LobeHub user. Races on this constraint are mapped to
 * `PLATFORM_USER_ALREADY_BOUND` (same idea as `MessengerAccountLinkConflictError`
 * in `packages/database/src/models/messengerAccountLink.ts`).
 */
const PLATFORM_TENANT_USER_UNIQUE = 'messenger_account_links_platform_tenant_user_unique';

export interface BoundImConnectorUser {
  boundVia: ImConnectorBindingBoundVia;
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

// Type alias (not interface): audit `beforeDiff` is typed `Record<string, unknown>`, and only
// aliases are assignable to an index-signature type.
export type ImConnectorBindingUpsertBeforeDiff = {
  displaced: {
    boundVia: ImConnectorBindingBoundVia;
    platformUserId: string | null;
    platformUsername: string | null;
    source: ImConnectorBindingSource | null;
    userEmail: string | null;
    userId: string;
    userName: string | null;
  } | null;
  previousPlatformUserId: string | null;
  previousPlatformUsername: string | null;
  previousSource: ImConnectorBindingSource | null;
};

export interface ImConnectorBindingUpsertResult {
  beforeDiff: ImConnectorBindingUpsertBeforeDiff | null;
  item: AdminImConnectorBindingItem;
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

const toBindingSource = (source: string | null | undefined): ImConnectorBindingSource =>
  source === 'manual' ? 'manual' : 'auto';

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
  source: toBindingSource(row.source),
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

const inTransaction = async <T>(
  db: LobeChatDatabase | Transaction,
  fn: (tx: LobeChatDatabase | Transaction) => Promise<T>,
): Promise<T> => {
  const client = db as LobeChatDatabase;
  return client.transaction((tx) => fn(tx));
};

const isPlatformUserUniqueViolation = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (!current || typeof current !== 'object') break;
    const candidate = current as {
      cause?: unknown;
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    const code = String(candidate.code ?? '');
    const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : undefined;
    const message =
      typeof candidate.message === 'string'
        ? candidate.message
        : current instanceof Error
          ? current.message
          : '';
    if (code === '23505' || constraint === PLATFORM_TENANT_USER_UNIQUE) return true;
    if (message.includes(PLATFORM_TENANT_USER_UNIQUE) || message.includes('23505')) return true;
    current = candidate.cause;
  }
  return false;
};

const boundUserFromRow = (
  user: {
    email?: string | null;
    fullName?: string | null;
    id: string;
    username?: string | null;
  },
  boundVia: ImConnectorBindingBoundVia,
): BoundImConnectorUser => ({
  boundVia,
  email: user.email ?? null,
  id: user.id,
  name: displayName({ fullName: user.fullName, username: user.username }),
});

/**
 * AIHub user whose identity mailbox local-part is this DingTalk staffId
 * (`<staffId>@DINGTALK_IDENTITY_EMAIL_DOMAIN`). Same lookup as provision.
 */
const findUserBoundByDingTalkIdentityEmail = async (
  db: LobeChatDatabase | Transaction,
  staffId: string,
) => {
  const email = buildDingTalkIdentityEmail(staffId);
  const exact = await UserModel.findByEmail(db, email);
  const user =
    exact ??
    (await db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email.toLowerCase()}`,
    }));
  if (!user) return undefined;
  const mapped = staffIdFromDingTalkIdentityEmail(user.email);
  if (!mapped || mapped.toLowerCase() !== staffId.toLowerCase()) return undefined;
  return user;
};

const throwAlreadyBound = async (
  db: LobeChatDatabase | Transaction,
  params: { boundVia: ImConnectorBindingBoundVia; userId: string },
): Promise<never> => {
  const other = await UserModel.findById(db, params.userId);
  throw new ImConnectorPlatformUserAlreadyBoundError(
    boundUserFromRow(
      {
        email: other?.email,
        fullName: other?.fullName,
        id: params.userId,
        username: other?.username,
      },
      params.boundVia,
    ),
  );
};

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
): Promise<AdminImConnectorBindingsListOutput> => {
  const q = input.q?.trim();
  const conditions: SQL[] = [eq(messengerAccountLinks.platform, input.platform)];
  if (q) conditions.push(bindingSearchCondition(q));
  const where = and(...conditions);

  const [countRow, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(messengerAccountLinks)
      .innerJoin(users, eq(messengerAccountLinks.userId, users.id))
      .where(where)
      .then((result) => result[0]),
    db
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
      .where(where)
      .orderBy(desc(messengerAccountLinks.createdAt), desc(messengerAccountLinks.userId))
      .limit(IM_CONNECTOR_BINDINGS_LIST_MAX),
  ]);

  const total = Number(countRow?.value ?? 0);
  return {
    hasMore: total > IM_CONNECTOR_BINDINGS_LIST_MAX,
    items: rows.map(toBindingItem),
    total,
  };
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

const persistManualBinding = async (
  db: LobeChatDatabase | Transaction,
  params: {
    existingForUserId?: string;
    platform: ImConnectorPlatform;
    platformUserId: string;
    platformUsername: string | null;
    userId: string;
  },
): Promise<void> => {
  const now = new Date();
  if (params.existingForUserId) {
    await db
      .update(messengerAccountLinks)
      .set({
        platformUserId: params.platformUserId,
        platformUsername: params.platformUsername,
        source: 'manual',
        updatedAt: now,
      })
      .where(eq(messengerAccountLinks.id, params.existingForUserId));
    return;
  }

  await db.insert(messengerAccountLinks).values({
    platform: params.platform,
    platformUserId: params.platformUserId,
    platformUsername: params.platformUsername,
    source: 'manual',
    tenantId: IM_CONNECTOR_BINDING_TENANT_ID,
    userId: params.userId,
    workspaceId: null,
  });
};

export const upsertImConnectorBinding = async (
  db: LobeChatDatabase | Transaction,
  params: {
    force?: boolean;
    lookupStaff?: (staffId: string) => Promise<{ name: string | null } | null>;
    persistBinding?: (tx: LobeChatDatabase | Transaction) => Promise<void>;
    platform: ImConnectorPlatform;
    platformUserId: string;
    platformUsername?: string | null;
    userId: string;
  },
): Promise<ImConnectorBindingUpsertResult> => {
  const force = params.force === true;
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

  return inTransaction(db, async (tx) => {
    const user = await UserModel.findById(tx, params.userId);
    if (!user) throw new ImConnectorBindingUserNotFoundError(params.userId);

    const owned = await MessengerAccountLinkModel.findByPlatformUser(
      tx,
      params.platform,
      platformUserId,
      IM_CONNECTOR_BINDING_TENANT_ID,
    );
    const identityOwner =
      params.platform === 'dingtalk'
        ? await findUserBoundByDingTalkIdentityEmail(tx, platformUserId)
        : undefined;

    const occupant: { boundVia: ImConnectorBindingBoundVia; userId: string } | undefined =
      owned && owned.userId !== params.userId
        ? { boundVia: 'link', userId: owned.userId }
        : identityOwner && identityOwner.id !== params.userId
          ? { boundVia: 'identity_email', userId: identityOwner.id }
          : undefined;

    if (!force && occupant) {
      await throwAlreadyBound(tx, occupant);
    }

    const existingForUser = await new MessengerAccountLinkModel(tx, params.userId).findByPlatform(
      params.platform,
      IM_CONNECTOR_BINDING_TENANT_ID,
    );

    let displaced: ImConnectorBindingUpsertBeforeDiff['displaced'] = null;
    if (occupant) {
      const other = await UserModel.findById(tx, occupant.userId);
      displaced = {
        boundVia: occupant.boundVia,
        platformUserId: occupant.boundVia === 'link' && owned ? owned.platformUserId : platformUserId,
        platformUsername:
          occupant.boundVia === 'link' && owned ? (owned.platformUsername ?? null) : null,
        source: occupant.boundVia === 'link' && owned ? toBindingSource(owned.source) : null,
        userEmail: other?.email ?? null,
        userId: occupant.userId,
        userName: displayName({ fullName: other?.fullName, username: other?.username }),
      };
    }

    const beforeDiff: ImConnectorBindingUpsertBeforeDiff | null =
      displaced || existingForUser
        ? {
            displaced,
            previousPlatformUserId: existingForUser?.platformUserId ?? null,
            previousPlatformUsername: existingForUser?.platformUsername ?? null,
            previousSource: existingForUser ? toBindingSource(existingForUser.source) : null,
          }
        : null;

    if (force && occupant?.boundVia === 'link' && owned) {
      await new MessengerAccountLinkModel(tx, owned.userId).deleteByPlatform(
        params.platform,
        IM_CONNECTOR_BINDING_TENANT_ID,
      );
    }

    try {
      if (params.persistBinding) {
        await params.persistBinding(tx);
      } else {
        await persistManualBinding(tx, {
          existingForUserId: existingForUser?.id,
          platform: params.platform,
          platformUserId,
          platformUsername,
          userId: params.userId,
        });
      }
    } catch (error) {
      if (isPlatformUserUniqueViolation(error)) {
        const winner = await MessengerAccountLinkModel.findByPlatformUser(
          tx,
          params.platform,
          platformUserId,
          IM_CONNECTOR_BINDING_TENANT_ID,
        );
        if (winner && winner.userId !== params.userId) {
          await throwAlreadyBound(tx, { boundVia: 'link', userId: winner.userId });
        }
      }
      throw error;
    }

    const item = await loadBindingItem(tx, params.platform, params.userId);
    if (!item) throw new Error('IM connector binding upsert could not resolve the final row');
    return { beforeDiff, item };
  });
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
