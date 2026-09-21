import { isRecord, pickTrimmedString } from '@lobechat/utils/object';
import debug from 'debug';

import { SafeOutboundHttpClient } from '@/server/enterprise/security/outboundHttp';
import {
  DINGTALK_API_BASE,
  DINGTALK_OAPI_BASE,
  DingTalkNotifyAppError,
  getNotifyAppNewApiToken,
  getNotifyAppToken,
  invalidateNotifyAppNewApiToken,
  invalidateNotifyAppToken,
} from '@/server/services/messenger/platforms/dingtalk/notifyApp';

import { DingtalkWorkspaceError, type DingtalkWorkspaceErrorCode } from './errors';

const log = debug('lobe-server:dingtalk-workspace:client');

export const DINGTALK_WORKSPACE_TIMEOUT_MS = 10_000;

export type DingtalkWorkspaceApi = 'legacy' | 'v1';
export type DingtalkWorkspaceHttpMethod = 'DELETE' | 'GET' | 'POST' | 'PUT';

export interface DingtalkWorkspaceRequest {
  api: DingtalkWorkspaceApi;
  body?: unknown;
  method: DingtalkWorkspaceHttpMethod;
  path: string;
  query?: Record<string, boolean | number | string | undefined>;
}

export type DingtalkWorkspaceFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'json' | 'ok' | 'status' | 'text'>>;

const outbound = new SafeOutboundHttpClient({ timeoutMs: DINGTALK_WORKSPACE_TIMEOUT_MS });

/** Process-wide cap below DingTalk's 40 rps/app/API limit (90018). */
export const DINGTALK_WORKSPACE_MAX_RPS = 30;
export const DINGTALK_WORKSPACE_RATE_MAX_WAITERS = 200;
export const DINGTALK_WORKSPACE_RATE_MAX_WAIT_MS = 15_000;

let fetchOverride: DingtalkWorkspaceFetch | null = null;
let rateTokens = DINGTALK_WORKSPACE_MAX_RPS;
/** Refill rate in tokens per second. Only tests change it (0 = never refill). */
let rateRefillRps = DINGTALK_WORKSPACE_MAX_RPS;
let rateRefilledAtMs = Date.now();
let rateMutex: Promise<void> = Promise.resolve();
let rateWaiters = 0;

export const setDingtalkWorkspaceFetchForTest = (
  fetchImpl: DingtalkWorkspaceFetch | null,
): void => {
  fetchOverride = fetchImpl;
};

export const resetDingtalkWorkspaceRequestRateForTest = (input?: {
  refillRps?: number;
  refilledAtMs?: number;
  tokens?: number;
}): void => {
  rateRefillRps = input?.refillRps ?? DINGTALK_WORKSPACE_MAX_RPS;
  rateTokens = input?.tokens ?? DINGTALK_WORKSPACE_MAX_RPS;
  rateRefilledAtMs = input?.refilledAtMs ?? Date.now();
  rateMutex = Promise.resolve();
  rateWaiters = 0;
};

const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      const unref = Reflect.get(timer, 'unref');
      if (typeof unref === 'function') unref.call(timer);
    }
  });

const withRateMutex = async <T>(fn: () => T): Promise<T> => {
  let release: () => void = () => undefined;
  const previous = rateMutex;
  rateMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return fn();
  } finally {
    release();
  }
};

const takeRateTokenOrWaitMs = (): number => {
  const now = Date.now();
  const elapsed = Math.max(0, now - rateRefilledAtMs);
  rateTokens = Math.min(DINGTALK_WORKSPACE_MAX_RPS, rateTokens + (elapsed * rateRefillRps) / 1000);
  rateRefilledAtMs = now;
  if (rateTokens >= 1) {
    rateTokens -= 1;
    return 0;
  }
  if (rateRefillRps <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil(((1 - rateTokens) * 1000) / rateRefillRps));
};

const acquireWorkspaceRequestSlot = async (): Promise<void> => {
  if (rateWaiters >= DINGTALK_WORKSPACE_RATE_MAX_WAITERS) {
    throw new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED');
  }
  rateWaiters += 1;
  const startedAt = Date.now();
  try {
    for (;;) {
      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= DINGTALK_WORKSPACE_RATE_MAX_WAIT_MS) {
        throw new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED');
      }
      const waitMs = await withRateMutex(takeRateTokenOrWaitMs);
      if (waitMs === 0) return;
      const remaining = DINGTALK_WORKSPACE_RATE_MAX_WAIT_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        throw new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED');
      }
      await sleepMs(Math.min(waitMs, remaining));
    }
  } finally {
    rateWaiters -= 1;
  }
};

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const clip = (value: string | undefined, max = 200): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out|aborted/i.test(message)
  );
};

const isInvalidAccessToken = (code: string | null, message: string | null): boolean => {
  if (!code && !message) return false;
  const haystack = `${code ?? ''} ${message ?? ''}`;
  return /40014|InvalidAuthentication|InvalidAccessToken|invalid.?access.?token|不合法的access_token/i.test(
    haystack,
  );
};

const buildUrl = (
  api: DingtalkWorkspaceApi,
  path: string,
  query: DingtalkWorkspaceRequest['query'],
  accessToken?: string,
): string => {
  const base = api === 'v1' ? DINGTALK_API_BASE : DINGTALK_OAPI_BASE;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${normalized}`);
  if (api === 'legacy' && accessToken) url.searchParams.set('access_token', accessToken);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

const parseJson = async (response: Pick<Response, 'json' | 'text'>): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
};

const upstreamFromRecord = (
  record: Record<string, unknown> | null,
  status: number,
): { code: string | null; message: string | null } => {
  if (!record) return { code: status ? String(status) : null, message: null };
  const rawCode = record.code ?? record.errcode ?? record.errorCode;
  const code =
    typeof rawCode === 'number' && Number.isFinite(rawCode)
      ? String(rawCode)
      : emptyToNull(typeof rawCode === 'string' ? rawCode : null);
  const message =
    clip(pickTrimmedString(record.message)) ??
    clip(pickTrimmedString(record.errmsg)) ??
    clip(pickTrimmedString(record.msg));
  return { code, message };
};

const isOapiFailure = (record: Record<string, unknown> | null, responseOk: boolean): boolean => {
  if (!responseOk) return true;
  if (!record) return false;
  const errcode = record.errcode ?? record.code;
  if (errcode === undefined || errcode === null || errcode === 0 || errcode === '0') return false;
  if (errcode === 'ok' || errcode === 'OK') return false;
  return true;
};

const mapUpstreamToCode = (
  status: number,
  upstreamCode: string | null,
  message: string | null,
): DingtalkWorkspaceErrorCode => {
  const haystack = `${upstreamCode ?? ''} ${message ?? ''}`.toLowerCase();
  if (/premium|高级版|oa高级/.test(haystack)) return 'DINGTALK_PREMIUM_REQUIRED';
  if (status === 429 || /90018|ratelimit|rate.?limit|qpslimit|too many requests/.test(haystack)) {
    return 'DINGTALK_RATE_LIMITED';
  }
  if (
    status === 403 ||
    /60011|forbidden|accessdenied|permissiondenied|没有权限|无权限|access.?denied/.test(haystack)
  ) {
    return 'DINGTALK_FORBIDDEN';
  }
  if (status === 404 || /not.?found|不存在|60121/.test(haystack)) return 'DINGTALK_NOT_FOUND';
  if (
    status === 400 ||
    /invalidparameter|invalid.?argument|88|40035|非法|参数错误/.test(haystack)
  ) {
    return 'DINGTALK_INVALID';
  }
  if (status >= 500) return 'DINGTALK_UNAVAILABLE';
  if (status === 401 || /invalidauthentication/.test(haystack)) return 'DINGTALK_FORBIDDEN';
  return 'DINGTALK_UNAVAILABLE';
};

const throwMapped = (
  status: number,
  upstreamCode: string | null,
  message: string | null,
): never => {
  const code = mapUpstreamToCode(status, upstreamCode, message);
  log('dingtalk request failed code=%s upstream=%s status=%s', code, upstreamCode, status);
  throw new DingtalkWorkspaceError(code, upstreamCode ?? undefined);
};

const doFetch: DingtalkWorkspaceFetch = async (input, init) => {
  if (fetchOverride) return fetchOverride(input, init);
  return outbound.fetch(input, {
    body: typeof init?.body === 'string' ? init.body : undefined,
    headers: init?.headers as Record<string, string> | undefined,
    method: init?.method,
    secretBearing: true,
    timeoutMs: DINGTALK_WORKSPACE_TIMEOUT_MS,
  });
};

const executeOnce = async (
  req: DingtalkWorkspaceRequest,
  accessToken: string,
): Promise<{ body: unknown; ok: boolean; status: number }> => {
  await acquireWorkspaceRequestSlot();
  const url = buildUrl(
    req.api,
    req.path,
    req.query,
    req.api === 'legacy' ? accessToken : undefined,
  );
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (req.api === 'v1') headers['x-acs-dingtalk-access-token'] = accessToken;
  const hasBody = req.body !== undefined && req.method !== 'GET' && req.method !== 'DELETE';
  if (hasBody) headers['Content-Type'] = 'application/json';

  let response: Pick<Response, 'json' | 'ok' | 'status' | 'text'>;
  try {
    response = await doFetch(url, {
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      headers,
      method: req.method,
    });
  } catch (error) {
    if (error instanceof DingtalkWorkspaceError) throw error;
    if (error instanceof DingTalkNotifyAppError) {
      throw new DingtalkWorkspaceError(
        error.errcode === 'notify_app_not_configured'
          ? 'DINGTALK_NOT_CONFIGURED'
          : isTimeoutError(error)
            ? 'DINGTALK_UNAVAILABLE'
            : 'DINGTALK_UNAVAILABLE',
        error.errcode === null || error.errcode === undefined ? undefined : String(error.errcode),
      );
    }
    log('network error: %O', error);
    throw new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
  }

  const body = await parseJson(response);
  return { body, ok: response.ok, status: response.status };
};

const getToken = async (api: DingtalkWorkspaceApi, skipCache = false): Promise<string> => {
  try {
    if (api === 'v1') return await getNotifyAppNewApiToken({ skipCache });
    return await getNotifyAppToken({ skipCache });
  } catch (error) {
    if (error instanceof DingTalkNotifyAppError) {
      if (error.errcode === 'notify_app_not_configured') {
        throw new DingtalkWorkspaceError('DINGTALK_NOT_CONFIGURED');
      }
      throw new DingtalkWorkspaceError(
        'DINGTALK_UNAVAILABLE',
        error.errcode === null || error.errcode === undefined ? undefined : String(error.errcode),
      );
    }
    throw new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
  }
};

const invalidateToken = async (api: DingtalkWorkspaceApi): Promise<void> => {
  if (api === 'v1') {
    await invalidateNotifyAppNewApiToken();
    return;
  }
  await invalidateNotifyAppToken();
};

/**
 * Typed DingTalk OpenAPI wrapper. Uses the notify-app (服务号) token cache.
 * Throws `DingtalkWorkspaceError`. `upstreamCode` is logged, never shown.
 */
export const dingtalkWorkspaceRequest = async <T>(req: DingtalkWorkspaceRequest): Promise<T> => {
  let token = await getToken(req.api);
  let result = await executeOnce(req, token);
  const record = isRecord(result.body) ? result.body : null;
  const upstream = upstreamFromRecord(record, result.status);

  if (
    isInvalidAccessToken(upstream.code, upstream.message) ||
    (req.api === 'v1' && result.status === 401)
  ) {
    await invalidateToken(req.api);
    token = await getToken(req.api, true);
    result = await executeOnce(req, token);
  }

  const nextRecord = isRecord(result.body) ? result.body : null;
  const nextUpstream = upstreamFromRecord(nextRecord, result.status);

  if (req.api === 'legacy') {
    if (isOapiFailure(nextRecord, result.ok)) {
      throwMapped(result.status, nextUpstream.code, nextUpstream.message);
    }
    return (nextRecord?.result ?? nextRecord) as T;
  }

  if (!result.ok || isOapiFailure(nextRecord, result.ok)) {
    throwMapped(result.status, nextUpstream.code, nextUpstream.message);
  }
  return (nextRecord ?? {}) as T;
};
