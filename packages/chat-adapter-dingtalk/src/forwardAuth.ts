import { createHmac, timingSafeEqual } from 'node:crypto';

export const DINGTALK_FORWARD_HEADER = 'x-lobe-dingtalk-forward';
export const DINGTALK_FORWARD_TS_HEADER = 'x-lobe-dingtalk-forward-ts';
export const DINGTALK_FORWARD_WINDOW_SECONDS = 300;

export interface DingTalkForwardAuthParams {
  appId: string;
  clientSecret: string;
  /** Unix seconds; defaults to now. Exposed for tests. */
  nowSeconds?: number;
}

const hmacHex = (clientSecret: string, appId: string, unixSeconds: number): string =>
  createHmac('sha256', clientSecret).update(`${appId}:${unixSeconds}`).digest('hex');

const readHeader = (
  headers: Headers | Record<string, string | undefined | null>,
  name: string,
): string | undefined => {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const rec = headers as Record<string, string | undefined | null>;
  return rec[name] ?? rec[name.toLowerCase()] ?? rec[name.toUpperCase()] ?? undefined;
};

const safeEqualUtf8 = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
};

/**
 * Build the internal HMAC headers required on synthetic webhook POSTs to
 * `/api/agent/webhooks/dingtalk/:appId` (and the messenger equivalent).
 *
 * `x-lobe-dingtalk-forward` = HMAC-SHA256(key = clientSecret, message = `${appId}:${unixSeconds}`) hex
 * `x-lobe-dingtalk-forward-ts` = unixSeconds
 */
export function buildDingTalkForwardHeaders(
  params: DingTalkForwardAuthParams,
): Record<string, string> {
  const unixSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  return {
    [DINGTALK_FORWARD_HEADER]: hmacHex(params.clientSecret, params.appId, unixSeconds),
    [DINGTALK_FORWARD_TS_HEADER]: String(unixSeconds),
  };
}

/**
 * Verify internal forwarding headers. Returns false (caller should 401) when
 * either header is missing, the timestamp is outside ±300s, or the HMAC does
 * not match.
 */
export function verifyDingTalkForwardHeaders(
  headers: Headers | Record<string, string | undefined | null>,
  params: DingTalkForwardAuthParams,
): boolean {
  const signature = readHeader(headers, DINGTALK_FORWARD_HEADER);
  const tsRaw = readHeader(headers, DINGTALK_FORWARD_TS_HEADER);
  if (!signature || !tsRaw) return false;

  const unixSeconds = Number(tsRaw);
  if (!Number.isFinite(unixSeconds) || !Number.isInteger(unixSeconds)) return false;

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - unixSeconds) > DINGTALK_FORWARD_WINDOW_SECONDS) return false;

  const expected = hmacHex(params.clientSecret, params.appId, unixSeconds);
  return safeEqualUtf8(signature, expected);
}
