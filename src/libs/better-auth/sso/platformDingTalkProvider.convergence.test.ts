// @vitest-environment node
/**
 * Six-order identity convergence: Authentik (A), direct DingTalk login (D), and
 * robot/免登 JIT (J) must land on one AIHub user regardless of arrival order.
 *
 * HTTP to DingTalk is mocked. better-auth is replaced by an in-memory adapter
 * that implements the production linking rule for kind `dingtalk`:
 * implicit link ONLY when the login email is the canonical corp identity
 * address (`emailVerified` on the profile — the per-login hook, not global
 * `trustedProviders`). Authentik is trusted. JIT upserts by canonical email
 * and writes a messenger link.
 */
import { DINGTALK_IDENTITY_EMAIL_DOMAIN } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDingTalkCanonicalLinkingEmail,
  toDingTalkLoginClaims,
} from '@/server/enterprise/services/identityProvider/kinds';

const STAFF_ID = 'staff-1';
const UNION_ID = 'union-1';
const AUTHENTIK_ACCOUNT_ID = `ak-${STAFF_ID}`;
const CANONICAL_EMAIL = `${STAFF_ID}@${DINGTALK_IDENTITY_EMAIL_DOMAIN}`;

const jsonFetchResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });

interface MockUser {
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
}

interface MockAccount {
  accountId: string;
  providerId: string;
  userId: string;
}

interface MockMessengerLink {
  platform: 'dingtalk';
  platformUserId: string;
  userId: string;
}

const mockDingTalkLookup = () => {
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
    throw new Error(`Unexpected native fetch: ${url}`);
  });
};

class MockIdentityAdapter {
  accounts: MockAccount[] = [];
  messengerLinks: MockMessengerLink[] = [];
  users: MockUser[] = [];

  findUserByEmail(email: string) {
    const key = email.toLowerCase();
    return this.users.find((user) => user.email.toLowerCase() === key);
  }

  private createUser(input: Omit<MockUser, 'id'>): MockUser {
    const existing = this.findUserByEmail(input.email);
    if (existing) return existing;
    const user: MockUser = { ...input, id: `user-${this.users.length + 1}` };
    this.users.push(user);
    return user;
  }

  private linkAccount(userId: string, providerId: string, accountId: string) {
    if (
      this.accounts.some(
        (account) => account.providerId === providerId && account.accountId === accountId,
      )
    ) {
      return;
    }
    this.accounts.push({ accountId, providerId, userId });
  }

  /** Authentik is a trusted provider: link (or create) by the canonical email. */
  authentik(): MockUser {
    const user =
      this.findUserByEmail(CANONICAL_EMAIL) ??
      this.createUser({ email: CANONICAL_EMAIL, emailVerified: true, name: 'Ada' });
    this.linkAccount(user.id, 'authentik', AUTHENTIK_ACCOUNT_ID);
    return user;
  }

  /**
   * Direct DingTalk login. Account id stays unionId. Linking is allowed only
   * when the profile email is the canonical address (per-login `emailVerified`).
   */
  async dingtalk(): Promise<MockUser> {
    const claims = await toDingTalkLoginClaims(
      { nick: 'Ada', unionId: UNION_ID },
      {
        clientId: 'app-key',
        clientSecret: 'app-secret',
        providerKey: 'dingtalk',
      },
    );
    const existing = this.findUserByEmail(claims.email);
    if (existing) {
      if (!claims.emailVerified || !isDingTalkCanonicalLinkingEmail(claims.email)) {
        throw new Error('account not linked');
      }
      if (existing.email.toLowerCase() !== claims.email.toLowerCase()) {
        throw new Error('account not linked');
      }
      this.linkAccount(existing.id, 'dingtalk', claims.id);
      return existing;
    }
    const user = this.createUser({
      email: claims.email,
      emailVerified: claims.emailVerified,
      name: claims.nick,
    });
    this.linkAccount(user.id, 'dingtalk', claims.id);
    return user;
  }

  /** Robot / 免登 JIT: find-or-create by canonical email and upsert the messenger link. */
  jit(): MockUser {
    const user =
      this.findUserByEmail(CANONICAL_EMAIL) ??
      this.createUser({ email: CANONICAL_EMAIL, emailVerified: false, name: 'Ada' });
    if (
      !this.messengerLinks.some(
        (link) => link.platform === 'dingtalk' && link.platformUserId === STAFF_ID,
      )
    ) {
      this.messengerLinks.push({
        platform: 'dingtalk',
        platformUserId: STAFF_ID,
        userId: user.id,
      });
    }
    return user;
  }
}

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
    mockDingTalkLookup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(ORDERS.map((order) => [order.join('→'), order] as const))(
    '%s lands on one user with three linked identities',
    async (_label, order) => {
      const adapter = new MockIdentityAdapter();

      for (const path of order) {
        if (path === 'A') adapter.authentik();
        else if (path === 'D') await adapter.dingtalk();
        else adapter.jit();
      }

      expect(adapter.users).toHaveLength(1);
      expect(adapter.users[0]!.email).toBe(CANONICAL_EMAIL);
      expect(adapter.accounts.filter((account) => account.providerId === 'authentik')).toEqual([
        {
          accountId: AUTHENTIK_ACCOUNT_ID,
          providerId: 'authentik',
          userId: adapter.users[0]!.id,
        },
      ]);
      expect(adapter.accounts.filter((account) => account.providerId === 'dingtalk')).toEqual([
        { accountId: UNION_ID, providerId: 'dingtalk', userId: adapter.users[0]!.id },
      ]);
      expect(adapter.messengerLinks).toEqual([
        { platform: 'dingtalk', platformUserId: STAFF_ID, userId: adapter.users[0]!.id },
      ]);
    },
  );
});
