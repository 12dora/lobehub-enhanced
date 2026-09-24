// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import type { LobeChatDatabase } from '@/database/type';

// Flag-off getCapabilities still reads the managed-resource policy table. The
// test-env db adaptor is an empty object (`select` is missing); use PGlite.
const db: LobeChatDatabase = await getTestDB();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => db),
}));

const { createCallerFactory } = await import('@/libs/trpc/lambda');
const { createContextInner } = await import('@/libs/trpc/lambda/context');
const { lambdaRouter } = await import('../index');

const createCaller = createCallerFactory(lambdaRouter);

/**
 * Flag-off regression for platform mount on lambda root.
 * Default env must yield disabled snapshots without secrets/roles.
 */
describe('lambdaRouter platform mount (flag-off)', () => {
  it('exposes platform.getCapabilities with disabled defaults for authed user', async () => {
    const ctx = await createContextInner({ userId: 'u1' });
    const caller = createCaller(ctx);
    const caps = await caller.platform.getCapabilities();

    expect(caps.adminAccess).toBe(false);
    expect(caps.features.platformAdmin).toBe(false);
    expect(caps).not.toHaveProperty('roles');
    expect(caps).not.toHaveProperty('permissions');
  });

  it('rejects anonymous getCapabilities', async () => {
    const ctx = await createContextInner();
    const caller = createCaller(ctx);
    await expect(caller.platform.getCapabilities()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('exposes platform.getPublicSnapshot for anonymous', async () => {
    const ctx = await createContextInner();
    const caller = createCaller(ctx);
    const snap = await caller.platform.getPublicSnapshot();

    expect(snap.platformName).toBeNull();
    expect(snap.login.workAccountEnabled).toBe(false);
  });
});
