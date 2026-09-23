import { describe, expect, it, vi } from 'vitest';

import { DINGTALK_GROUP_HISTORY_UNAVAILABLE } from './dingtalkHistory';
import { MessageDispatcherService } from './MessageDispatcherService';

describe('MessageDispatcherService DingTalk history', () => {
  it('returns the stable Chinese error for read and search without calling a platform factory', async () => {
    const factory = vi.fn(async () => {
      throw new Error('No enabled feishu bot provider found');
    });
    const dispatcher = new MessageDispatcherService({ dingtalk: factory, feishu: factory });

    await expect(
      dispatcher.readMessages({ channelId: 'cid', platform: 'dingtalk' }),
    ).rejects.toThrow(DINGTALK_GROUP_HISTORY_UNAVAILABLE);
    await expect(
      dispatcher.searchMessages({ channelId: 'cid', platform: 'dingtalk', query: '库存' }),
    ).rejects.toThrow(DINGTALK_GROUP_HISTORY_UNAVAILABLE);
    expect(factory).not.toHaveBeenCalled();
  });
});
