import { describe, expect, it } from 'vitest';

import { DINGTALK_CHANNEL_SYSTEM_PROMPT } from './dingtalkChannelPrompt';

describe('DINGTALK_CHANNEL_SYSTEM_PROMPT', () => {
  it('tells the model how DingTalk renders, where the topic lives, and what history it cannot read', () => {
    expect(DINGTALK_CHANNEL_SYSTEM_PROMPT).toContain('不能渲染 Markdown 表格');
    expect(DINGTALK_CHANNEL_SYSTEM_PROMPT).toContain('HTML');
    expect(DINGTALK_CHANNEL_SYSTEM_PROMPT).toContain('加粗');
    expect(DINGTALK_CHANNEL_SYSTEM_PROMPT).toContain('钉钉 · ');
    expect(DINGTALK_CHANNEL_SYSTEM_PROMPT).toContain('AIHub');
    expect(DINGTALK_CHANNEL_SYSTEM_PROMPT).toContain('其他群');
    expect(DINGTALK_CHANNEL_SYSTEM_PROMPT).toContain('不要承诺');
  });
});
