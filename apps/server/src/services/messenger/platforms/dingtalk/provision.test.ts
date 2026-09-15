// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByEmail = vi.fn();
const mockFindFirst = vi.fn();
const mockCreateUser = vi.fn();
const mockGetMessengerDingTalkConfig = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisEval = vi.fn();

vi.mock('@/database/models/user', () => ({
  UserModel: { findByEmail: (...args: unknown[]) => mockFindByEmail(...args) },
}));

vi.mock('@/database/schemas', () => ({
  users: { email: 'users.email' },
}));

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: (...args: unknown[]) => mockGetMessengerDingTalkConfig(...args),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({
    del: mockRedisDel,
    eval: mockRedisEval,
    set: mockRedisSet,
  })),
}));

vi.mock('@/auth', () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: { createUser: (...args: unknown[]) => mockCreateUser(...args) },
    }),
  },
}));

const {
  DINGTALK_LEGACY_TOKEN_URL,
  DINGTALK_PROVISION_RATE_KEY,
  DINGTALK_PROVISION_RATE_LIMIT_MAX,
  DINGTALK_USER_GET_URL,
  ensureDingTalkUser,
  resetDingTalkProvisionStateForTest,
} = await import('./provision');

const serverDB = { query: { users: { findFirst: mockFindFirst } } } as any;

const VALID_CONFIG = {
  clientId: 'app_key',
  clientSecret: 'app_secret',
  robotCode: 'robot_1',
};

const jsonResponse = (body: unknown) =>
  ({
    json: async () => body,
    ok: true,
    status: 200,
  }) as Response;

const EXISTING_USER = { email: 'staff_1@dingtalk.jiefakj.com', id: 'user_1' };

beforeEach(() => {
  resetDingTalkProvisionStateForTest();
  vi.clearAllMocks();
  mockFindByEmail.mockResolvedValue(undefined);
  mockFindFirst.mockResolvedValue(undefined);
  mockGetMessengerDingTalkConfig.mockResolvedValue(VALID_CONFIG);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
  mockRedisEval.mockResolvedValue(1);
  mockCreateUser.mockImplementation(async (user: { email: string; name: string }) => {
    const created = { email: user.email, id: 'user_new', name: user.name };
    mockFindByEmail.mockResolvedValue({ ...created, avatar: undefined });
    return created;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
        return jsonResponse({ access_token: 'legacy-token', errcode: 0 });
      }
      if (url.startsWith(DINGTALK_USER_GET_URL)) {
        return jsonResponse({
          errcode: 0,
          result: {
            avatar: 'https://static.dingtalk.com/avatar.png',
            name: '张三',
            title: '工程师',
          },
        });
      }
      return jsonResponse({ errcode: 1 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DINGTALK_IDENTITY_EMAIL_DOMAIN;
});

describe('ensureDingTalkUser', () => {
  it('returns an existing user without creating or calling DingTalk', async () => {
    mockFindByEmail.mockResolvedValue(EXISTING_USER);

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toEqual(
      EXISTING_USER,
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('matches the identity email case-insensitively', async () => {
    mockFindByEmail.mockResolvedValueOnce(undefined);
    mockFindFirst.mockResolvedValueOnce({
      email: 'STAFF_1@DingTalk.Jiefakj.COM',
      id: 'user_1',
    });

    const user = await ensureDingTalkUser(serverDB, { staffId: 'staff_1' });
    expect(user?.id).toBe('user_1');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('fetches the DingTalk contact and creates a user with synthetic email/name/avatar', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const user = await ensureDingTalkUser(serverDB, {
      senderNick: 'fallback-nick',
      staffId: 'staff_1',
    });

    expect(user?.id).toBe('user_new');
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'staff_1@dingtalk.jiefakj.com',
      emailVerified: false,
      image: 'https://static.dingtalk.com/avatar.png',
      name: '张三',
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining(`${DINGTALK_USER_GET_URL}?`),
      expect.objectContaining({
        body: JSON.stringify({ language: 'zh_CN', userid: 'staff_1' }),
        method: 'POST',
        redirect: 'error',
      }),
    );
    expect(info).toHaveBeenCalledWith(
      '[dingtalk-provision] created user %s staffId=%s',
      'user_new',
      'staff_1',
    );
    info.mockRestore();
  });

  it('falls back to senderNick then staffId when the contact name is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
          return jsonResponse({ access_token: 'legacy-token', errcode: 0 });
        }
        return jsonResponse({ errcode: 0, result: { name: '  ' } });
      }),
    );

    await ensureDingTalkUser(serverDB, { senderNick: 'Alice', staffId: 'staff_1' });
    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice' }));

    resetDingTalkProvisionStateForTest();
    mockFindByEmail.mockResolvedValue(undefined);
    mockCreateUser.mockClear();
    await ensureDingTalkUser(serverDB, { staffId: 'staff_1' });
    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ name: 'staff_1' }));
  });

  it('omits image when the DingTalk avatar is not https', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
          return jsonResponse({ access_token: 'legacy-token', errcode: 0 });
        }
        return jsonResponse({
          errcode: 0,
          result: { avatar: 'http://insecure.example/a.png', name: '张三' },
        });
      }),
    );

    await ensureDingTalkUser(serverDB, { staffId: 'staff_1' });
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'staff_1@dingtalk.jiefakj.com',
      emailVerified: false,
      name: '张三',
    });
  });

  it('returns null when the DingTalk contact API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
          return jsonResponse({ access_token: 'legacy-token', errcode: 0 });
        }
        return jsonResponse({ errcode: 40003, errmsg: 'user not exist' });
      }),
    );

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('creates only once under lock contention', async () => {
    const held = new Set<string>();
    mockRedisSet.mockImplementation(async (key: string) => {
      if (held.has(key)) return null;
      held.add(key);
      return 'OK';
    });
    mockRedisDel.mockImplementation(async (key: string) => {
      held.delete(key);
      return 1;
    });

    let created: { email: string; id: string } | undefined;
    mockFindByEmail.mockImplementation(async () => created);
    mockCreateUser.mockImplementation(async (user: { email: string }) => {
      created = { email: user.email, id: 'user_once' };
      return created;
    });

    const [first, second] = await Promise.all([
      ensureDingTalkUser(serverDB, { staffId: 'staff_1' }),
      ensureDingTalkUser(serverDB, { staffId: 'staff_1' }),
    ]);

    expect(first?.id).toBe('user_once');
    expect(second?.id).toBe('user_once');
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
  });

  it('returns null when the global provision rate is exceeded', async () => {
    mockRedisEval.mockResolvedValue(DINGTALK_PROVISION_RATE_LIMIT_MAX + 1);

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockRedisEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      DINGTALK_PROVISION_RATE_KEY,
      expect.any(String),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null for an empty staffId without touching Redis or DingTalk', async () => {
    await expect(ensureDingTalkUser(serverDB, { staffId: '   ' })).resolves.toBeNull();
    expect(mockFindByEmail).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
