// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envBag = vi.hoisted(() => ({
  DINGTALK_PERSONAL_BROKER_TOKEN: 't'.repeat(32) as string | undefined,
  DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080' as string | undefined,
}));
const findByPlatform = vi.hoisted(() => vi.fn());

vi.mock('@/envs/dingtalkPersonal', () => ({
  dingtalkPersonalEnv: envBag,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => ({}),
}));

vi.mock('@/database/models/systemBotProvider', () => ({
  SystemBotProviderModel: { findByPlatform: (...args: unknown[]) => findByPlatform(...args) },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => undefined },
}));

const { getDingtalkPersonalConfig, resetDingtalkPersonalConfigForTest } = await import('./config');

afterEach(() => {
  vi.useRealTimers();
});

const switches = (patch: Record<string, unknown> = {}) => ({
  settings: {
    personalChatEnabled: true,
    personalDataEnabled: true,
    personalReportEnabled: true,
    personalTodoEnabled: true,
    personalWriteEnabled: true,
    ...patch,
  },
});

describe('dingtalk personal config', () => {
  beforeEach(() => {
    resetDingtalkPersonalConfigForTest();
    findByPlatform.mockReset();
    envBag.DINGTALK_PERSONAL_BROKER_URL = 'http://aihub-dws:8080';
    envBag.DINGTALK_PERSONAL_BROKER_TOKEN = 't'.repeat(32);
    findByPlatform.mockResolvedValue(switches());
  });

  it('turns each feature on only when the master switch, that switch, and the broker are set', async () => {
    const config = await getDingtalkPersonalConfig();
    expect(config).toEqual({
      brokerConfigured: true,
      enabled: true,
      features: { chat: true, report: true, todo: true, write: true },
    });
    await getDingtalkPersonalConfig();
    expect(findByPlatform).toHaveBeenCalledTimes(1);
  });

  it('accepts only boolean true and ignores the sub-switches when the master is off', async () => {
    findByPlatform.mockResolvedValue(
      switches({
        personalChatEnabled: 'true',
        personalDataEnabled: 1,
        personalTodoEnabled: true,
      }),
    );
    const config = await getDingtalkPersonalConfig();
    expect(config.enabled).toBe(false);
    expect(config.features).toEqual({ chat: false, report: false, todo: false, write: false });
  });

  it('stays disabled when the broker env is missing', async () => {
    envBag.DINGTALK_PERSONAL_BROKER_TOKEN = undefined;
    const config = await getDingtalkPersonalConfig();
    expect(config.brokerConfigured).toBe(false);
    expect(config.enabled).toBe(false);
    expect(config.features.todo).toBe(false);
  });

  it('fails closed when the connector row cannot be read', async () => {
    findByPlatform.mockRejectedValue(new Error('db down'));
    const config = await getDingtalkPersonalConfig();
    expect(config.enabled).toBe(false);
    expect(config.brokerConfigured).toBe(true);
    expect(config.features.chat).toBe(false);
  });

  it('refetches after the 30s cache window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    await getDingtalkPersonalConfig();
    vi.setSystemTime(new Date('2026-09-24T00:00:29.000Z'));
    await getDingtalkPersonalConfig();
    expect(findByPlatform).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-24T00:00:31.000Z'));
    await getDingtalkPersonalConfig();
    expect(findByPlatform).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
