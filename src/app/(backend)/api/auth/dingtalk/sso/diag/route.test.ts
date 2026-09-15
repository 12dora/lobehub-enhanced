// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedisEval = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({
    eval: mockRedisEval,
  })),
}));

const { POST } = await import('./route');

const DIAG_URL = 'https://app.example.test/api/auth/dingtalk/sso/diag';

const post = (
  body: unknown,
  init: { headers?: Record<string, string>; ip?: string; raw?: string } = {},
) =>
  POST(
    new NextRequest(DIAG_URL, {
      body: init.raw ?? JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'DingTalk/test',
        'x-forwarded-for': init.ip ?? '203.0.113.10',
        ...init.headers,
      },
      method: 'POST',
    }),
  );

const diagLogs = (warn: ReturnType<typeof vi.spyOn>) =>
  warn.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith('[dingtalk-sso-diag]'));

let warn: ReturnType<typeof vi.spyOn>;
let ipSeq = 0;

const nextIp = () => {
  ipSeq += 1;
  return `198.51.100.${ipSeq}`;
};

beforeEach(() => {
  mockRedisEval.mockReset();
  mockRedisEval.mockRejectedValue(new Error('use memory limiter'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.clearAllMocks();
});

describe('POST /api/auth/dingtalk/sso/diag', () => {
  it('returns 204, logs the truncated fields, and never echoes the body', async () => {
    const ip = nextIp();
    const response = await post(
      {
        extra: 'must-not-appear',
        jsapi: 'getAuthCode',
        message: 'errorCode: 5',
        platform: 'pc',
        secret: 'should-be-stripped',
        stage: 'authcode_failed',
      },
      { ip },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('');
    expect(diagLogs(warn)).toEqual([
      '[dingtalk-sso-diag] stage=authcode_failed platform=pc jsapi=getAuthCode message=errorCode: 5 ua=DingTalk/test',
    ]);
  });

  it('returns 204 without logging when the body is invalid JSON', async () => {
    const response = await post(null, { ip: nextIp(), raw: '{not-json' });

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
    expect(diagLogs(warn)).toEqual([]);
  });

  it('returns 204 without logging when stage is missing', async () => {
    const response = await post({ message: 'no stage', platform: 'pc' }, { ip: nextIp() });

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
    expect(diagLogs(warn)).toEqual([]);
  });

  it('returns 204 without logging when a field exceeds 200 characters', async () => {
    const response = await post({ message: 'x'.repeat(201), stage: 'timeout' }, { ip: nextIp() });

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
    expect(diagLogs(warn)).toEqual([]);
  });

  it('clips the user-agent in the log line to 200 characters', async () => {
    const ua = 'U'.repeat(250);
    const response = await post(
      { stage: 'success' },
      { headers: { 'user-agent': ua }, ip: nextIp() },
    );

    expect(response.status).toBe(204);
    expect(diagLogs(warn)).toEqual([
      `[dingtalk-sso-diag] stage=success platform= jsapi= message= ua=${'U'.repeat(200)}`,
    ]);
  });

  it('rate-limits using the last x-forwarded-for hop so a spoofed first hop is ignored', async () => {
    const lastHop = nextIp();
    const spoofed = '1.1.1.1';

    for (let i = 0; i < 10; i += 1) {
      const response = await POST(
        new NextRequest(DIAG_URL, {
          body: JSON.stringify({ stage: 'timeout' }),
          headers: {
            'cf-connecting-ip': '8.8.8.8',
            'content-type': 'application/json',
            'x-forwarded-for': `${spoofed}, ${lastHop}`,
          },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(204);
    }

    const blocked = await POST(
      new NextRequest(DIAG_URL, {
        body: JSON.stringify({ message: 'must-not-echo', stage: 'timeout' }),
        headers: {
          'cf-connecting-ip': '8.8.8.8',
          'content-type': 'application/json',
          'x-forwarded-for': `${spoofed}, ${lastHop}`,
        },
        method: 'POST',
      }),
    );
    expect(blocked.status).toBe(429);
    const blockedBody = await blocked.json();
    expect(blockedBody).toEqual({ ok: false, reason: 'rate_limited' });
    expect(JSON.stringify(blockedBody)).not.toContain('must-not-echo');

    const otherHop = await POST(
      new NextRequest(DIAG_URL, {
        body: JSON.stringify({ stage: 'timeout' }),
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `${lastHop}, ${nextIp()}`,
        },
        method: 'POST',
      }),
    );
    expect(otherHop.status).toBe(204);
  });

  it('returns 429 when Redis reports the IP is over the window', async () => {
    mockRedisEval.mockResolvedValueOnce(11);

    const response = await post({ message: 'must-not-echo', stage: 'timeout' }, { ip: nextIp() });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect(diagLogs(warn)).toEqual([]);
  });
});
