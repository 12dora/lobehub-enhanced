// @vitest-environment node
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { describe, expect, it, vi } from 'vitest';

const JIT_EMAIL = 'staff_1@dingtalk.jiefakj.com';
const JIT_USER = {
  email: JIT_EMAIL,
  emailVerified: true,
  id: 'user_jit',
};

const invokeHandleOAuthUserInfo = async (input: {
  isTrustedProvider?: boolean;
  localEmailVerified: boolean;
  providerId: string;
  trustedProviders: string[];
  userInfoEmail: string;
  userInfoEmailVerified: boolean;
}) => {
  const linkAccount = vi.fn().mockResolvedValue({ id: 'acc_linked' });
  const createSession = vi.fn().mockResolvedValue({ id: 'sess_1', userId: JIT_USER.id });
  const createOAuthUser = vi.fn();
  const findOAuthUser = vi.fn().mockResolvedValue({
    accounts: [],
    user: {
      email: JIT_EMAIL,
      emailVerified: input.localEmailVerified,
      id: JIT_USER.id,
    },
  });

  const result = await handleOAuthUserInfo(
    {
      context: {
        baseURL: 'https://app.test',
        internalAdapter: {
          createOAuthUser,
          createSession,
          findOAuthUser,
          linkAccount,
          updateUser: vi.fn(),
        },
        options: {
          account: {
            accountLinking: {
              enabled: true,
            },
          },
        },
        secret: 'x'.repeat(32),
        trustedProviders: input.trustedProviders,
      },
    } as never,
    {
      account: {
        accountId: 'idp-sub',
        providerId: input.providerId,
      },
      disableSignUp: true,
      isTrustedProvider: input.isTrustedProvider,
      userInfo: {
        email: input.userInfoEmail,
        emailVerified: input.userInfoEmailVerified,
        id: 'idp-sub',
        name: 'Alice',
      },
    },
  );

  return { createOAuthUser, findOAuthUser, linkAccount, result };
};

describe('JIT-shaped user linking via handleOAuthUserInfo', () => {
  it('lets a trusted Authentik provider link onto a JIT user with emailVerified true', async () => {
    const { linkAccount, result } = await invokeHandleOAuthUserInfo({
      localEmailVerified: true,
      providerId: 'authentik',
      trustedProviders: ['authentik'],
      userInfoEmail: JIT_EMAIL,
      userInfoEmailVerified: true,
    });

    expect(result.error).toBeNull();
    expect(linkAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'idp-sub',
        providerId: 'authentik',
        userId: JIT_USER.id,
      }),
    );
  });

  it('rejects Authentik linking when the JIT row is still unverified (requireLocalEmailVerified)', async () => {
    const { linkAccount, result } = await invokeHandleOAuthUserInfo({
      localEmailVerified: false,
      providerId: 'authentik',
      trustedProviders: ['authentik'],
      userInfoEmail: JIT_EMAIL,
      userInfoEmailVerified: true,
    });

    expect(result).toEqual({ data: null, error: 'account not linked' });
    expect(linkAccount).not.toHaveBeenCalled();
  });

  it('does not let an untrusted non-canonical DingTalk email attach to the JIT row', async () => {
    const { createOAuthUser, linkAccount, result } = await invokeHandleOAuthUserInfo({
      isTrustedProvider: false,
      localEmailVerified: true,
      providerId: 'dingtalk',
      trustedProviders: ['authentik'],
      userInfoEmail: 'union-1@corp.dingtalk.sso',
      userInfoEmailVerified: false,
    });

    expect(result).toEqual({ data: null, error: 'account not linked' });
    expect(linkAccount).not.toHaveBeenCalled();
    expect(createOAuthUser).not.toHaveBeenCalled();
  });
});
