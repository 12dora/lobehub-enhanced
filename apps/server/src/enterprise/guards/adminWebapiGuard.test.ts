// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_ERROR_CODES, PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';
import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { getTestDB } from '@/database/core/getTestDB';
import { session } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { ADMIN_REAUTH_MAX_AGE_MS } from '../contracts/adminUsers';
import { createAdminAuthorizationFixture } from '../testing/adminAuthorizationFixture';
import { withAdminWebapiGuard } from './adminWebapiGuard';

const db: LobeChatDatabase = await getTestDB();
const fixture = createAdminAuthorizationFixture({ namespace: 'admin-webapi-guard' });

const consume = vi.hoisted(() =>
  vi.fn(async (): Promise<'allowed' | 'limited' | 'unavailable'> => 'allowed'),
);
const getSession = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => db),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
    },
  },
}));

vi.mock('../security/rateLimit/adminMutationRateLimiter', () => ({
  getSharedAdminMutationRateLimiter: () => ({ consume }),
}));

const handler = vi.fn(async () => Response.json({ ok: true }, { status: 200 }));

const guard = withAdminWebapiGuard({
  dangerous: true,
  denied: {
    action: 'network_proxy.engine.install',
    targetId: 'engine',
    targetType: 'network_proxy_engine',
  },
  permission: PLATFORM_PERMISSIONS.NETWORK_PROXY_MANAGE,
  procedure: 'admin.networkProxy.uploadArtifact',
});

const requestFor = async (userId: string, createdAt: Date) => {
  // The guard live-checks auth_sessions for the Better Auth session id. A mocked
  // getSession whose id is not a live row for this user is ADMIN_ACCESS_DENIED.
  const id = `sess-${userId}`;
  await db.delete(session).where(eq(session.userId, userId));
  await db.insert(session).values({
    createdAt,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    id,
    token: `token-${userId}`,
    updatedAt: new Date(),
    userId,
  });
  getSession.mockResolvedValue({
    session: { createdAt, id },
    user: { id: userId },
  });
  return new Request('https://app.lobehub.com/webapi/admin/network-proxy/artifact?kind=engine', {
    method: 'POST',
  });
};

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('ENABLE_PLATFORM_ADMIN', '1');
  consume.mockReset();
  consume.mockResolvedValue('allowed');
  getSession.mockReset();
  handler.mockClear();
  await fixture.setup(db);
});

afterEach(async () => {
  await fixture.cleanup(db);
  vi.unstubAllEnvs();
});

describe('withAdminWebapiGuard', () => {
  it('allows a recent interactive session with NETWORK_PROXY_MANAGE', async () => {
    const req = await requestFor(fixture.actors.superAdmin, new Date());
    const res = await guard(handler)(req, { serverDB: db, userId: fixture.actors.superAdmin });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: fixture.actors.superAdmin,
        procedure: 'admin.networkProxy.uploadArtifact',
      }),
    );
  });

  it('denies an auditor without manage permission', async () => {
    const req = await requestFor(fixture.actors.auditor, new Date());
    const res = await guard(handler)(req, { serverDB: db, userId: fixture.actors.auditor });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: PLATFORM_ERROR_CODES.PLATFORM_PERMISSION_DENIED });
    expect(handler).not.toHaveBeenCalled();
  });

  it('requires recent reauth for dangerous uploads', async () => {
    const req = await requestFor(
      fixture.actors.superAdmin,
      new Date(Date.now() - ADMIN_REAUTH_MAX_AGE_MS - 1000),
    );
    const res = await guard(handler)(req, { serverDB: db, userId: fixture.actors.superAdmin });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: ADMIN_ERROR_CODES.ADMIN_REAUTH_REQUIRED });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed when the mutation limiter is exhausted', async () => {
    consume.mockResolvedValue('limited');
    const req = await requestFor(fixture.actors.superAdmin, new Date());
    const res = await guard(handler)(req, { serverDB: db, userId: fixture.actors.superAdmin });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: ADMIN_ERROR_CODES.ADMIN_RATE_LIMITED });
    expect(handler).not.toHaveBeenCalled();
  });
});
