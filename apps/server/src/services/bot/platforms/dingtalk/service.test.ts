import type { DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import { describe, expect, it, vi } from 'vitest';

import { DINGTALK_GROUP_HISTORY_UNAVAILABLE } from '@/server/services/toolExecution/serverRuntimes/message/dingtalkHistory';

import { DingTalkMessageService } from './service';

describe('DingTalkMessageService history', () => {
  const service = new DingTalkMessageService({} as DingTalkApiClient, 'robot');

  it('refuses readMessages with the stable Chinese capability error', async () => {
    await expect(service.readMessages({ channelId: 'cid', platform: 'dingtalk' })).rejects.toThrow(
      DINGTALK_GROUP_HISTORY_UNAVAILABLE,
    );
  });

  it('refuses searchMessages with the same error, not a credential error', async () => {
    await expect(
      service.searchMessages({ channelId: 'cid', platform: 'dingtalk', query: '库存' }),
    ).rejects.toThrow(DINGTALK_GROUP_HISTORY_UNAVAILABLE);
    await expect(
      service.searchMessages({ channelId: 'cid', platform: 'dingtalk', query: '库存' }),
    ).rejects.not.toThrow(/feishu/i);
  });
});

describe('DingTalkMessageService markdown', () => {
  const table = ['| 项目 | 内容 |', '| --- | --- |', '| 经营范围 | 助剂销售 |'].join('\n');

  it('converts GFM tables in sampleMarkdown and does not rewrite converted text', async () => {
    const sendGroupMessage = vi.fn().mockResolvedValue({});
    const api = { sendGroupMessage } as unknown as DingTalkApiClient;
    const markdown = new DingTalkMessageService(api, 'robot');

    await markdown.sendMessage({ channelId: 'cid', content: table, platform: 'dingtalk' });

    const first = JSON.parse(sendGroupMessage.mock.calls[0][0].msgParam) as {
      text: string;
      title: string;
    };
    expect(first.text).toBe('**经营范围**：助剂销售');
    expect(first.text).not.toContain('| --- |');
    expect(first.title).toBe('**经营范围**：助剂销售');

    await markdown.sendMessage({
      channelId: 'cid',
      content: first.text,
      platform: 'dingtalk',
    });
    const second = JSON.parse(sendGroupMessage.mock.calls[1][0].msgParam) as { text: string };
    expect(second.text).toBe(first.text);
  });
});
