import { type NextRequest, NextResponse } from 'next/server';

import type { DingTalkSsoFailReason } from '@/server/services/messenger/platforms/dingtalk/sso';
import {
  exchangeDingTalkSso,
  serializeDingTalkSsoSessionCookie,
} from '@/server/services/messenger/platforms/dingtalk/sso';
import { getTrustedProxyClientIP } from '@/utils/clientIP';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

const statusForReason = (reason: DingTalkSsoFailReason): number => {
  switch (reason) {
    case 'disabled':
    case 'user_not_found': {
      return 404;
    }
    case 'rate_limited': {
      return 429;
    }
    case 'exchange_failed': {
      return 502;
    }
    default: {
      return 400;
    }
  }
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { headers, status: 400 });
  }

  const record = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const socketAddress = (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
  const result = await exchangeDingTalkSso({
    code: 'code' in record ? record.code : undefined,
    ip: getTrustedProxyClientIP(req.headers, socketAddress) || 'unknown',
    redirect: 'redirect' in record ? record.redirect : undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { headers, status: result.httpStatus ?? statusForReason(result.reason) },
    );
  }

  const response = NextResponse.json({ ok: true, redirect: result.redirect }, { headers });
  response.headers.append('Set-Cookie', serializeDingTalkSsoSessionCookie(result.cookie));
  return response;
}
