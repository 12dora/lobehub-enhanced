// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { account } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import type { RuntimeIdentityProvider } from '@/libs/better-auth/sso/platformIdentityProvider';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  env: {
    AUTH_AUTHENTIK_ID: '',
    AUTH_AUTHENTIK_ISSUER: '',
    AUTH_AUTHENTIK_SECRET: '',
  },
  getSession: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('@/database/server', async () => {
  const { getTestDB } = await import('@/database/core/getTestDB');
  return { serverDB: await getTestDB() };
});
vi.mock('@/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://chat.example.test' } }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.env }));
vi.mock('@/server/enterprise/services/identityProvider/startupArtifact', () => ({
  getInitializedIdentityProviderRuntimeArtifact: mocks.snapshot,
}));

const issuer = 'https://auth.example.test/application/o/aihub/';
const idToken = 'header.payload.signature';
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
    idTokenSigningAlgValuesSupported: ['RS256'],
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

const request = () => new Request('https://chat.example.test/api/auth/oidc/end-session');

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: 'user-a' } });
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
  await serverDB.delete(account);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: 'user-a' });
  await serverDB.insert(account).values({
    accountId: 'subject-a',
    id: 'account-a',
    idToken,
    providerId: 'authentik',
    userId: 'user-a',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/auth/oidc/end-session', () => {
  it('returns Authentik end-session form fields when the session has a stored ID token', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      fields: {
        id_token_hint: idToken,
        post_logout_redirect_uri: 'https://chat.example.test/signin',
      },
      method: 'POST',
      url: 'https://auth.example.test/application/o/aihub/end-session/',
    });
  });

  it('returns 401 when the session cookie is missing', async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('returns 404 when the Authentik account has no stored ID token', async () => {
    await serverDB.update(account).set({ idToken: null }).where(eq(account.id, 'account-a'));
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('returns 404 when the session user does not own the stored ID token', async () => {
    await serverDB.insert(users).values({ id: 'user-b' });
    mocks.getSession.mockResolvedValue({ user: { id: 'user-b' } });
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({ error: 'not_found' });
    expect(JSON.stringify(body)).not.toContain(idToken);
  });

  it('returns 404 for a local credential account', async () => {
    await serverDB.delete(account);
    await serverDB.insert(account).values({
      accountId: 'local-a',
      id: 'account-local',
      idToken: 'should-not-leak',
      providerId: 'credential',
      userId: 'user-a',
    });
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('should-not-leak');
  });

  it('uses a custom Authentik provider key and issuer without a trailing slash', async () => {
    const customIssuer = 'https://auth.example.test/application/o/work-account';
    mocks.snapshot.mockReturnValue({
      databaseProviders: [{ ...provider, issuer: customIssuer, providerKey: 'work-account' }],
      providerIds: ['work-account'],
    });
    await serverDB.delete(account);
    await serverDB.insert(account).values({
      accountId: 'subject-a',
      id: 'account-work',
      idToken,
      providerId: 'work-account',
      userId: 'user-a',
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: 'https://auth.example.test/application/o/work-account/end-session/',
    });
  });

  it('supports the enabled env Authentik provider without database providers', async () => {
    mocks.snapshot.mockReturnValue({ databaseProviders: [], providerIds: ['authentik'] });
    Object.assign(mocks.env, {
      AUTH_AUTHENTIK_ID: 'aihub',
      AUTH_AUTHENTIK_ISSUER: issuer,
      AUTH_AUTHENTIK_SECRET: 'secret',
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fields: { id_token_hint: idToken },
      url: `${issuer}end-session/`,
    });
  });

  it('normalizes an env Authentik issuer that lacks a trailing slash', async () => {
    mocks.snapshot.mockReturnValue({ databaseProviders: [], providerIds: ['authentik'] });
    Object.assign(mocks.env, {
      AUTH_AUTHENTIK_ID: 'aihub',
      AUTH_AUTHENTIK_ISSUER: 'https://auth.example.test/application/o/aihub',
      AUTH_AUTHENTIK_SECRET: 'secret',
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: 'https://auth.example.test/application/o/aihub/end-session/',
    });
  });
});
