import {
  recordDingTalkHttpCallSafely,
  writeSharedDingTalkToken,
} from '@/server/services/messenger/platforms/dingtalk/tokenCache';

import type { AdminImConnectorTestOutput } from '../../contracts/adminImConnectors';

export const DINGTALK_APP_TOKEN_ENDPOINT = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
export const DINGTALK_PROBE_TIMEOUT_MS = 8000;

/**
 * Official DingTalk OpenAPI used by this probe:
 *   POST https://api.dingtalk.com/v1.0/oauth2/accessToken  { appKey, appSecret }
 *   → { accessToken, expireIn }
 * Docs: https://open.dingtalk.com/document/orgapp/obtain-the-access-token-of-an-internal-app
 *
 * Robot display name: no public endpoint. Checked (and rejected as unofficial):
 *   GET https://api.dingtalk.com/v1.0/robot/robotCodes/<robotCode>
 * Other documented robot APIs are send/download/upload only
 * (`/v1.0/robot/oToMessages/batchSend`, `/v1.0/robot/groupMessages/send`,
 * `/v1.0/robot/messageFiles/download`). `robotName` is therefore always null.
 */
const AUTH_FAILED_CODE_PATTERN =
  /idorsecret|appkey|appsecret|invalidauthentication|invalidclient|invalid.*secret|invalid.*key/i;

export type DingTalkProbeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json' | 'status' | 'text'>>;

const emptyResult = (
  partial: Pick<AdminImConnectorTestOutput, 'errorCode' | 'errorMessage' | 'latencyMs' | 'ok'>,
): AdminImConnectorTestOutput => ({
  ...partial,
  robotName: null,
});

const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  return (
    name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out|aborted/i.test(message)
  );
};

const clipMessage = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
};

const readErrorBody = async (
  response: Pick<Response, 'json' | 'text'>,
): Promise<{ code?: string; message?: string }> => {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === 'string' ? body.code : undefined,
      message: typeof body.message === 'string' ? body.message : undefined,
    };
  } catch {
    return {};
  }
};

const mapHttpError = (code: string | undefined): 'auth_failed' | 'unknown' => {
  if (code && AUTH_FAILED_CODE_PATTERN.test(code)) return 'auth_failed';
  return 'unknown';
};

export const probeDingTalkCredentials = async (params: {
  clientId: string;
  clientSecret: string;
  fetchImpl?: DingTalkProbeFetch;
}): Promise<AdminImConnectorTestOutput> => {
  const doFetch = params.fetchImpl ?? globalThis.fetch;
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DINGTALK_PROBE_TIMEOUT_MS);

  try {
    recordDingTalkHttpCallSafely('POST', DINGTALK_APP_TOKEN_ENDPOINT);
    const response = await doFetch(DINGTALK_APP_TOKEN_ENDPOINT, {
      body: JSON.stringify({ appKey: params.clientId, appSecret: params.clientSecret }),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

    if (response.ok) {
      try {
        const body = (await response.json()) as { accessToken?: unknown };
        if (typeof body.accessToken === 'string' && body.accessToken.length > 0) {
          const expireIn =
            typeof (body as { expireIn?: unknown }).expireIn === 'number'
              ? (body as { expireIn: number }).expireIn
              : 7200;
          void writeSharedDingTalkToken(
            params.clientId,
            params.clientSecret,
            'accessToken',
            body.accessToken,
            expireIn,
          ).catch(() => undefined);
          return emptyResult({ errorCode: null, errorMessage: null, latencyMs, ok: true });
        }
      } catch {
        // fall through to unknown
      }
      return emptyResult({
        errorCode: 'unknown',
        errorMessage: clipMessage('DingTalk token response missing accessToken'),
        latencyMs,
        ok: false,
      });
    }

    const errorBody = await readErrorBody(response);
    return emptyResult({
      errorCode: mapHttpError(errorBody.code),
      errorMessage: clipMessage(errorBody.message) ?? clipMessage(`HTTP ${response.status}`),
      latencyMs,
      ok: false,
    });
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (isTimeoutError(error) || controller.signal.aborted) {
      return emptyResult({
        errorCode: 'network',
        errorMessage: clipMessage('timeout'),
        latencyMs,
        ok: false,
      });
    }
    return emptyResult({
      errorCode: 'network',
      errorMessage: clipMessage(error instanceof Error ? error.message : 'network error'),
      latencyMs,
      ok: false,
    });
  } finally {
    clearTimeout(timer);
  }
};
