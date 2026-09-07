import { and, eq, inArray } from 'drizzle-orm';

import { account, session } from '@/database/schemas/betterAuth';
import { serverDB } from '@/database/server';
import {
  InvalidLogoutRequest,
  verifyBackchannelLogoutToken,
} from '@/libs/better-auth/oidcBackchannelLogout';
import { bumpUserActiveCacheEpoch } from '@/server/enterprise/guards/userActiveCache';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

// This dedicated route authenticates the signed logout token, without browser cookies or CSRF.
export const POST = async (request: Request): Promise<Response> => {
  try {
    if (
      request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/x-www-form-urlencoded'
    ) {
      throw new InvalidLogoutRequest('Expected application/x-www-form-urlencoded');
    }
    const form = await request.formData();
    const token = form.get('logout_token');
    if (typeof token !== 'string' || !token || form.getAll('logout_token').length !== 1) {
      throw new InvalidLogoutRequest('Exactly one logout_token is required');
    }
    const { providerKey, sub } = await verifyBackchannelLogoutToken(token);
    const matchingUsers = serverDB
      .selectDistinct({ userId: account.userId })
      .from(account)
      .where(and(eq(account.providerId, providerKey), eq(account.accountId, sub)));
    // Capture exactly the deleted rows, including sessions created since account lookup.
    const deleted = await serverDB
      .delete(session)
      .where(inArray(session.userId, matchingUsers))
      .returning({ token: session.token });

    try {
      if (deleted.length > 0) {
        const { auth } = await import('@/auth');
        const context = await auth.$context;
        // The adapter also maintains active-sessions-{userId}. Unlike the admin
        // best-effort wrapper, report failure if any secondary-storage eviction fails.
        const results = await Promise.allSettled(
          deleted.map(({ token }) => context.internalAdapter.deleteSession(token)),
        );
        if (results.some((result) => result.status === 'rejected')) {
          throw new Error('Logout secondary storage eviction failed');
        }
      }
    } finally {
      // Same immediate process invalidation and cross-instance 5s TTL as admin revoke.
      bumpUserActiveCacheEpoch();
    }

    console.info(
      JSON.stringify({
        event: 'oidc.backchannel_logout',
        providerKey,
        sessionsRevoked: deleted.length,
        sub,
      }),
    );
    return Response.json({}, { headers });
  } catch (error) {
    // Never serialize JWTs, session tokens, or Redis command arguments from thrown errors.
    console.error('OIDC back-channel logout failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return Response.json(
      {
        error: 'invalid_request',
        error_description:
          error instanceof InvalidLogoutRequest
            ? error.message
            : 'Logout token validation or session revocation failed',
      },
      { headers, status: 400 },
    );
  }
};

export const GET = () =>
  new Response(null, { headers: { ...headers, Allow: 'POST' }, status: 405 });
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const HEAD = GET;
export const OPTIONS = GET;
