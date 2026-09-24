// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByEmail = vi.fn();
const mockFindFirst = vi.fn();
const mockCreateUser = vi.fn();
const mockGetMessengerDingTalkConfig = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisEval = vi.fn();
const mockGetAgentRuntimeRedisClient = vi.fn();

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
  getAgentRuntimeRedisClient: (...args: unknown[]) => mockGetAgentRuntimeRedisClient(...args),
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
  DINGTALK_PROVISION_LOCK_TTL_SECONDS,
  DINGTALK_PROVISION_RATE_KEY,
  DINGTALK_PROVISION_RATE_LIMIT_MAX,
  DINGTALK_USER_GET_URL,
  ensureDingTalkUser,
  RELEASE_DINGTALK_PROVISION_LOCK_SCRIPT,
  resetDingTalkProvisionStateForTest,
} = await import('./provision');

const redisClient = () => ({
  eval: mockRedisEval,
  set: mockRedisSet,
});

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
  mockGetAgentRuntimeRedisClient.mockImplementation(redisClient);
  mockFindByEmail.mockResolvedValue(undefined);
  mockFindFirst.mockResolvedValue(undefined);
  mockGetMessengerDingTalkConfig.mockResolvedValue(VALID_CONFIG);
  mockRedisSet.mockResolvedValue('OK');
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
            userid: 'staff_1',
          },
        });
      }
      return jsonResponse({ errcode: 1 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
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
      emailVerified: true,
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
        return jsonResponse({ errcode: 0, result: { name: '  ', userid: 'staff_1' } });
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
          result: { avatar: 'http://insecure.example/a.png', name: '张三', userid: 'staff_1' },
        });
      }),
    );

    await ensureDingTalkUser(serverDB, { staffId: 'staff_1' });
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'staff_1@dingtalk.jiefakj.com',
      emailVerified: true,
      name: '张三',
    });
  });

  it('drops the shared gettoken when the contact API returns 40014', async () => {
    let tokenCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
          tokenCalls += 1;
          return jsonResponse({
            access_token: `legacy-${tokenCalls}`,
            errcode: 0,
            expires_in: 7200,
          });
        }
        if (tokenCalls === 1) {
          return jsonResponse({ errcode: 40014, errmsg: '不合法的access_token' });
        }
        return jsonResponse({
          errcode: 0,
          result: { name: '张三', userid: 'staff_1' },
        });
      }),
    );

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(tokenCalls).toBe(1);

    const user = await ensureDingTalkUser(serverDB, { staffId: 'staff_1' });
    expect(user?.id).toBe('user_new');
    expect(tokenCalls).toBe(2);
  });

  it('returns null when the DingTalk contact API fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[dingtalk-provision] contact fetch failed staffId=staff_1'),
    );
    warn.mockRestore();
  });

  it('returns null when the contact userid does not match the requested staffId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(DINGTALK_LEGACY_TOKEN_URL)) {
          return jsonResponse({ access_token: 'legacy-token', errcode: 0 });
        }
        return jsonResponse({
          errcode: 0,
          result: { name: '张三', userid: 'someone_else' },
        });
      }),
    );

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('creates only once under lock contention', async () => {
    const held = new Map<string, string>();
    mockRedisSet.mockImplementation(async (key: string, value: string) => {
      if (held.has(key)) return null;
      held.set(key, value);
      return 'OK';
    });
    mockRedisEval.mockImplementation(
      async (script: string, _n: number, key: string, arg: string) => {
        if (script === RELEASE_DINGTALK_PROVISION_LOCK_SCRIPT) {
          if (held.get(key) === arg) {
            held.delete(key);
            return 1;
          }
          return 0;
        }
        return 1;
      },
    );

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

  it('releases the lock with a token compare-and-delete', async () => {
    await ensureDingTalkUser(serverDB, { staffId: 'staff_1' });

    expect(mockRedisSet).toHaveBeenCalledWith(
      'messenger:dingtalk:provision:staff_1',
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      'EX',
      DINGTALK_PROVISION_LOCK_TTL_SECONDS,
      'NX',
    );
    const token = mockRedisSet.mock.calls[0]![1] as string;
    expect(mockRedisEval).toHaveBeenCalledWith(
      RELEASE_DINGTALK_PROVISION_LOCK_SCRIPT,
      1,
      'messenger:dingtalk:provision:staff_1',
      token,
    );
    expect(RELEASE_DINGTALK_PROVISION_LOCK_SCRIPT).toContain("redis.call('get'");
    expect(RELEASE_DINGTALK_PROVISION_LOCK_SCRIPT).toContain("redis.call('del'");
  });

  it('returns null when the global provision rate is exceeded', async () => {
    mockRedisEval.mockImplementation(async (script: string) => {
      if (script === RELEASE_DINGTALK_PROVISION_LOCK_SCRIPT) return 1;
      return DINGTALK_PROVISION_RATE_LIMIT_MAX + 1;
    });

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

  it('returns null for a staffId outside the DingTalk userid charset', async () => {
    await expect(ensureDingTalkUser(serverDB, { staffId: 'a@b' })).resolves.toBeNull();
    await expect(ensureDingTalkUser(serverDB, { staffId: 'has space' })).resolves.toBeNull();
    await expect(ensureDingTalkUser(serverDB, { staffId: 'x'.repeat(65) })).resolves.toBeNull();
    expect(mockFindByEmail).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('still returns an existing user when Redis is down', async () => {
    mockFindByEmail.mockResolvedValue(EXISTING_USER);
    mockGetAgentRuntimeRedisClient.mockReturnValue(null);
    mockRedisSet.mockRejectedValue(new Error('redis down'));

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toEqual(
      EXISTING_USER,
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('fails closed on Redis lock errors instead of creating', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRedisSet.mockRejectedValue(new Error('redis down'));

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[dingtalk-provision] redis lock failed staffId=staff_1'),
    );
    warn.mockRestore();
  });

  it('fails closed when Redis is unavailable for create', async () => {
    mockGetAgentRuntimeRedisClient.mockReturnValue(null);

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the rate-limit Redis eval throws', async () => {
    mockRedisEval.mockImplementation(async (script: string) => {
      if (script === RELEASE_DINGTALK_PROVISION_LOCK_SCRIPT) return 1;
      throw new Error('eval failed');
    });

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null when the post-create re-read misses instead of stubbing a UserItem', async () => {
    mockCreateUser.mockImplementation(async (user: { email: string }) => ({
      email: user.email,
      id: 'user_new',
    }));
    mockFindByEmail.mockResolvedValue(undefined);
    mockFindFirst.mockResolvedValue(undefined);

    await expect(ensureDingTalkUser(serverDB, { staffId: 'staff_1' })).resolves.toBeNull();
    expect(mockCreateUser).toHaveBeenCalled();
  });

  it('waiters wait up to the lock TTL then fail closed', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRedisSet.mockResolvedValue(null);

    const pending = ensureDingTalkUser(serverDB, { staffId: 'staff_1' });
    await vi.advanceTimersByTimeAsync(DINGTALK_PROVISION_LOCK_TTL_SECONDS * 1000);

    await expect(pending).resolves.toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[dingtalk-provision] lock timeout staffId=staff_1'),
    );
    warn.mockRestore();
  });
});
