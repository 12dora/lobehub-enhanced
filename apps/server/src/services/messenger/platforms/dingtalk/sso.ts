import { createHash } from 'node:crypto';

import { makeSignature } from 'better-auth/crypto';
import debug from 'debug';
import { sql } from 'drizzle-orm';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { UserModel } from '@/database/models/user';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { buildDingTalkIdentityEmail, resolveDingTalkIdentityEmailDomain } from './const';

const log = debug('lobe-server:messenger:dingtalk:sso');

export const DINGTALK_SSO_CORP_ID_REDIS_KEY = 'messenger:dingtalk:corp-id';
export const DINGTALK_SSO_RATE_LIMIT_MAX = 10;
export const DINGTALK_SSO_RATE_LIMIT_WINDOW_MS = 60_000;
export const DINGTALK_LEGACY_TOKEN_URL = 'https://oapi.dingtalk.com/gettoken';
export const DINGTALK_GETUSERINFO_URL = 'https://oapi.dingtalk.com/topapi/v2/user/getuserinfo';
export const DINGTALK_LEGACY_TOKEN_CACHE_MS = 60 * 60 * 1000;

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export type DingTalkSsoFailReason =
  | 'bad_redirect'
  | 'disabled'
  | 'exchange_failed'
  | 'invalid_code'
  | 'rate_limited'
  | 'user_not_found';

export interface DingTalkSsoSessionCookie {
  attributes: {
    httpOnly: boolean;
    maxAge?: number;
    path: string;
    sameSite: 'lax' | 'none' | 'strict';
    secure: boolean;
  };
  name: string;
  value: string;
}

export type DingTalkSsoConfigResult = { corpId: string | null; enabled: true } | { enabled: false };

export type DingTalkSsoExchangeResult =
  | { cookie: DingTalkSsoSessionCookie; ok: true; redirect: string }
  | { ok: false; reason: DingTalkSsoFailReason };

interface LegacyTokenCache {
  expiresAt: number;
  token: string;
}

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

let legacyTokenCache: LegacyTokenCache | null = null;
const rateLimitMemory = new Map<string, RateLimitEntry>();

interface BetterAuthSessionCookieSpec {
  attributes: {
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: string;
    secure?: boolean;
  };
  name: string;
}

interface BetterAuthSsoContext {
  authCookies: { sessionToken: BetterAuthSessionCookieSpec };
  internalAdapter: {
    createSession: (
      userId: string,
      dontRememberMe?: boolean,
      override?: { ipAddress?: string; userAgent?: string },
    ) => Promise<{ token?: string } | null | undefined>;
  };
  secret: string;
}

export const resetDingTalkSsoStateForTest = (): void => {
  legacyTokenCache = null;
  rateLimitMemory.clear();
};

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Same-origin app path only: must start with `/`, must not be protocol-relative
 * (`//…`), and must not decode into a scheme or `//` prefix.
 */
export const isSafeDingTalkSsoRedirect = (redirect: unknown): redirect is string => {
  if (typeof redirect !== 'string' || redirect.length === 0 || redirect.length > 2048) {
    return false;
  }
  if (!redirect.startsWith('/') || redirect.startsWith('//') || redirect.includes('\\')) {
    return false;
  }
  if (/[\0\r\n]/.test(redirect)) return false;
  try {
    const decoded = decodeURIComponent(redirect);
    if (decoded.startsWith('//') || decoded.includes('\\')) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return false;
  } catch {
    return false;
  }
  return true;
};

export const serializeDingTalkSsoSessionCookie = (cookie: DingTalkSsoSessionCookie): string => {
  const sameSite =
    cookie.attributes.sameSite === 'strict'
      ? 'Strict'
      : cookie.attributes.sameSite === 'none'
        ? 'None'
        : 'Lax';
  const parts = [`${cookie.name}=${cookie.value}`, `Path=${cookie.attributes.path || '/'}`];
  if (typeof cookie.attributes.maxAge === 'number') {
    parts.push(`Max-Age=${cookie.attributes.maxAge}`);
  }
  if (cookie.attributes.httpOnly) parts.push('HttpOnly');
  parts.push(`SameSite=${sameSite}`);
  if (cookie.attributes.secure) parts.push('Secure');
  return parts.join('; ');
};

const readRedisCorpId = async (): Promise<string | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const value = await redis.get(DINGTALK_SSO_CORP_ID_REDIS_KEY);
    return emptyToNull(typeof value === 'string' ? value : null);
  } catch (error) {
    log('readRedisCorpId failed: %O', error);
    return null;
  }
};

const consumeMemoryRateLimit = (ip: string, now: number): boolean => {
  const existing = rateLimitMemory.get(ip);
  const entry =
    !existing || now - existing.windowStartedAt >= DINGTALK_SSO_RATE_LIMIT_WINDOW_MS
      ? { count: 0, windowStartedAt: now }
      : existing;
  entry.count += 1;
  rateLimitMemory.delete(ip);
  rateLimitMemory.set(ip, entry);
  while (rateLimitMemory.size > 10_000) {
    const oldest = rateLimitMemory.keys().next().value;
    if (oldest === undefined) break;
    rateLimitMemory.delete(oldest);
  }
  return entry.count <= DINGTALK_SSO_RATE_LIMIT_MAX;
};

const consumeSsoRateLimit = async (ip: string): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const digest = createHash('sha256').update(ip).digest('hex');
      const count = await redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        `messenger:dingtalk:sso-rate:${digest}`,
        String(DINGTALK_SSO_RATE_LIMIT_WINDOW_MS),
      );
      return Number(count) <= DINGTALK_SSO_RATE_LIMIT_MAX;
    } catch (error) {
      log('consumeSsoRateLimit redis failed, using memory: %O', error);
    }
  }
  return consumeMemoryRateLimit(ip, Date.now());
};

const jsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const fetchLegacyAppToken = async (
  clientId: string,
  clientSecret: string,
  now = Date.now(),
): Promise<string | null> => {
  if (legacyTokenCache && legacyTokenCache.expiresAt > now) return legacyTokenCache.token;

  const url = new URL(DINGTALK_LEGACY_TOKEN_URL);
  url.searchParams.set('appkey', clientId);
  url.searchParams.set('appsecret', clientSecret);

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: 'no-store', method: 'GET' });
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
  const errcode = record?.errcode;
  const token = record?.access_token;
  if (errcode !== 0 && errcode !== undefined && errcode !== null && errcode !== '0') {
    log('fetchLegacyAppToken errcode=%s', String(errcode));
    return null;
  }
  if (typeof token !== 'string' || token.trim().length === 0) return null;

  legacyTokenCache = { expiresAt: now + DINGTALK_LEGACY_TOKEN_CACHE_MS, token: token.trim() };
  return legacyTokenCache.token;
};

const exchangeAuthCodeForUserId = async (
  accessToken: string,
  code: string,
): Promise<string | null> => {
  const url = new URL(DINGTALK_GETUSERINFO_URL);
  url.searchParams.set('access_token', accessToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      body: JSON.stringify({ code }),
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  } catch (error) {
    log('exchangeAuthCodeForUserId network error: %O', error);
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    log('exchangeAuthCodeForUserId invalid json: %O', error);
    return null;
  }

  const record = jsonRecord(body);
  const errcode = record?.errcode;
  if (errcode !== 0 && errcode !== undefined && errcode !== null && errcode !== '0') {
    log('exchangeAuthCodeForUserId errcode=%s', String(errcode));
    return null;
  }
  const result = jsonRecord(record?.result);
  const userid = result?.userid;
  if (typeof userid !== 'string' || userid.trim().length === 0) return null;
  return userid.trim();
};

const findUserByStaffId = async (db: LobeChatDatabase, staffId: string) => {
  const email = buildDingTalkIdentityEmail(staffId);
  const exact = await UserModel.findByEmail(db, email);
  if (exact) return exact;

  const normalized = email.toLowerCase();
  return db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${normalized}`,
  });
};

const sameSiteFrom = (value: unknown): 'lax' | 'none' | 'strict' => {
  if (value === 'strict' || value === 'Strict') return 'strict';
  if (value === 'none' || value === 'None') return 'none';
  return 'lax';
};

/**
 * Create a Better Auth session the same way sign-in does:
 * `internalAdapter.createSession` writes `auth_sessions` (+ Redis secondary
 * storage when configured). The cookie is signed with Better Auth's
 * `makeSignature` (HMAC-SHA256 of the token keyed by AUTH_SECRET, standard
 * base64) so `getSignedCookie` / `auth.api.getSession` accept it.
 *
 * Cookie name comes from `ctx.authCookies.sessionToken.name`, which is
 * `__Secure-<AUTH_COOKIE_PREFIX || better-auth>.session_token` when secure
 * cookies are on (https / production).
 */
const createSessionCookie = async (
  userId: string,
  extras?: { ipAddress?: string; userAgent?: string },
): Promise<DingTalkSsoSessionCookie | null> => {
  const { auth } = await import('@/auth');
  const ctx = (await auth.$context) as BetterAuthSsoContext;
  const session = await ctx.internalAdapter.createSession(userId, false, {
    ...(extras?.ipAddress ? { ipAddress: extras.ipAddress } : {}),
    ...(extras?.userAgent ? { userAgent: extras.userAgent } : {}),
  });
  if (!session?.token) return null;

  const signed = await makeSignature(session.token, ctx.secret);
  const cookie = ctx.authCookies.sessionToken;
  return {
    attributes: {
      httpOnly: cookie.attributes.httpOnly ?? true,
      maxAge: cookie.attributes.maxAge,
      path: cookie.attributes.path ?? '/',
      sameSite: sameSiteFrom(cookie.attributes.sameSite),
      secure: Boolean(cookie.attributes.secure),
    },
    name: cookie.name,
    value: `${session.token}.${signed}`,
  };
};

export const getDingTalkSsoConfig = async (): Promise<DingTalkSsoConfigResult> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return { enabled: false };

  const fromSettings = emptyToNull(config.corpId);
  const corpId = fromSettings ?? (await readRedisCorpId());
  return { corpId, enabled: true };
};

export const exchangeDingTalkSso = async (input: {
  code: unknown;
  ip?: string;
  redirect: unknown;
  userAgent?: string;
}): Promise<DingTalkSsoExchangeResult> => {
  const ip = (input.ip?.trim() || 'unknown').slice(0, 128);
  if (!(await consumeSsoRateLimit(ip))) {
    log('sso rate limited ip=%s', ip);
    return { ok: false, reason: 'rate_limited' };
  }

  const config = await getMessengerDingTalkConfig();
  if (!config) return { ok: false, reason: 'disabled' };

  if (!isSafeDingTalkSsoRedirect(input.redirect)) {
    return { ok: false, reason: 'bad_redirect' };
  }

  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!code || code.length > 512) return { ok: false, reason: 'invalid_code' };

  const accessToken = await fetchLegacyAppToken(config.clientId, config.clientSecret);
  if (!accessToken) return { ok: false, reason: 'exchange_failed' };

  const staffId = await exchangeAuthCodeForUserId(accessToken, code);
  if (!staffId) return { ok: false, reason: 'exchange_failed' };

  const db = await getServerDB();
  const user = await findUserByStaffId(db, staffId);
  if (!user?.id) {
    log('sso user_not_found staffId=%s domain=%s', staffId, resolveDingTalkIdentityEmailDomain());
    return { ok: false, reason: 'user_not_found' };
  }

  const cookie = await createSessionCookie(user.id, {
    ipAddress: ip === 'unknown' ? undefined : ip,
    userAgent: input.userAgent,
  });
  if (!cookie) return { ok: false, reason: 'exchange_failed' };

  log('sso session created userId=%s', user.id);
  return { cookie, ok: true, redirect: input.redirect };
};
