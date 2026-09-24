// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type * as TokenCacheModule from '@/server/services/messenger/platforms/dingtalk/tokenCache';

const sharedDingTalkApiClient = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/messenger/platforms/dingtalk/tokenCache', async (importOriginal) => {
  const actual = await importOriginal<typeof TokenCacheModule>();
  return {
    ...actual,
    sharedDingTalkApiClient: (params: Parameters<typeof actual.sharedDingTalkApiClient>[0]) => {
      const overridden = sharedDingTalkApiClient(params);
      return overridden === undefined ? actual.sharedDingTalkApiClient(params) : overridden;
    },
  };
});

const { createServiceForCredentials, mergeBotProviderCredentials } = await import('../botMessage');

describe('mergeBotProviderCredentials', () => {
  it('sets robotCode for dingtalk from settings when it is a non-empty string', () => {
    expect(
      mergeBotProviderCredentials('dingtalk', { clientSecret: 'sec' }, { robotCode: 'robot_1' }),
    ).toEqual({ clientSecret: 'sec', robotCode: 'robot_1' });
  });

  it('keeps credentials.robotCode when settings omit it', () => {
    expect(
      mergeBotProviderCredentials('dingtalk', { clientSecret: 'sec', robotCode: 'from_creds' }, {}),
    ).toEqual({ clientSecret: 'sec', robotCode: 'from_creds' });
  });

  it('does not overwrite credentials.robotCode with an empty settings value', () => {
    expect(
      mergeBotProviderCredentials(
        'dingtalk',
        { clientSecret: 'sec', robotCode: 'from_creds' },
        { robotCode: '' },
      ),
    ).toEqual({ clientSecret: 'sec', robotCode: 'from_creds' });
  });

  it('does not set robotCode when both settings and credentials omit a non-empty value', () => {
    expect(mergeBotProviderCredentials('dingtalk', { clientSecret: 'sec' }, {})).toEqual({
      clientSecret: 'sec',
    });
  });

  it('does not copy settings.robotCode onto other platforms', () => {
    expect(
      mergeBotProviderCredentials('slack', { botToken: 'xoxb' }, { robotCode: 'robot_1' }),
    ).toEqual({ botToken: 'xoxb' });
  });
});

describe('createServiceForCredentials dingtalk', () => {
  it('builds the message service from the shared DingTalk API client', () => {
    const api = { sendGroupMessage: vi.fn() };
    sharedDingTalkApiClient.mockReturnValueOnce(api);

    const service = createServiceForCredentials('dingtalk', 'app_key', {
      clientSecret: 'sec',
      robotCode: 'robot_1',
    });

    expect(sharedDingTalkApiClient).toHaveBeenCalledWith({
      appKey: 'app_key',
      appSecret: 'sec',
      robotCode: 'robot_1',
    });
    expect((service as unknown as { api: unknown }).api).toBe(api);
  });
});
