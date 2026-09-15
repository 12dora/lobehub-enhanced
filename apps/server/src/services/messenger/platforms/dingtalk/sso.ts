import { createHash } from 'node:crypto';

import { runWithEndpointContext } from '@better-auth/core/context';
import { isAPIError } from 'better-auth/api';
import { makeSignature } from 'better-auth/crypto';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { isEffectivelyBanned } from '@/database/utils/userBan';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { DINGTALK_CORP_ID_KEY, resolveDingTalkIdentityEmailDomain } from './const';
import { ensureDingTalkUser } from './provision';

const log = debug('lobe-server:messenger:dingtalk:sso');

/** Same Redis key the stream worker writes via `rememberDingTalkCorpId`. */
export { DINGTALK_CORP_ID_KEY };
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
  | {
      /** DingTalk `errcode` (or `http_<status>` / `network`) when `reason` is `exchange_failed`. */
      detail?: string;
      httpStatus?: 403 | 502;
      ok: false;
      reason: DingTalkSsoFailReason;
    };

/**
 * Synthetic better-auth path for DingTalk 免登 session minting.
 *
 * 免登 is IdP-delegated SSO (DingTalk JSAPI `requestAuthCode` after the user
 * is already signed in at DingTalk), the same policy as OAuth callbacks:
 * TOTP is not required. `isOAuthCallbackPath` allows `/callback/:id`, so we
 * mint under this path instead of relying on the "no HTTP path = bootstrap"
 * allowance in `enforceTwoFactorSessionGate`.
 */
export const DINGTALK_SSO_TWO_FACTOR_SESSION_PATH = '/callback/dingtalk';

interface LegacyTokenCache {
  expiresAt: number;
  token: string;
}

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

const legacyTokenCache = new Map<string, LegacyTokenCache>();
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
  legacyTokenCache.clear();
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
    const value = await redis.get(DINGTALK_CORP_ID_KEY);
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

const isDingTalkErrcodeFailure = (errcode: unknown): boolean =>
  errcode !== 0 && errcode !== undefined && errcode !== null && errcode !== '0';

const responseStatus = (response: Response): number | undefined =>
  typeof response.status === 'number' ? response.status : undefined;

/**
 * Always `console.warn` (not `debug`) so exchange failures are visible without DEBUG=.
 * Never pass the JSAPI code, app secret, access token, or request URL.
 */
const warnDingTalkSso = (
  stage: string,
  params: { errcode?: unknown; errmsg?: unknown; status?: number },
): void => {
  const errcode =
    params.errcode === undefined || params.errcode === null ? 'n/a' : String(params.errcode);
  const errmsg =
    typeof params.errmsg === 'string' && params.errmsg.trim().length > 0
      ? params.errmsg.trim()
      : 'n/a';
  const status = params.status === undefined ? 'n/a' : String(params.status);
  console.warn(`[dingtalk-sso] ${stage} status=${status} errcode=${errcode} errmsg=${errmsg}`);
};

const dingTalkOapiDetail = (record: Record<string, unknown> | null, status?: number): string => {
  const errcode = record?.errcode;
  if (errcode !== undefined && errcode !== null && String(errcode).length > 0) {
    return String(errcode);
  }
  return typeof status === 'number' ? `http_${status}` : 'network';
};

type DingTalkOapiFailure = { detail: string; ok: false };
type DingTalkOapiToken = { ok: true; token: string };
type DingTalkOapiUserId = { ok: true; userid: string };

const fetchLegacyAppToken = async (
  clientId: string,
  clientSecret: string,
  now = Date.now(),
): Promise<DingTalkOapiToken | DingTalkOapiFailure> => {
  const cached = legacyTokenCache.get(clientId);
  if (cached && cached.expiresAt > now) return { ok: true, token: cached.token };

  const url = new URL(DINGTALK_LEGACY_TOKEN_URL);
  url.searchParams.set('appkey', clientId);
  url.searchParams.set('appsecret', clientSecret);

  let response: Response;
  try {
    // `redirect: 'error'` so a 30x off oapi.dingtalk.com cannot forward appsecret in the query.
    response = await fetch(url.toString(), { cache: 'no-store', method: 'GET', redirect: 'error' });
  } catch (error) {
    log('fetchLegacyAppToken network error: %O', error);
    warnDingTalkSso('gettoken', { errmsg: 'network' });
    return { detail: 'network', ok: false };
  }

  const status = responseStatus(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    log('fetchLegacyAppToken invalid json: %O', error);
    warnDingTalkSso('gettoken', { errmsg: 'invalid_json', status });
    return { detail: dingTalkOapiDetail(null, status), ok: false };
  }

  const record = jsonRecord(body);
  const errcode = record?.errcode;
  const errmsg = record?.errmsg;
  const token = record?.access_token;
  if (isDingTalkErrcodeFailure(errcode)) {
    warnDingTalkSso('gettoken', { errcode, errmsg, status });
    return { detail: String(errcode), ok: false };
  }
  if (typeof token !== 'string' || token.trim().length === 0) {
    warnDingTalkSso('gettoken', { errcode, errmsg, status });
    return { detail: dingTalkOapiDetail(record, status), ok: false };
  }

  const next: LegacyTokenCache = {
    expiresAt: now + DINGTALK_LEGACY_TOKEN_CACHE_MS,
    token: token.trim(),
  };
  legacyTokenCache.set(clientId, next);
  return { ok: true, token: next.token };
};

const exchangeAuthCodeForUserId = async (
  accessToken: string,
  code: string,
): Promise<DingTalkOapiUserId | DingTalkOapiFailure> => {
  const url = new URL(DINGTALK_GETUSERINFO_URL);
  url.searchParams.set('access_token', accessToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      body: JSON.stringify({ code }),
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'error',
    });
  } catch (error) {
    log('exchangeAuthCodeForUserId network error: %O', error);
    warnDingTalkSso('requestAuthCode', { errmsg: 'network' });
    return { detail: 'network', ok: false };
  }

  const status = responseStatus(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    log('exchangeAuthCodeForUserId invalid json: %O', error);
    warnDingTalkSso('requestAuthCode', { errmsg: 'invalid_json', status });
    return { detail: dingTalkOapiDetail(null, status), ok: false };
  }

  const record = jsonRecord(body);
  const errcode = record?.errcode;
  const errmsg = record?.errmsg;
  if (isDingTalkErrcodeFailure(errcode)) {
    // 40078 = invalid/expired tmp auth code (often issued outside the micro-app container);
    // 40014 = invalid access_token. Log errmsg so ops can see DingTalk's reason.
    warnDingTalkSso('requestAuthCode', { errcode, errmsg, status });
    return { detail: String(errcode), ok: false };
  }
  const result = jsonRecord(record?.result);
  const userid = result?.userid;
  if (typeof userid !== 'string' || userid.trim().length === 0) {
    warnDingTalkSso('requestAuthCode', { errcode, errmsg, status });
    return { detail: dingTalkOapiDetail(record, status), ok: false };
  }
  return { ok: true, userid: userid.trim() };
};

const sameSiteFrom = (value: unknown): 'lax' | 'none' | 'strict' => {
  if (value === 'strict' || value === 'Strict') return 'strict';
  if (value === 'none' || value === 'None') return 'none';
  return 'lax';
};

type CreateSessionCookieResult =
  | { cookie: DingTalkSsoSessionCookie; ok: true }
  | { httpStatus: 403 | 502; ok: false; reason: 'exchange_failed' };

const httpStatusFromApiError = (error: { status?: number | string }): 403 | 502 =>
  error.status === 'FORBIDDEN' || error.status === 403 ? 403 : 502;

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
 *
 * DingTalk 免登 is IdP-delegated like OAuth, so it skips the TOTP gate: we
 * run `createSession` under `DINGTALK_SSO_TWO_FACTOR_SESSION_PATH`
 * (`/callback/dingtalk`), which `isOAuthCallbackPath` allows.
 */
const createSessionCookie = async (
  userId: string,
  extras?: { ipAddress?: string; userAgent?: string },
): Promise<CreateSessionCookieResult> => {
  const { auth } = await import('@/auth');
  const ctx = (await auth.$context) as BetterAuthSsoContext;
  let session: { token?: string } | null | undefined;
  try {
    session = await runWithEndpointContext(
      { context: ctx as never, path: DINGTALK_SSO_TWO_FACTOR_SESSION_PATH },
      () =>
        ctx.internalAdapter.createSession(userId, false, {
          ...(extras?.ipAddress ? { ipAddress: extras.ipAddress } : {}),
          ...(extras?.userAgent ? { userAgent: extras.userAgent } : {}),
        }),
    );
  } catch (error) {
    if (isAPIError(error)) {
      log('createSession APIError status=%s code=%s', error.status, error.body?.code);
      return { httpStatus: httpStatusFromApiError(error), ok: false, reason: 'exchange_failed' };
    }
    log('createSession failed: %O', error);
    return { httpStatus: 502, ok: false, reason: 'exchange_failed' };
  }
  if (!session?.token) return { httpStatus: 502, ok: false, reason: 'exchange_failed' };

  const signed = await makeSignature(session.token, ctx.secret);
  const cookie = ctx.authCookies.sessionToken;
  return {
    cookie: {
      attributes: {
        httpOnly: cookie.attributes.httpOnly ?? true,
        maxAge: cookie.attributes.maxAge,
        path: cookie.attributes.path ?? '/',
        sameSite: sameSiteFrom(cookie.attributes.sameSite),
        secure: Boolean(cookie.attributes.secure),
      },
      name: cookie.name,
      value: `${session.token}.${signed}`,
    },
    ok: true,
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
  if (!accessToken.ok) return { detail: accessToken.detail, ok: false, reason: 'exchange_failed' };

  const staffId = await exchangeAuthCodeForUserId(accessToken.token, code);
  if (!staffId.ok) {
    // 40014 = invalid access_token. Drop the 1h cache so the next attempt refetches.
    if (staffId.detail === '40014') legacyTokenCache.delete(config.clientId);
    return { detail: staffId.detail, ok: false, reason: 'exchange_failed' };
  }

  const db = await getServerDB();
  const user = await ensureDingTalkUser(db, { staffId: staffId.userid });
  if (!user?.id) {
    log(
      'sso user_not_found staffId=%s domain=%s',
      staffId.userid,
      resolveDingTalkIdentityEmailDomain(),
    );
    return { ok: false, reason: 'user_not_found' };
  }

  // Same predicate as better-auth's admin plugin (`banned` + unexpired `banExpires`).
  // Return `user_not_found` so a ban is not distinguishable from an unknown staffId.
  if (isEffectivelyBanned(user)) {
    log(
      'sso user_not_found staffId=%s domain=%s',
      staffId.userid,
      resolveDingTalkIdentityEmailDomain(),
    );
    return { ok: false, reason: 'user_not_found' };
  }

  const created = await createSessionCookie(user.id, {
    ipAddress: ip === 'unknown' ? undefined : ip,
    userAgent: input.userAgent,
  });
  if (!created.ok) return created;

  log('sso session created userId=%s', user.id);
  return { cookie: created.cookie, ok: true, redirect: input.redirect };
};
