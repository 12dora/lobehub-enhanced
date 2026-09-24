import { describe, expect, it } from 'vitest';

import {
  type BotProviderQuery,
  DINGTALK_CHANNEL_EMPTY_MESSAGE,
  DINGTALK_GROUP_HISTORY_UNAVAILABLE,
  MessageExecutionRuntime,
  type MessageRuntimeService,
} from './index';

const runtime = (dingtalkChannel: boolean) =>
  new MessageExecutionRuntime({
    botProvider: {
      listBots: async () => [],
      listMessengers: async () => [],
    } as unknown as BotProviderQuery,
    dingtalkChannel,
    service: {} as MessageRuntimeService,
  });

describe('MessageExecutionRuntime empty discovery', () => {
  it('points an empty bot list at lobe-reminder on a DingTalk deployment', async () => {
    const result = await runtime(true).listBots({});

    expect(result.success).toBe(true);
    expect(result.content).toBe(DINGTALK_CHANNEL_EMPTY_MESSAGE);
    expect(result.content).not.toContain('Settings');
  });

  it('keeps the generic bot empty state when DingTalk is not the channel', async () => {
    const result = await runtime(false).listBots({});

    expect(result.content).toContain('No bots configured');
    expect(result.content).not.toContain(DINGTALK_CHANNEL_EMPTY_MESSAGE);
  });

  it('does not send an empty messenger list to Settings → Messenger on DingTalk', async () => {
    const result = await runtime(true).listMessengers({});

    expect(result.success).toBe(true);
    expect(result.content).toBe(DINGTALK_CHANNEL_EMPTY_MESSAGE);
    expect(result.content).not.toContain('Messenger');
  });

  it('keeps the Messenger install hint when DingTalk is not the channel', async () => {
    const result = await runtime(false).listMessengers({});

    expect(result.content).toContain('Settings → Messenger');
    expect(result.content).toContain('[Messenger 设置](/settings/messenger)');
  });
});

describe('MessageExecutionRuntime DingTalk history', () => {
  const historyRuntime = (
    service: Pick<MessageRuntimeService, 'readMessages' | 'searchMessages'>,
  ) =>
    new MessageExecutionRuntime({
      service: service as MessageRuntimeService,
    });

  it('returns the stable DingTalk sentence for readMessages without an error prefix', async () => {
    const result = await historyRuntime({
      readMessages: async () => {
        throw new Error(DINGTALK_GROUP_HISTORY_UNAVAILABLE);
      },
      searchMessages: async () => {
        throw new Error('unused');
      },
    }).readMessages({ channelId: 'cid', platform: 'dingtalk' });

    expect(result.success).toBe(false);
    expect(result.content).toBe(DINGTALK_GROUP_HISTORY_UNAVAILABLE);
    expect(result.content).not.toContain('readMessages error:');
  });

  it('returns the stable DingTalk sentence for searchMessages without an error prefix', async () => {
    const result = await historyRuntime({
      readMessages: async () => {
        throw new Error('unused');
      },
      searchMessages: async () => {
        throw new Error(`searchMessages error: ${DINGTALK_GROUP_HISTORY_UNAVAILABLE}`);
      },
    }).searchMessages({ channelId: 'cid', platform: 'dingtalk', query: '周报' });

    expect(result.success).toBe(false);
    expect(result.content).toBe(DINGTALK_GROUP_HISTORY_UNAVAILABLE);
    expect(result.content).not.toContain('searchMessages error:');
  });

  it('keeps the error prefix for other readMessages failures', async () => {
    const result = await historyRuntime({
      readMessages: async () => {
        throw new Error('missing feishu credentials');
      },
      searchMessages: async () => {
        throw new Error('unused');
      },
    }).readMessages({ channelId: 'cid', platform: 'feishu' });

    expect(result.content).toBe('readMessages error: missing feishu credentials');
  });
});
