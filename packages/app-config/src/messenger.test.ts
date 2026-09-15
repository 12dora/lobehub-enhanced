// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const findEnabledByPlatform = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/models/systemBotProvider', () => ({
  SystemBotProviderModel: {
    findEnabledByPlatform: (...args: unknown[]) => findEnabledByPlatform(...args),
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({}),
  },
}));

const { getEnabledMessengerPlatforms, getMessengerDingTalkConfig, invalidateMessengerConfigCache } =
  await import('./messenger');

const COMPLETE_ROW = {
  applicationId: 'app_key',
  credentials: { clientSecret: 'app_secret' },
  enabled: true,
  settings: {
    chatEnabled: true,
    idleNewTopicEnabled: true,
    idleNewTopicHours: 24,
    pushEnabled: true,
    robotCode: 'robot_1',
  },
};

afterEach(() => {
  invalidateMessengerConfigCache();
  vi.clearAllMocks();
});

describe('getMessengerDingTalkConfig', () => {
  it('returns null when the row is missing', async () => {
    findEnabledByPlatform.mockResolvedValueOnce(null);
    expect(await getMessengerDingTalkConfig()).toBeNull();
  });

  it('returns null when clientId is missing', async () => {
    findEnabledByPlatform.mockResolvedValueOnce({
      ...COMPLETE_ROW,
      applicationId: '',
    });
    expect(await getMessengerDingTalkConfig()).toBeNull();
  });

  it('returns null when clientSecret is missing', async () => {
    findEnabledByPlatform.mockResolvedValueOnce({
      ...COMPLETE_ROW,
      credentials: {},
    });
    expect(await getMessengerDingTalkConfig()).toBeNull();
  });

  it('returns null when robotCode is missing', async () => {
    findEnabledByPlatform.mockResolvedValueOnce({
      ...COMPLETE_ROW,
      settings: { chatEnabled: true },
    });
    expect(await getMessengerDingTalkConfig()).toBeNull();
  });

  it('returns the decoded config when the row is complete', async () => {
    findEnabledByPlatform.mockResolvedValueOnce(COMPLETE_ROW);
    await expect(getMessengerDingTalkConfig()).resolves.toEqual({
      agentId: null,
      aiCardTemplateId: null,
      chatEnabled: true,
      clientId: 'app_key',
      clientSecret: 'app_secret',
      corpId: null,
      idleNewTopicEnabled: true,
      idleNewTopicHours: 24,
      pushEnabled: true,
      robotCode: 'robot_1',
      selectCardTemplateId: null,
    });
  });

  it('parses optional corpId from settings', async () => {
    findEnabledByPlatform.mockResolvedValueOnce({
      ...COMPLETE_ROW,
      settings: { ...COMPLETE_ROW.settings, corpId: 'ding42' },
    });
    await expect(getMessengerDingTalkConfig()).resolves.toMatchObject({
      clientId: 'app_key',
      corpId: 'ding42',
      robotCode: 'robot_1',
    });
  });

  it('parses optional agentId from settings', async () => {
    findEnabledByPlatform.mockResolvedValueOnce({
      ...COMPLETE_ROW,
      settings: { ...COMPLETE_ROW.settings, agentId: '4617854000' },
    });
    await expect(getMessengerDingTalkConfig()).resolves.toMatchObject({
      agentId: '4617854000',
      clientId: 'app_key',
      robotCode: 'robot_1',
    });
  });

  it('includes dingtalk in the enabled list iff config is non-null', async () => {
    findEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
      platform === 'dingtalk' ? COMPLETE_ROW : null,
    );
    await expect(getEnabledMessengerPlatforms()).resolves.toEqual(['dingtalk']);
  });

  it('invalidateMessengerConfigCache("dingtalk") drops the cached value', async () => {
    findEnabledByPlatform.mockResolvedValueOnce(COMPLETE_ROW);
    expect(await getMessengerDingTalkConfig()).not.toBeNull();
    findEnabledByPlatform.mockResolvedValueOnce(null);
    // still cached
    expect(await getMessengerDingTalkConfig()).not.toBeNull();
    invalidateMessengerConfigCache('dingtalk');
    findEnabledByPlatform.mockResolvedValueOnce(null);
    expect(await getMessengerDingTalkConfig()).toBeNull();
  });
});
