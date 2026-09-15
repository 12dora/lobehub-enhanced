import { NextResponse } from 'next/server';

import { getDingTalkSsoConfig } from '@/server/services/messenger/platforms/dingtalk/sso';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const config = await getDingTalkSsoConfig();
  if (!config.enabled) {
    return NextResponse.json({ ok: false, reason: 'disabled' }, { headers, status: 404 });
  }
  return NextResponse.json({ corpId: config.corpId, enabled: true }, { headers });
}
