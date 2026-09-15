import debug from 'debug';
import { sql } from 'drizzle-orm';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { UserModel } from '@/database/models/user';
import type { UserItem } from '@/database/schemas';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { buildDingTalkIdentityEmail } from './const';

const log = debug('lobe-server:messenger:dingtalk:provision');

export const DINGTALK_LEGACY_TOKEN_URL = 'https://oapi.dingtalk.com/gettoken';
export const DINGTALK_USER_GET_URL = 'https://oapi.dingtalk.com/topapi/v2/user/get';
export const DINGTALK_PROVISION_LOCK_TTL_SECONDS = 30;
export const DINGTALK_PROVISION_LOCK_WAIT_MS = 50;
export const DINGTALK_PROVISION_LOCK_RETRIES = 8;
export const DINGTALK_PROVISION_RATE_LIMIT_MAX = 30;
export const DINGTALK_PROVISION_RATE_WINDOW_MS = 60_000;
export const DINGTALK_PROVISION_RATE_KEY = 'messenger:dingtalk:provision-rate';
export const DINGTALK_LEGACY_TOKEN_CACHE_MS = 55 * 60 * 1000;

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

interface LegacyTokenCache {
  expiresAt: number;
  token: string;
}

interface MemoryLock {
  expiresAt: number;
}

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

const legacyTokenCache = new Map<string, LegacyTokenCache>();
const memoryLocks = new Map<string, MemoryLock>();
const memoryRate: RateLimitEntry = { count: 0, windowStartedAt: 0 };

export const resetDingTalkProvisionStateForTest = (): void => {
  legacyTokenCache.clear();
  memoryLocks.clear();
  memoryRate.count = 0;
  memoryRate.windowStartedAt = 0;
};

export interface EnsureDingTalkUserInput {
  senderNick?: string;
  staffId: string;
}

interface BetterAuthProvisionContext {
  internalAdapter: {
    createUser: (user: {
      email: string;
      emailVerified: boolean;
      image?: string;
      name: string;
    }) => Promise<{ email?: string; id: string } | null | undefined>;
  };
}

const jsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isDingTalkErrcodeFailure = (errcode: unknown): boolean =>
  errcode !== 0 && errcode !== undefined && errcode !== null && errcode !== '0';

const provisionLockKey = (staffId: string): string => `messenger:dingtalk:provision:${staffId}`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const findUserByDingTalkEmail = async (
  db: LobeChatDatabase,
  staffId: string,
): Promise<UserItem | undefined> => {
  const email = buildDingTalkIdentityEmail(staffId);
  const exact = await UserModel.findByEmail(db, email);
  if (exact) return exact;

  const normalized = email.toLowerCase();
  return db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${normalized}`,
  });
};

const httpsImage = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith('https://') ? trimmed : undefined;
};

const fetchLegacyAppToken = async (
  clientId: string,
  clientSecret: string,
  now = Date.now(),
): Promise<string | null> => {
  const cached = legacyTokenCache.get(clientId);
  if (cached && cached.expiresAt > now) return cached.token;

  const url = new URL(DINGTALK_LEGACY_TOKEN_URL);
  url.searchParams.set('appkey', clientId);
  url.searchParams.set('appsecret', clientSecret);

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: 'no-store', method: 'GET', redirect: 'error' });
  } catch (error) {
    log('fetchLegacyAppToken network error: %O', error);
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    log('fetchLegacyAppToken invalid json: %O', error);
    return null;
  }

  const record = jsonRecord(body);
  const token = record?.access_token;
  if (isDingTalkErrcodeFailure(record?.errcode) || typeof token !== 'string' || !token.trim()) {
    log('fetchLegacyAppToken failed errcode=%s', record?.errcode);
    return null;
  }

  legacyTokenCache.set(clientId, {
    expiresAt: now + DINGTALK_LEGACY_TOKEN_CACHE_MS,
    token: token.trim(),
  });
  return token.trim();
};

interface DingTalkContact {
  avatar?: string;
  name: string | null;
}

const fetchDingTalkContact = async (staffId: string): Promise<DingTalkContact | null> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) {
    log('fetchDingTalkContact: connector missing');
    return null;
  }

  const accessToken = await fetchLegacyAppToken(config.clientId, config.clientSecret);
  if (!accessToken) return null;

  const url = new URL(DINGTALK_USER_GET_URL);
  url.searchParams.set('access_token', accessToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      body: JSON.stringify({ language: 'zh_CN', userid: staffId }),
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'error',
    });
  } catch (error) {
    log('fetchDingTalkContact network error: %O', error);
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    log('fetchDingTalkContact invalid json: %O', error);
    return null;
  }

  const record = jsonRecord(body);
  if (isDingTalkErrcodeFailure(record?.errcode)) {
    log('fetchDingTalkContact failed errcode=%s', record?.errcode);
    return null;
  }
  const result = jsonRecord(record?.result);
  if (!result) {
    log('fetchDingTalkContact missing result');
    return null;
  }

  return {
    avatar: typeof result.avatar === 'string' ? result.avatar : undefined,
    name: emptyToNull(typeof result.name === 'string' ? result.name : null),
  };
};

const acquireMemoryLock = (staffId: string, now: number): boolean => {
  const key = provisionLockKey(staffId);
  const existing = memoryLocks.get(key);
  if (existing && existing.expiresAt > now) return false;
  memoryLocks.set(key, { expiresAt: now + DINGTALK_PROVISION_LOCK_TTL_SECONDS * 1000 });
  return true;
};

const releaseMemoryLock = (staffId: string): void => {
  memoryLocks.delete(provisionLockKey(staffId));
};

const acquireProvisionLock = async (staffId: string): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const result = await redis.set(
        provisionLockKey(staffId),
        '1',
        'EX',
        DINGTALK_PROVISION_LOCK_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      log('acquireProvisionLock redis failed, using memory: %O', error);
    }
  }
  return acquireMemoryLock(staffId, Date.now());
};

const releaseProvisionLock = async (staffId: string): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      await redis.del(provisionLockKey(staffId));
    } catch (error) {
      log('releaseProvisionLock redis failed: %O', error);
    }
  }
  releaseMemoryLock(staffId);
};

const consumeMemoryRate = (now: number): boolean => {
  if (now - memoryRate.windowStartedAt >= DINGTALK_PROVISION_RATE_WINDOW_MS) {
    memoryRate.count = 0;
    memoryRate.windowStartedAt = now;
  }
  memoryRate.count += 1;
  return memoryRate.count <= DINGTALK_PROVISION_RATE_LIMIT_MAX;
};

const consumeProvisionRate = async (): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const count = await redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        DINGTALK_PROVISION_RATE_KEY,
        String(DINGTALK_PROVISION_RATE_WINDOW_MS),
      );
      return Number(count) <= DINGTALK_PROVISION_RATE_LIMIT_MAX;
    } catch (error) {
      log('consumeProvisionRate redis failed, using memory: %O', error);
    }
  }
  return consumeMemoryRate(Date.now());
};

const createAuthUser = async (input: {
  email: string;
  image?: string;
  name: string;
}): Promise<{ id: string } | null> => {
  const { auth } = await import('@/auth');
  const ctx = (await auth.$context) as BetterAuthProvisionContext;
  try {
    const created = await ctx.internalAdapter.createUser({
      email: input.email,
      emailVerified: false,
      name: input.name,
      ...(input.image ? { image: input.image } : {}),
    });
    if (!created?.id) return null;
    return created;
  } catch (error) {
    log('createUser failed: %O', error);
    return null;
  }
};

const provisionLockedUser = async (
  db: LobeChatDatabase,
  input: { senderNick?: string; staffId: string },
): Promise<UserItem | null> => {
  const existing = await findUserByDingTalkEmail(db, input.staffId);
  if (existing) return existing;

  if (!(await consumeProvisionRate())) {
    log('provision rate limited staffId=%s', input.staffId);
    return null;
  }

  const contact = await fetchDingTalkContact(input.staffId);
  if (!contact) return null;

  const name = emptyToNull(contact.name) ?? emptyToNull(input.senderNick) ?? input.staffId;
  const email = buildDingTalkIdentityEmail(input.staffId);
  const image = httpsImage(contact.avatar);

  const created = await createAuthUser({ email, image, name });
  if (!created) {
    return (await findUserByDingTalkEmail(db, input.staffId)) ?? null;
  }

  console.info('[dingtalk-provision] created user %s staffId=%s', created.id, input.staffId);
  return (
    (await findUserByDingTalkEmail(db, input.staffId)) ?? ({ email, id: created.id } as UserItem)
  );
};

/**
 * Look up or JIT-create the AIHub user for a DingTalk staffId.
 *
 * Create goes through Better Auth `internalAdapter.createUser` so
 * `databaseHooks.user.create.after` (pinyin via `UserService.initUser`,
 * `ensureDefaultPlatformUserRole`) runs the same way Authentik/OIDC
 * auto-provision does. Never a raw INSERT.
 */
export const ensureDingTalkUser = async (
  db: LobeChatDatabase,
  input: EnsureDingTalkUserInput,
): Promise<UserItem | null> => {
  const staffId = input.staffId.trim();
  if (!staffId) return null;

  const existing = await findUserByDingTalkEmail(db, staffId);
  if (existing) return existing;

  for (let attempt = 0; attempt <= DINGTALK_PROVISION_LOCK_RETRIES; attempt += 1) {
    const acquired = await acquireProvisionLock(staffId);
    if (acquired) {
      try {
        return await provisionLockedUser(db, { senderNick: input.senderNick, staffId });
      } finally {
        await releaseProvisionLock(staffId);
      }
    }

    await sleep(DINGTALK_PROVISION_LOCK_WAIT_MS);
    const raced = await findUserByDingTalkEmail(db, staffId);
    if (raced) return raced;
  }

  log('ensureDingTalkUser lock contention staffId=%s', staffId);
  return findUserByDingTalkEmail(db, staffId).then((user) => user ?? null);
};
