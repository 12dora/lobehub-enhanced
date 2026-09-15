// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DINGTALK_INSTALLATION_KEY, DingTalkInstallationStore } from './dingtalk';

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');

const VALID_CONFIG = {
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'secret',
  pushEnabled: true,
  robotCode: 'robot_1',
};

beforeEach(() => {
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(VALID_CONFIG as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DingTalkInstallationStore.resolveByPayload', () => {
  it('returns the singleton credential bundle', async () => {
    const store = new DingTalkInstallationStore();
    const creds = await store.resolveByPayload();
    expect(creds).toMatchObject({
      applicationId: 'app_key',
      installationKey: DINGTALK_INSTALLATION_KEY,
      platform: 'dingtalk',
      tenantId: '',
    });
  });

  it('returns null when dingtalk is not configured', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce(null);
    expect(await new DingTalkInstallationStore().resolveByPayload()).toBeNull();
  });
});

describe('DingTalkInstallationStore.resolveByKey', () => {
  it('returns credentials for the singleton key', async () => {
    const creds = await new DingTalkInstallationStore().resolveByKey(DINGTALK_INSTALLATION_KEY);
    expect(creds?.botToken).toBe('secret');
  });

  it('returns null for any other installation key', async () => {
    expect(await new DingTalkInstallationStore().resolveByKey('dingtalk:other')).toBeNull();
    expect(getMessengerDingTalkConfig).not.toHaveBeenCalled();
  });
});
