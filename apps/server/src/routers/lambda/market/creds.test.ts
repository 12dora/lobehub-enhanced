// @vitest-environment node
import { MarketAPIError } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockOrgCredRow {
  id: number;
  key: string;
  ownerType?: string;
}

const {
  mockListConnections,
  mockOrgCredsList,
  mockPersonalCredsList,
  mockPersonalCredsShare,
  mockPersonalCredsPublish,
  mockPersonalCredsUnshare,
  sdkAuth,
} = vi.hoisted(() => ({
  mockListConnections: vi.fn(async () => ({ connections: [{ id: 'conn-1' }], success: true })),
  mockOrgCredsList: vi.fn(async (): Promise<{ data: MockOrgCredRow[] }> => ({
    data: [{ id: 1, key: 'ORG_SECRET' }],
  })),
  mockPersonalCredsList: vi.fn(async () => ({ data: [{ id: 2, key: 'PERSONAL_SECRET' }] })),
  mockPersonalCredsPublish: vi.fn(async (id: number) => ({ id, visibility: 'public' })),
  mockPersonalCredsShare: vi.fn(async (id: number) => ({ id, visibility: 'private' })),
  mockPersonalCredsUnshare: vi.fn(async (id: number) => ({ id, visibility: 'private' })),
  // Mirrors what MarketService writes onto the SDK. `trustedToken` is applied
  // only when the procedure passes `userInfo` (trusted-client configuration).
  sdkAuth: {
    clientId: undefined as string | undefined,
    clientSecret: undefined as string | undefined,
    trustedToken: undefined as string | undefined,
  },
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withRbacPermission: vi.fn(() => (opts: any) => opts.next(opts)),
}));

// Simulates the real `cloudWorkspaceAuth`: strips `workspaceId` off the
// context unless the caller is flagged as a workspace member.
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', () => ({
  cloudWorkspaceAuth: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        workspaceId: opts.ctx.isWorkspaceMember ? opts.ctx.workspaceId : undefined,
      },
    }),
  ),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketUserInfo: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketUserInfo: { email: 'actor@example.com', name: 'Actor', userId: 'user-1' },
      },
    }),
  ),
  requireMarketAuth: vi.fn((opts: any) => opts.next(opts)),
  serverDatabase: vi.fn((opts: any) => opts.next(opts)),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(
    (options?: {
      accessToken?: string;
      clientCredentials?: { clientId?: string; clientSecret?: string };
      trustedClientToken?: string;
      userInfo?: unknown;
    }) => {
      const headers: Record<string, string> = {};
      const accessToken = options?.accessToken?.trim();
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const trusted =
        options?.trustedClientToken?.trim() ||
        (options?.userInfo ? sdkAuth.trustedToken?.trim() : undefined);
      if (trusted) headers['x-lobe-trust-token'] = trusted;

      const clientId = options?.clientCredentials?.clientId?.trim() || sdkAuth.clientId?.trim();
      const clientSecret =
        options?.clientCredentials?.clientSecret?.trim() || sdkAuth.clientSecret?.trim();

      return {
        market: {
          clientId,
          clientSecret,
          connect: {
            clientId,
            clientSecret,
            headers,
            listConnections: mockListConnections,
          },
          creds: {
            list: mockPersonalCredsList,
            publish: mockPersonalCredsPublish,
            share: mockPersonalCredsShare,
            unshare: mockPersonalCredsUnshare,
          },
          headers,
          organizations: {
            creds: vi.fn(() => ({ list: mockOrgCredsList })),
          },
        },
      };
    },
  ),
}));

describe('credsRouter is always personal-scoped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkAuth.clientId = undefined;
    sdkAuth.clientSecret = undefined;
    sdkAuth.trustedToken = undefined;
  });

  // `market.creds` is the personal-creds router used directly by the browser
  // (standalone /settings/creds page, and the workspace creds page's "your
  // personal credentials" section). `ctx.workspaceId` is ambient — set on
  // every request whenever the caller has *any* workspace selected elsewhere
  // in the app, regardless of which page/section made the call. Routing
  // `list` (or any other procedure here) off that ambient value previously
  // made this router silently return the active workspace's org creds
  // instead of the caller's own personal creds — indistinguishable from
  // `workspaceCreds.list`. This must never happen again: `list` always
  // returns personal creds data, with or without an active (even verified)
  // workspace — the org list is only ever consulted (below) to scope the
  // `sharedToActiveWorkspace` enrichment, never to source the result.
  it('returns personal creds data, never the org list, when the caller is a verified workspace member', async () => {
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.list();

    expect(mockPersonalCredsList).toHaveBeenCalledTimes(1);
    expect(result.data?.map((c) => c.id)).toEqual([2]);
    expect(result.data?.every((c) => c.key !== 'ORG_SECRET')).toBe(true);
  });

  it('resolves personal creds outside any workspace context, without consulting the org list at all', async () => {
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: false,
      userId: 'user-1',
    } as any);

    const result = await caller.list();

    expect(mockPersonalCredsList).toHaveBeenCalledTimes(1);
    expect(mockOrgCredsList).not.toHaveBeenCalled();
    expect(result.data).toEqual([{ id: 2, key: 'PERSONAL_SECRET' }]);
  });
});

describe('credsRouter list scopes sharing to the active workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A personal credential can only be linked to one organization at a time —
  // `organizationAccountId != null` alone can't tell "shared to *this*
  // workspace" apart from "shared to some other workspace previously". `list`
  // cross-references the active workspace's own merged view (by id, among
  // entries it marks `ownerType: 'user'`) to compute this per credential.
  it('flags sharedToActiveWorkspace: true only when the credential appears as a user-owned entry in the active workspace org list', async () => {
    mockOrgCredsList.mockResolvedValueOnce({
      data: [{ id: 2, key: 'PERSONAL_SECRET', ownerType: 'user' }],
    });
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.list();

    expect(result.data).toEqual([{ id: 2, key: 'PERSONAL_SECRET', sharedToActiveWorkspace: true }]);
  });

  it('flags sharedToActiveWorkspace: false when the credential is not in the active workspace org list (e.g. shared to a different workspace)', async () => {
    // Org list has no entry for id 2 at all — simulates the credential being
    // linked to some *other* workspace instead.
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.list();

    expect(result.data).toEqual([
      { id: 2, key: 'PERSONAL_SECRET', sharedToActiveWorkspace: false },
    ]);
  });

  it('still returns the personal list if the active-workspace org lookup fails (e.g. org not set up yet)', async () => {
    mockOrgCredsList.mockRejectedValueOnce(new Error('org not found'));
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.list();

    expect(result.data).toEqual([{ id: 2, key: 'PERSONAL_SECRET' }]);
  });
});

describe('credsRouter share/publish/unshare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares a personal credential into the caller-verified workspace, never a client-supplied org', async () => {
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await caller.share({ id: 42, visibility: 'private' });

    expect(mockPersonalCredsShare).toHaveBeenCalledWith(42, {
      orgId: 'workspace:workspace-1',
      visibility: 'private',
    });
  });

  it('rejects share when there is no active (verified) workspace context', async () => {
    const { credsRouter } = await import('./creds');

    // Simulates both the personal-mode case (no header) and the forged-header
    // case (cloudWorkspaceAuth already stripped workspaceId for a non-member).
    const caller = credsRouter.createCaller({
      isWorkspaceMember: false,
      userId: 'user-1',
    } as any);

    await expect(caller.share({ id: 42 })).rejects.toThrow(
      'Sharing a credential requires an active workspace context',
    );
    expect(mockPersonalCredsShare).not.toHaveBeenCalled();
  });

  it('publishes a draft-linked credential without requiring an org id', async () => {
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.publish({ id: 42 });

    expect(mockPersonalCredsPublish).toHaveBeenCalledWith(42);
    expect(result).toEqual({ id: 42, visibility: 'public' });
  });

  it('unshares a credential, clearing its workspace link', async () => {
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.unshare({ id: 42 });

    expect(mockPersonalCredsUnshare).toHaveBeenCalledWith(42);
    expect(result).toEqual({ id: 42, visibility: 'private' });
  });

  it('maps a Market 403 (not a member) to a tRPC FORBIDDEN error', async () => {
    mockPersonalCredsShare.mockRejectedValueOnce(
      new MarketAPIError(403, 'Forbidden', { error: 'Not a member of this organization' }),
    );
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await expect(caller.share({ id: 42 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not a member of this organization',
    });
  });
});

describe('credsRouter.listOAuthConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkAuth.clientId = undefined;
    sdkAuth.clientSecret = undefined;
    sdkAuth.trustedToken = undefined;
  });

  it('returns an empty list and does not call market when the access token is missing', async () => {
    const { credsRouter } = await import('./creds');
    const caller = credsRouter.createCaller({ userId: 'user-1' } as any);

    await expect(caller.listOAuthConnections()).resolves.toEqual({
      connections: [],
      success: true,
    });
    expect(mockListConnections).not.toHaveBeenCalled();
  });

  it('returns an empty list when the access token is blank', async () => {
    const { credsRouter } = await import('./creds');
    const caller = credsRouter.createCaller({
      marketAccessToken: '   ',
      userId: 'user-1',
    } as any);

    await expect(caller.listOAuthConnections()).resolves.toEqual({
      connections: [],
      success: true,
    });
    expect(mockListConnections).not.toHaveBeenCalled();
  });

  it('lists connections when a market access token is present', async () => {
    const { credsRouter } = await import('./creds');
    const caller = credsRouter.createCaller({
      marketAccessToken: 'market-token',
      userId: 'user-1',
    } as any);

    await expect(caller.listOAuthConnections()).resolves.toEqual({
      connections: [{ id: 'conn-1' }],
      success: true,
    });
    expect(mockListConnections).toHaveBeenCalledOnce();
  });

  it('lists connections for a trusted-user configuration without a bearer token', async () => {
    sdkAuth.trustedToken = 'trust-token';
    const { credsRouter } = await import('./creds');
    const caller = credsRouter.createCaller({ userId: 'user-1' } as any);

    await expect(caller.listOAuthConnections()).resolves.toEqual({
      connections: [{ id: 'conn-1' }],
      success: true,
    });
    expect(mockListConnections).toHaveBeenCalledOnce();
  });

  it('lists connections for a client-credential configuration without a bearer token', async () => {
    sdkAuth.clientId = 'client-id';
    sdkAuth.clientSecret = 'client-secret';
    const { credsRouter } = await import('./creds');
    const caller = credsRouter.createCaller({ userId: 'user-1' } as any);

    await expect(caller.listOAuthConnections()).resolves.toEqual({
      connections: [{ id: 'conn-1' }],
      success: true,
    });
    expect(mockListConnections).toHaveBeenCalledOnce();
  });
});
