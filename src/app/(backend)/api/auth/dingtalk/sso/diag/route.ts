import { createHash } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { getTrustedProxyClientIP } from '@/utils/clientIP';

export const runtime = 'nodejs';

/** Same 10/min policy as `POST /api/auth/dingtalk/sso`. */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const FIELD_MAX = 200;

const headers = { 'Cache-Control': 'no-store' };

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

const optionalField = z.string().max(FIELD_MAX).optional();

const diagBodySchema = z.object({
  jsapi: optionalField,
  message: optionalField,
  platform: optionalField,
  stage: z.string().min(1).max(FIELD_MAX),
});

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

const rateLimitMemory = new Map<string, RateLimitEntry>();

const clip = (value: string | null | undefined): string => {
  if (!value) return '';
  return value.length > FIELD_MAX ? value.slice(0, FIELD_MAX) : value;
};

const consumeMemoryRateLimit = (ip: string, now: number): boolean => {
  const existing = rateLimitMemory.get(ip);
  const entry =
    !existing || now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS
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
  return entry.count <= RATE_LIMIT_MAX;
};

const consumeDiagRateLimit = async (ip: string): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const digest = createHash('sha256').update(ip).digest('hex');
      const count = await redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        `messenger:dingtalk:sso-diag-rate:${digest}`,
        String(RATE_LIMIT_WINDOW_MS),
      );
      return Number(count) <= RATE_LIMIT_MAX;
    } catch {
      // Fall through to the in-process window when Redis is unavailable.
    }
  }
  return consumeMemoryRateLimit(ip, Date.now());
};

const noContent = () => new NextResponse(null, { headers, status: 204 });

const rateLimited = () =>
  NextResponse.json({ ok: false, reason: 'rate_limited' }, { headers, status: 429 });

export async function POST(req: NextRequest) {
  const socketAddress = (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
  const ip = (getTrustedProxyClientIP(req.headers, socketAddress) || 'unknown').slice(0, 128);

  if (!(await consumeDiagRateLimit(ip))) {
    return rateLimited();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noContent();
  }

  const parsed = diagBodySchema.safeParse(body);
  if (!parsed.success) {
    return noContent();
  }

  const { jsapi, message, platform, stage } = parsed.data;
  console.warn(
    `[dingtalk-sso-diag] stage=${clip(stage)} platform=${clip(platform)} jsapi=${clip(jsapi)} message=${clip(message)} ua=${clip(req.headers.get('user-agent'))}`,
  );

  return noContent();
}
