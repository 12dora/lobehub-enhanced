import debug from 'debug';

import {
  DINGTALK_LEGACY_TOKEN_URL,
  DINGTALK_USER_GET_URL,
} from '@/server/services/messenger/platforms/dingtalk/provision';

const log = debug('lobe-server:admin:imConnectors');

export const DINGTALK_STAFF_LOOKUP_TIMEOUT_MS = 8000;

export type DingTalkStaffLookupFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>;

export interface DingTalkStaffLookupResult {
  name: string | null;
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

const fetchLegacyAppToken = async (
  clientId: string,
  clientSecret: string,
  fetchImpl: DingTalkStaffLookupFetch,
  signal: AbortSignal,
): Promise<string | null> => {
  const url = new URL(DINGTALK_LEGACY_TOKEN_URL);
  url.searchParams.set('appkey', clientId);
  url.searchParams.set('appsecret', clientSecret);

  let response: Pick<Response, 'json' | 'ok' | 'status'>;
  try {
    response = await fetchImpl(url.toString(), { cache: 'no-store', method: 'GET', signal });
  } catch (error) {
    log('staff lookup token network error: %O', error);
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    log('staff lookup token invalid json: %O', error);
    return null;
  }

  const record = jsonRecord(body);
  const token = record?.access_token;
  if (isDingTalkErrcodeFailure(record?.errcode) || typeof token !== 'string' || !token.trim()) {
    log('staff lookup token failed errcode=%s', record?.errcode);
    return null;
  }
  return token.trim();
};

/**
 * Best-effort DingTalk `topapi/v2/user/get`. Returns null when the connector
 * cannot be reached or the staff id is unknown — callers still persist the
 * admin-typed id.
 */
export const lookupDingTalkStaff = async (params: {
  clientId: string;
  clientSecret: string;
  fetchImpl?: DingTalkStaffLookupFetch;
  staffId: string;
}): Promise<DingTalkStaffLookupResult | null> => {
  const doFetch = params.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DINGTALK_STAFF_LOOKUP_TIMEOUT_MS);

  try {
    const accessToken = await fetchLegacyAppToken(
      params.clientId,
      params.clientSecret,
      doFetch,
      controller.signal,
    );
    if (!accessToken) return null;

    const url = new URL(DINGTALK_USER_GET_URL);
    url.searchParams.set('access_token', accessToken);

    let response: Pick<Response, 'json' | 'ok' | 'status'>;
    try {
      response = await doFetch(url.toString(), {
        body: JSON.stringify({ language: 'zh_CN', userid: params.staffId }),
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
    } catch (error) {
      log('staff lookup user/get network error: %O', error);
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      log('staff lookup user/get invalid json: %O', error);
      return null;
    }

    const record = jsonRecord(body);
    if (isDingTalkErrcodeFailure(record?.errcode)) {
      log('staff lookup user/get failed errcode=%s', record?.errcode);
      return null;
    }
    const result = jsonRecord(record?.result);
    if (!result) return null;

    const resultUserId = emptyToNull(typeof result.userid === 'string' ? result.userid : null);
    if (resultUserId !== params.staffId) {
      log('staff lookup userid mismatch');
      return null;
    }

    return {
      name: emptyToNull(typeof result.name === 'string' ? result.name : null),
    };
  } finally {
    clearTimeout(timer);
  }
};
