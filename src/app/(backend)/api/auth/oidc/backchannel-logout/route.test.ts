// @vitest-environment node
import type { JWTPayload } from 'jose';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { account, session } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import type { RuntimeIdentityProvider } from '@/libs/better-auth/sso/platformIdentityProvider';
import * as liveness from '@/server/enterprise/guards/userActiveCache';
import type * as OutboundHttp from '@/server/enterprise/security/outboundHttp';

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './route';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<OutboundHttp.SafeOutboundHttpClient['fetch']>(),
  deleteSession: vi.fn<(token: string) => Promise<void>>(),
  env: {
    AUTH_AUTHENTIK_ID: '',
    AUTH_AUTHENTIK_ISSUER: '',
    AUTH_AUTHENTIK_SECRET: '',
    AUTH_COOKIE_PREFIX: 'test-aihub',
  },
  initializeRedis: vi.fn(),
  set: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('@/database/server', async () => {
  const { getTestDB } = await import('@/database/core/getTestDB');
  return { serverDB: await getTestDB() };
});
vi.mock('@/auth', () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { deleteSession: mocks.deleteSession } }) },
}));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.env }));
vi.mock('@/envs/redis', () => ({ getRedisConfig: () => ({ enabled: true }) }));
vi.mock('@/libs/redis', () => ({ initializeRedis: mocks.initializeRedis }));
vi.mock('@/server/enterprise/services/identityProvider/startupArtifact', () => ({
  getInitializedIdentityProviderRuntimeArtifact: mocks.snapshot,
}));

vi.mock('@/server/enterprise/security/outboundHttp', async (importOriginal) => {
  const actual = await importOriginal<typeof OutboundHttp>();
  return {
    ...actual,
    SafeOutboundHttpClient: class {
      fetch = mocks.fetch;
      preflight = vi.fn(async () => '203.0.113.1');
    },
  };
});

const issuer = 'https://auth.example.com/application/o/aihub/';
const event = 'http://schemas.openid.net/event/backchannel-logout';
const provider = {
  autoProvision: true,
  buttonLabel: 'Authentik',
  claimMapping: {
    dingtalkTitle: [],
    dingtalkUserId: [],
    email: ['email'],
    name: ['name'],
    picture: [],
    subject: ['sub'],
  },
  clientId: 'aihub',
  clientSecret: 'test-secret',
  dingtalkAllowedCorps: [],
  displayName: 'Authentik',
  domainAllowlist: [],
  enabled: true,
  groupRoleMapping: {},
  icon: null,
  issuer,
  oidcMetadata: {
    authorizationEndpoint: `${issuer}authorize/`,
    authorizationResponseIssParameterSupported: false,
    codeChallengeMethodsSupported: ['S256'],
    idTokenSigningAlgValuesSupported: ['RS256', 'ES256'],
    issuer,
    jwksUri: `${issuer}jwks/`,
    responseTypesSupported: ['code'],
    scopesSupported: ['openid'],
    subjectTypesSupported: ['public'],
    tokenEndpoint: `${issuer}token/`,
    tokenEndpointAuthMethodsSupported: ['client_secret_basic'],
    userinfoEndpoint: null,
  },
  providerKey: 'authentik',
  revision: 1,
  scopes: ['openid'],
  secretFingerprint: 'test-fingerprint',
  type: 'authentik',
  usePkce: true,
} satisfies RuntimeIdentityProvider;

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let ecKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: Awaited<ReturnType<typeof exportJWK>>[] };
let sequence = 0;
const replayKeys = new Set<string>();
const secondarySessions = new Set<string>();
const mint = async (overrides: JWTPayload = {}, key = keys.privateKey, alg = 'RS256') => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    aud: 'aihub',
    events: { [event]: {} },
    exp: now + 600,
    iat: now,
    iss: issuer,
    jti: `logout-${++sequence}`,
    sid: 'upstream-session',
    sub: 'subject-a',
    ...overrides,
  })
    .setProtectedHeader({ alg, kid: alg, typ: 'logout+jwt' })
    .sign(key);
};
const request = (token: string) =>
  new Request('https://chat.example.com/api/auth/oidc/backchannel-logout', {
    body: new URLSearchParams({ logout_token: token }),
    method: 'POST',
  });
const remainingSessions = async () => {
  const rows = await serverDB.select({ token: session.token }).from(session).orderBy(session.token);
  return rows.map((row) => row.token);
};

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  ecKeys = await generateKeyPair('ES256');
  jwks = {
    keys: [
      { ...(await exportJWK(keys.publicKey)), alg: 'RS256', kid: 'RS256' },
      { ...(await exportJWK(ecKeys.publicKey)), alg: 'ES256', kid: 'ES256' },
    ],
  };
});

beforeEach(async () => {
  vi.clearAllMocks();
  liveness.resetUserActiveCacheForTest();
  replayKeys.clear();
  secondarySessions.clear();
  for (const token of ['a-1', 'a-2', 'b-1', 'other-provider']) secondarySessions.add(token);
  mocks.deleteSession.mockImplementation(async (token) => {
    secondarySessions.delete(token);
  });
  mocks.initializeRedis.mockResolvedValue({ set: mocks.set });
  mocks.set.mockImplementation(async (key: string) => {
    if (replayKeys.has(key)) return null;
    replayKeys.add(key);
    return 'OK';
  });
  mocks.snapshot.mockReturnValue({
    databaseProviders: [provider],
    phase: 'ready',
    providerIds: ['authentik'],
  });
  Object.assign(mocks.env, {
    AUTH_AUTHENTIK_ID: '',
    AUTH_AUTHENTIK_ISSUER: '',
    AUTH_AUTHENTIK_SECRET: '',
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(liveness, 'bumpUserActiveCacheEpoch');
  mocks.fetch.mockImplementation(async (url) => {
    const body = String(url).endsWith('/jwks/')
      ? jwks
      : {
          authorization_endpoint: provider.oidcMetadata.authorizationEndpoint,
          code_challenge_methods_supported: ['S256'],
          id_token_signing_alg_values_supported: ['RS256'],
          issuer,
          jwks_uri: provider.oidcMetadata.jwksUri,
          response_types_supported: ['code'],
          scopes_supported: ['openid'],
          subject_types_supported: ['public'],
          token_endpoint: provider.oidcMetadata.tokenEndpoint,
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        };
    return {
      arrayBuffer: async () => new ArrayBuffer(0),
      body: Buffer.from(JSON.stringify(body)),
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(body),
      truncated: false,
      url: String(url),
    };
  });
  await serverDB.delete(session);
  await serverDB.delete(account);
  await serverDB.delete(users);
  await serverDB.insert(users).values(['user-a', 'user-b', 'user-other'].map((id) => ({ id })));
  await serverDB.insert(account).values([
    { accountId: 'subject-a', id: 'account-a', providerId: 'authentik', userId: 'user-a' },
    {
      accountId: 'subject-a',
      id: 'account-a-duplicate',
      providerId: 'authentik',
      userId: 'user-a',
    },
    { accountId: 'subject-b', id: 'account-b', providerId: 'authentik', userId: 'user-b' },
    { accountId: 'subject-a', id: 'account-other', providerId: 'other', userId: 'user-other' },
  ]);
  await serverDB.insert(session).values(
    [
      { token: 'a-1', userId: 'user-a' },
      { token: 'a-2', userId: 'user-a' },
      { token: 'b-1', userId: 'user-b' },
      { token: 'other-provider', userId: 'user-other' },
    ].map((row) => ({ ...row, expiresAt: new Date(Date.now() + 3600000), id: row.token })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('OIDC back-channel logout', () => {
  it('revokes every matching user session, evicts secondary storage, and invalidates liveness', async () => {
    // Prime the same cache consulted by API requests carrying the signed cookie cache.
    await liveness.assertUserActiveCached(serverDB, 'user-a', { sessionId: 'a-1' });
    const response = await POST(request(await mint()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await remainingSessions()).toEqual(['b-1', 'other-provider']);
    expect([...secondarySessions].sort()).toEqual(['b-1', 'other-provider']);
    expect(mocks.deleteSession).toHaveBeenCalledTimes(2);
    expect(liveness.bumpUserActiveCacheEpoch).toHaveBeenCalledOnce();
    await expect(
      liveness.assertUserActiveCached(serverDB, 'user-a', { sessionId: 'a-1' }),
    ).rejects.toThrow();
    await expect(
      liveness.assertUserActiveCached(serverDB, 'user-b', { sessionId: 'b-1' }),
    ).resolves.toBeUndefined();
    expect(console.info).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'oidc.backchannel_logout',
        providerKey: 'authentik',
        sessionsRevoked: 2,
        sub: 'subject-a',
      }),
    );
  });

  it('supports a generic OIDC runtime provider', async () => {
    mocks.snapshot.mockReturnValue({
      databaseProviders: [{ ...provider, type: 'generic_oidc' }],
      providerIds: ['authentik'],
    });
    expect((await POST(request(await mint()))).status).toBe(200);
  });

  it('revokes all distinct users linked to the provider subject', async () => {
    await serverDB.insert(account).values({
      accountId: 'subject-a',
      id: 'second-matching-user',
      providerId: 'authentik',
      userId: 'user-b',
    });
    expect((await POST(request(await mint()))).status).toBe(200);
    expect(await remainingSessions()).toEqual(['other-provider']);
    expect([...secondarySessions]).toEqual(['other-provider']);
  });

  it('does not enable an env provider merely because credentials exist', async () => {
    mocks.snapshot.mockReturnValue({ databaseProviders: [], providerIds: [] });
    Object.assign(mocks.env, {
      AUTH_AUTHENTIK_ID: 'aihub',
      AUTH_AUTHENTIK_ISSUER: issuer,
      AUTH_AUTHENTIK_SECRET: 'secret',
    });
    expect((await POST(request(await mint()))).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await remainingSessions()).toHaveLength(4);
  });

  it('supports the enabled env Authentik provider without database providers', async () => {
    mocks.snapshot.mockReturnValue({ databaseProviders: [], providerIds: ['authentik'] });
    Object.assign(mocks.env, {
      AUTH_AUTHENTIK_ID: 'aihub',
      AUTH_AUTHENTIK_ISSUER: issuer,
      AUTH_AUTHENTIK_SECRET: 'secret',
    });
    expect((await POST(request(await mint()))).status).toBe(200);
    expect(await remainingSessions()).toEqual(['b-1', 'other-provider']);
    expect(mocks.fetch).toHaveBeenCalledWith(
      `${issuer}.well-known/openid-configuration`,
      expect.anything(),
    );
  });

  it('accepts ES256, multiple audiences, and sub without sid', async () => {
    expect(
      (
        await POST(
          request(
            await mint(
              { aud: ['another-client', 'aihub'], sid: undefined },
              ecKeys.privateKey,
              'ES256',
            ),
          ),
        )
      ).status,
    ).toBe(200);
  });

  it('returns the same success when the subject has no sessions', async () => {
    const response = await POST(request(await mint({ sub: 'not-present' })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(await remainingSessions()).toHaveLength(4);
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown issuer', { iss: 'https://unknown.example.com/' }],
    ['bad audience', { aud: 'other-client' }],
    ['nonce present', { nonce: 'nonce' }],
    ['null nonce', { nonce: null }],
    ['missing events', { events: undefined }],
    ['wrong event', { events: { other: {} } }],
    ['malformed event', { events: { [event]: null } }],
    ['sid-only', { sub: undefined }],
    ['missing sub and sid', { sid: undefined, sub: undefined }],
    ['empty sub', { sub: '' }],
    ['malformed sid', { sid: 12 }],
    ['missing iat', { iat: undefined }],
    ['missing jti', { jti: undefined }],
    ['empty jti', { jti: '' }],
    ['expired', { exp: 1, iat: 0 }],
    ['old iat without exp', { exp: undefined, iat: 1 }],
    ['future iat', { iat: 9_999_999_999 }],
  ] satisfies Array<[string, JWTPayload]>)(
    'rejects %s without side effects',
    async (name, claims) => {
      const response = await POST(request(await mint(claims)));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        error: 'invalid_request',
        error_description:
          name === 'sid-only' ? expect.stringContaining('sid-only') : expect.any(String),
      });
      expect(await remainingSessions()).toHaveLength(4);
      expect(mocks.deleteSession).not.toHaveBeenCalled();
      expect(mocks.set).not.toHaveBeenCalled();
    },
  );

  it('rejects a bad signature', async () => {
    const wrongKeys = await generateKeyPair('RS256');
    expect((await POST(request(await mint({}, wrongKeys.privateKey)))).status).toBe(400);
    expect(await remainingSessions()).toHaveLength(4);
  });

  it('rejects replay atomically and retains jti until exp', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = await mint({ exp });
    const responses = await Promise.all([POST(request(token)), POST(request(token))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oidc:backchannel-logout:/),
      '1',
      { exat: exp, nx: true },
    );
    expect(mocks.deleteSession).toHaveBeenCalledTimes(2);
  });

  it('accepts a recent token without exp and limits its replay lifetime', async () => {
    const iat = Math.floor(Date.now() / 1000) - 100;
    expect((await POST(request(await mint({ exp: undefined, iat })))).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), '1', { exat: iat + 301, nx: true });
  });

  it('accepts an older token with an unexpired exp', async () => {
    expect(
      (await POST(request(await mint({ iat: Math.floor(Date.now() / 1000) - 600 })))).status,
    ).toBe(200);
  });

  it('fails closed when replay storage is unavailable', async () => {
    mocks.initializeRedis.mockResolvedValue(null);
    expect((await POST(request(await mint()))).status).toBe(400);
    expect(await remainingSessions()).toHaveLength(4);
  });

  it('invalidates liveness and reports failure when secondary-storage cleanup fails', async () => {
    mocks.deleteSession.mockRejectedValue(new Error('storage unavailable'));
    expect((await POST(request(await mint()))).status).toBe(400);
    expect(await remainingSessions()).toEqual(['b-1', 'other-provider']);
    expect(liveness.bumpUserActiveCacheEpoch).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledTimes(2);
  });

  it.each(['', 'logout_token=', 'logout_token=malformed', 'logout_token=a&logout_token=b'])(
    'rejects invalid form %s',
    async (body) => {
      const response = await POST(
        new Request('https://chat.example.com/api/auth/oidc/backchannel-logout', {
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(400);
      expect(await remainingSessions()).toHaveLength(4);
    },
  );

  it('rejects non-form requests', async () => {
    expect(
      (
        await POST(
          new Request('https://chat.example.com/api/auth/oidc/backchannel-logout', {
            body: '{}',
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(400);
  });

  it.each([GET, PUT, PATCH, DELETE, HEAD, OPTIONS])('rejects other methods with 405', (handler) => {
    const response = handler();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
