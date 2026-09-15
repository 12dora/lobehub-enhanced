import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildDingTalkForwardHeaders,
  DINGTALK_FORWARD_HEADER,
  DINGTALK_FORWARD_TS_HEADER,
  verifyDingTalkForwardHeaders,
} from './forwardAuth';

describe('DingTalk forward-auth headers', () => {
  const params = { appId: 'app_key', clientSecret: 'app_secret', nowSeconds: 1_700_000_000 };

  it('buildDingTalkForwardHeaders HMAC-SHA256s `${appId}:${unixSeconds}`', () => {
    const headers = buildDingTalkForwardHeaders(params);
    const expected = createHmac('sha256', 'app_secret').update('app_key:1700000000').digest('hex');
    expect(headers[DINGTALK_FORWARD_HEADER]).toBe(expected);
    expect(headers[DINGTALK_FORWARD_TS_HEADER]).toBe('1700000000');
  });

  it('verifyDingTalkForwardHeaders accepts a fresh signature', () => {
    const headers = buildDingTalkForwardHeaders(params);
    expect(verifyDingTalkForwardHeaders(headers, params)).toBe(true);
    expect(
      verifyDingTalkForwardHeaders(new Headers(headers), {
        ...params,
        nowSeconds: params.nowSeconds,
      }),
    ).toBe(true);
  });

  it('rejects missing headers, bad HMAC, and timestamps outside ±300s', () => {
    expect(verifyDingTalkForwardHeaders({}, params)).toBe(false);
    expect(
      verifyDingTalkForwardHeaders(
        { [DINGTALK_FORWARD_HEADER]: 'deadbeef', [DINGTALK_FORWARD_TS_HEADER]: '1700000000' },
        params,
      ),
    ).toBe(false);
    const headers = buildDingTalkForwardHeaders(params);
    expect(
      verifyDingTalkForwardHeaders(headers, { ...params, nowSeconds: params.nowSeconds + 301 }),
    ).toBe(false);
  });
});
