// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMessengerDingTalkConfig = vi.fn();
const mockRedisGet = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: (...args: unknown[]) => mockGetMessengerDingTalkConfig(...args),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({
    eval: vi.fn(),
    get: mockRedisGet,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findByEmail: vi.fn() },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/schemas', () => ({
  users: { email: 'users.email' },
}));

vi.mock('@/auth', () => ({
  auth: { $context: Promise.resolve({}) },
}));

const { GET } = await import('./route');
const { DINGTALK_CORP_ID_KEY, resetDingTalkSsoStateForTest } =
  await import('@/server/services/messenger/platforms/dingtalk/sso');

const VALID_CONFIG = {
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'app_secret',
  corpId: 'ding42',
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  pushEnabled: true,
  robotCode: 'robot_1',
  selectCardTemplateId: null,
};

beforeEach(() => {
  resetDingTalkSsoStateForTest();
  vi.clearAllMocks();
  mockGetMessengerDingTalkConfig.mockResolvedValue(VALID_CONFIG);
  mockRedisGet.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/auth/dingtalk/sso/config', () => {
  it('returns 404-style JSON when the connector is disabled', async () => {
    mockGetMessengerDingTalkConfig.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'disabled' });
  });

  it('returns corpId from connector settings', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ corpId: 'ding42', enabled: true });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('reads corpId from Redis when settings omit it', async () => {
    mockGetMessengerDingTalkConfig.mockResolvedValueOnce({ ...VALID_CONFIG, corpId: null });
    mockRedisGet.mockResolvedValueOnce('ding-from-redis');

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ corpId: 'ding-from-redis', enabled: true });
    expect(mockRedisGet).toHaveBeenCalledWith(DINGTALK_CORP_ID_KEY);
  });
});
