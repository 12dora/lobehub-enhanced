// @vitest-environment node
/**
 * Six-order identity convergence through the real better-auth linking guard.
 *
 * Authentik (A), direct DingTalk login (D), and robot/免登 JIT (J) must land on
 * one AIHub user regardless of arrival order. Linking is the production
 * `handleOAuthUserInfo` path (`requireLocalEmailVerified` default true;
 * `isTrustedProvider` for Authentik; per-login `emailVerified` for DingTalk).
 *
 * JIT inserts `emailVerified: true` — the product invariant from DingTalk
 * provisioning — so J-first orders can link.
 */
import { DINGTALK_IDENTITY_EMAIL_DOMAIN, DINGTALK_IDENTITY_PROVIDER_ISSUER } from '@lobechat/types';
import { betterAuth } from 'better-auth';
import type { MemoryDB } from 'better-auth/adapters/memory';
import { memoryAdapter } from 'better-auth/adapters/memory';
import type { GenericOAuthConfig } from 'better-auth/plugins';
import { genericOAuth } from 'better-auth/plugins';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type PinnedTransport,
  type PinnedTransportResponse,
  SafeOutboundHttpClient,
} from '@/server/enterprise/security/outboundHttp';
import {
  buildDingTalkDiscoveryMetadata,
  resetDingTalkIdpLegacyTokenCacheForTest,
} from '@/server/enterprise/services/identityProvider/kinds';

import {
  buildPlatformIdentityProvider,
  type RuntimeIdentityProvider,
} from './platformIdentityProvider';
import { platformIdentityProviderState } from './platformIdentityProviderState';

const baseURL = 'https://app.example.test/api/auth';
const publicAddress = '93.184.216.34';
const allowlist = [{ addedAt: '2026-01-01T00:00:00.000Z', corpId: 'ding42' }];

const STAFF_ID = 'staff-1';
const UNION_ID = 'union-1';
const AUTHENTIK_ACCOUNT_ID = `ak-${STAFF_ID}`;
const CANONICAL_EMAIL = `${STAFF_ID}@${DINGTALK_IDENTITY_EMAIL_DOMAIN}`;

const jsonResponse = (body: unknown): PinnedTransportResponse => ({
  body: Buffer.from(JSON.stringify(body)),
  headers: { 'content-type': 'application/json; charset=utf-8' },
  status: 200,
  statusText: 'OK',
});

const jsonFetchResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const runtimeProvider = (): RuntimeIdentityProvider => ({
  autoProvision: true,
  buttonLabel: '使用钉钉登录',
  claimMapping: {
    dingtalkTitle: [],
    dingtalkUserId: ['unionId'],
    email: ['email'],
    name: ['nick'],
    picture: ['avatarUrl'],
    subject: ['unionId'],
  },
  clientId: 'app-key',
  clientSecret: 'app-secret',
  dingtalkAllowedCorps: allowlist,
  displayName: 'DingTalk',
  domainAllowlist: [],
  enabled: true,
  groupRoleMapping: {},
  icon: 'dingtalk',
  issuer: DINGTALK_IDENTITY_PROVIDER_ISSUER,
  oidcMetadata: buildDingTalkDiscoveryMetadata(DINGTALK_IDENTITY_PROVIDER_ISSUER),
  providerKey: 'dingtalk',
  revision: 1,
  scopes: ['openid', 'corpid'],
  secretFingerprint: 'a'.repeat(64),
  type: 'dingtalk',
  usePkce: true,
});

interface MessengerLink {
  platform: 'dingtalk';
  platformUserId: string;
  userId: string;
}

const createHarness = () => {
  const database: MemoryDB = { account: [], session: [], user: [], verification: [] };
  const messengerLinks: MessengerLink[] = [];

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/gettoken') {
      return jsonFetchResponse({ access_token: 'legacy-token', errcode: 0 });
    }
    if (url.pathname.endsWith('/topapi/user/getbyunionid')) {
      expect(JSON.parse(String(init?.body))).toEqual({ unionid: UNION_ID });
      return jsonFetchResponse({
        errcode: 0,
        result: { contact_type: 0, userid: STAFF_ID },
      });
    }
    throw new Error(`Unexpected native OAuth fetch: ${url}`);
  });

  const transport = vi.fn<PinnedTransport>(async (request) => {
    if (request.url.pathname.endsWith('/oauth2/userAccessToken')) {
      return jsonResponse({
        accessToken: 'access-token',
        corpId: 'ding42',
        expireIn: 7200,
      });
    }
    if (request.url.pathname.endsWith('/contact/users/me')) {
      return jsonResponse({
        avatarUrl: 'https://cdn.example.test/ada.png',
        nick: 'Ada',
        unionId: UNION_ID,
      });
    }
    throw new Error(`Unexpected DingTalk request: ${request.url.pathname}`);
  });
  const outbound = new SafeOutboundHttpClient({
    mode: 'public-only',
    resolve: async () => [{ address: publicAddress, family: 4 }],
    transport,
  });

  const dingtalkConfig = buildPlatformIdentityProvider(
    runtimeProvider(),
    'https://app.example.test',
    outbound,
  );

  const authentikConfig: GenericOAuthConfig = {
    authorizationUrl: 'https://authentik.example.test/authorize',
    clientId: 'ak-client',
    clientSecret: 'ak-secret',
    getToken: async () => ({ accessToken: 'ak-token', tokenType: 'Bearer' }),
    getUserInfo: async () => ({
      email: CANONICAL_EMAIL,
      emailVerified: true,
      id: AUTHENTIK_ACCOUNT_ID,
      name: 'Ada',
    }),
    pkce: false,
    providerId: 'authentik',
    tokenUrl: 'https://authentik.example.test/token',
  };

  const auth = betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: true,
        enabled: true,
        // Production default in define-config (unset). Explicit here so J-first
        // cannot paper over `requireLocalEmailVerified && !local.emailVerified`.
        requireLocalEmailVerified: true,
        trustedProviders: ['authentik'],
      },
      storeStateStrategy: 'database',
    },
    baseURL,
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true },
    plugins: [
      platformIdentityProviderState(['dingtalk']),
      genericOAuth({ config: [dingtalkConfig, authentikConfig] }),
    ],
    secret: 'platform-dingtalk-convergence-secret',
  });

  const cookiesOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ');

  const isSuccessfulLogin = (response: Response) =>
    response.headers.getSetCookie().some((cookie) => cookie.includes('session_token='));

  const oauth = async (providerId: 'authentik' | 'dingtalk') => {
    const start = await auth.handler(
      new Request(`${baseURL}/sign-in/oauth2`, {
        body: JSON.stringify({
          callbackURL: 'https://app.example.test/after-login',
          disableRedirect: true,
          providerId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    const body = (await start.json()) as { url: string };
    const authorizationUrl = new URL(body.url);
    const callbackUrl = new URL(`${baseURL}/oauth2/callback/${providerId}`);
    callbackUrl.searchParams.set('code', 'authorization-code');
    callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state')!);
    const response = await auth.handler(
      new Request(callbackUrl, { headers: { Cookie: cookiesOf(start) } }),
    );
    expect(isSuccessfulLogin(response), `${providerId} login should succeed`).toBe(true);
  };

  /**
   * Robot / 免登 JIT: find-or-create by canonical email. `emailVerified: true` is
   * the product invariant (provision.ts); J-first linking depends on it.
   */
  const jit = () => {
    const existing = database.user.find(
      (user) => String(user.email).toLowerCase() === CANONICAL_EMAIL,
    );
    const user =
      existing ??
      (() => {
        const created = {
          createdAt: new Date(),
          email: CANONICAL_EMAIL,
          emailVerified: true,
          id: `jit-${STAFF_ID}`,
          name: 'Ada',
          updatedAt: new Date(),
        };
        database.user.push(created);
        return created;
      })();
    if (
      !messengerLinks.some(
        (link) => link.platform === 'dingtalk' && link.platformUserId === STAFF_ID,
      )
    ) {
      messengerLinks.push({
        platform: 'dingtalk',
        platformUserId: STAFF_ID,
        userId: String(user.id),
      });
    }
  };

  return {
    authentik: () => oauth('authentik'),
    database,
    dingtalk: () => oauth('dingtalk'),
    jit,
    messengerLinks,
  };
};

type Path = 'A' | 'D' | 'J';

const ORDERS: Path[][] = [
  ['A', 'D', 'J'],
  ['A', 'J', 'D'],
  ['D', 'A', 'J'],
  ['D', 'J', 'A'],
  ['J', 'A', 'D'],
  ['J', 'D', 'A'],
];

describe('DingTalk identity convergence across Authentik, direct login, and JIT', () => {
  beforeEach(() => {
    delete process.env.DINGTALK_IDENTITY_EMAIL_DOMAIN;
    resetDingTalkIdpLegacyTokenCacheForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(ORDERS.map((order) => [order.join('→'), order] as const))(
    '%s lands on one user with three linked identities',
    async (_label, order) => {
      const harness = createHarness();

      for (const path of order) {
        if (path === 'A') await harness.authentik();
        else if (path === 'D') await harness.dingtalk();
        else harness.jit();
      }

      expect(harness.database.user).toHaveLength(1);
      expect(harness.database.user[0]!.email).toBe(CANONICAL_EMAIL);
      expect(harness.database.user[0]!.emailVerified).toBe(true);
      expect(
        harness.database.account.filter((account) => account.providerId === 'authentik'),
      ).toEqual([
        expect.objectContaining({
          accountId: AUTHENTIK_ACCOUNT_ID,
          providerId: 'authentik',
          userId: harness.database.user[0]!.id,
        }),
      ]);
      expect(
        harness.database.account.filter((account) => account.providerId === 'dingtalk'),
      ).toEqual([
        expect.objectContaining({
          accountId: UNION_ID,
          providerId: 'dingtalk',
          userId: harness.database.user[0]!.id,
        }),
      ]);
      expect(harness.messengerLinks).toEqual([
        {
          platform: 'dingtalk',
          platformUserId: STAFF_ID,
          userId: harness.database.user[0]!.id,
        },
      ]);
    },
  );
});
