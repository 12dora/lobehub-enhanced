import debug from 'debug';
import { eq } from 'drizzle-orm';

import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { UserModel } from '@/database/models/user';
import { account, dingtalkDirectoryUsers, platformIdentityProviders } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { staffIdFromDingTalkIdentityEmail } from '@/server/services/messenger/platforms/dingtalk/resolveStaffId';

import { dingtalkWorkspaceRequest } from './client';
import { DingtalkWorkspaceError } from './errors';

const log = debug('lobe-server:dingtalk-workspace:identity');

export const DINGTALK_APPROVAL_ADMIN_CACHE_MS = 5 * 60 * 1000;

export type VerifiedDingtalkIdentity = {
  name: string;
  staffId: string;
  unionId: string;
};

export type DingtalkIdentityError = {
  error:
    'DINGTALK_IDENTITY_INACTIVE' | 'DINGTALK_IDENTITY_UNBOUND' | 'DINGTALK_IDENTITY_UNVERIFIED';
};

type DirectoryIdentity = {
  active: boolean;
  name: string;
  staffId: string;
  unionId: string;
};

type AdminCacheEntry = { expiresAt: number; value: boolean };

const adminCache = new Map<string, AdminCacheEntry>();

export const resetDingtalkIdentityCacheForTest = (): void => {
  adminCache.clear();
};

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const loadDingtalkAccountUnionIds = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string[]> => {
  const providers = await db
    .select({ providerKey: platformIdentityProviders.providerKey })
    .from(platformIdentityProviders)
    .where(eq(platformIdentityProviders.type, 'dingtalk'));
  const keys = providers.map((row) => row.providerKey).filter(Boolean);
  if (keys.length === 0) return [];

  const rows = await db
    .select({ accountId: account.accountId, providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));

  const keySet = new Set(keys);
  const unionIds: string[] = [];
  for (const row of rows) {
    if (!keySet.has(row.providerId)) continue;
    const unionId = emptyToNull(row.accountId);
    if (unionId) unionIds.push(unionId);
  }
  return unionIds;
};

const fetchUserGet = async (staffId: string): Promise<DirectoryIdentity | null> => {
  try {
    const result = await dingtalkWorkspaceRequest<{
      active?: boolean;
      name?: string;
      unionid?: string;
      userid?: string;
    }>({
      api: 'legacy',
      body: { language: 'zh_CN', userid: staffId },
      method: 'POST',
      path: '/topapi/v2/user/get',
    });
    const resolvedStaffId = emptyToNull(result.userid) ?? staffId;
    const unionId = emptyToNull(result.unionid);
    if (!unionId) return null;
    return {
      active: result.active !== false,
      name: emptyToNull(result.name) ?? resolvedStaffId,
      staffId: resolvedStaffId,
      unionId,
    };
  } catch (error) {
    log('topapi/v2/user/get failed: %O', error instanceof Error ? error.name : 'UnknownError');
    return null;
  }
};

const fromDirectoryRow = (row: {
  active: boolean;
  name: string;
  staffId: string;
  unionId: string | null;
}): DirectoryIdentity | null => {
  const unionId = emptyToNull(row.unionId);
  if (!unionId) return null;
  return {
    active: row.active,
    name: row.name,
    staffId: row.staffId,
    unionId,
  };
};

const resolveDirectoryIdentity = async (
  db: LobeChatDatabase,
  token: string,
): Promise<DirectoryIdentity | null> => {
  const value = token.trim();
  if (!value) return null;
  const directory = new DingTalkDirectoryModel(db);

  const byStaff = await directory.getUsers([value]);
  if (byStaff[0]) {
    const mapped = fromDirectoryRow(byStaff[0]);
    if (mapped) return mapped;
    const live = await fetchUserGet(byStaff[0].staffId);
    if (live) return { ...live, active: byStaff[0].active && live.active };
  }

  const [byUnion] = await db
    .select()
    .from(dingtalkDirectoryUsers)
    .where(eq(dingtalkDirectoryUsers.unionId, value))
    .limit(1);
  if (byUnion) {
    const mapped = fromDirectoryRow(byUnion);
    if (mapped) return mapped;
  }

  return fetchUserGet(value);
};

const uniqueStaffIds = (identities: DirectoryIdentity[]): string[] => {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const identity of identities) {
    if (seen.has(identity.staffId)) continue;
    seen.add(identity.staffId);
    ids.push(identity.staffId);
  }
  return ids;
};

/**
 * Trusted DingTalk identity for `userId`.
 *
 * Trusted: `users.dingtalk_user_id`, Better Auth DingTalk account `accountId`
 * (unionId), and a `messenger_account_links` row with `source !== 'manual'`
 * (robot-conversation auto-link delivers DingTalk `senderStaffId`).
 *
 * Untrusted: admin manual binds and identity-email local-part inference.
 */
export const resolveVerifiedDingtalkIdentity = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<DingtalkIdentityError | VerifiedDingtalkIdentity> => {
  const user = await UserModel.findById(db, userId);
  if (!user) return { error: 'DINGTALK_IDENTITY_UNBOUND' };

  const trustedTokens: string[] = [];
  const dingtalkUserId = emptyToNull(user.dingtalkUserId);
  if (dingtalkUserId) trustedTokens.push(dingtalkUserId);

  try {
    trustedTokens.push(...(await loadDingtalkAccountUnionIds(db, userId)));
  } catch (error) {
    log('load dingtalk accounts failed: %s', error instanceof Error ? error.name : 'UnknownError');
  }

  const link = await new MessengerAccountLinkModel(db, userId).findByPlatform('dingtalk', '');
  const hasManualLink = link?.source === 'manual' && Boolean(emptyToNull(link.platformUserId));
  if (link && link.source !== 'manual') {
    const staffId = emptyToNull(link.platformUserId);
    if (staffId) trustedTokens.push(staffId);
  }

  const emailStaffId = staffIdFromDingTalkIdentityEmail(user.email ?? null);
  const hasEmailInference = Boolean(emailStaffId);

  const resolved: DirectoryIdentity[] = [];
  const seenTokens = new Set<string>();
  for (const token of trustedTokens) {
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);
    const identity = await resolveDirectoryIdentity(db, token);
    if (identity) resolved.push(identity);
  }

  if (resolved.length === 0) {
    if (trustedTokens.length > 0) return { error: 'DINGTALK_IDENTITY_INACTIVE' };
    if (hasManualLink || hasEmailInference) return { error: 'DINGTALK_IDENTITY_UNVERIFIED' };
    return { error: 'DINGTALK_IDENTITY_UNBOUND' };
  }

  const staffIds = uniqueStaffIds(resolved);
  if (staffIds.length > 1) return { error: 'DINGTALK_IDENTITY_UNVERIFIED' };

  const identity = resolved.find((row) => row.staffId === staffIds[0]) ?? resolved[0]!;
  if (!identity.active) return { error: 'DINGTALK_IDENTITY_INACTIVE' };
  if (!identity.unionId) return { error: 'DINGTALK_IDENTITY_INACTIVE' };

  return { name: identity.name, staffId: identity.staffId, unionId: identity.unionId };
};

export const requireVerifiedDingtalkIdentity = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<VerifiedDingtalkIdentity> => {
  const result = await resolveVerifiedDingtalkIdentity(db, userId);
  if ('error' in result) throw new DingtalkWorkspaceError(result.error);
  return result;
};

/**
 * True iff GET /v1.0/workflow/processes/managements/templates?userId= succeeds.
 * 5 minute in-process cache.
 */
export const isDingtalkApprovalAdmin = async (staffId: string): Promise<boolean> => {
  const id = staffId.trim();
  if (!id) return false;
  const now = Date.now();
  const cached = adminCache.get(id);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    await dingtalkWorkspaceRequest({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/processes/managements/templates',
      query: { userId: id },
    });
    adminCache.set(id, { expiresAt: now + DINGTALK_APPROVAL_ADMIN_CACHE_MS, value: true });
    return true;
  } catch (error) {
    const code = error instanceof DingtalkWorkspaceError ? error.code : undefined;
    if (code === 'DINGTALK_FORBIDDEN' || code === 'DINGTALK_NOT_FOUND') {
      adminCache.set(id, { expiresAt: now + DINGTALK_APPROVAL_ADMIN_CACHE_MS, value: false });
      return false;
    }
    log('isDingtalkApprovalAdmin failed: %O', error instanceof Error ? error.name : 'UnknownError');
    return false;
  }
};
