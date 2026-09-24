import { describe, expect, it } from 'vitest';

import {
  formatDingTalkImHeadlessBlockedContent,
  isDingTalkMessengerMetadata,
} from './dingtalkHeadlessApproval';

describe('dingtalkHeadlessApproval', () => {
  it('recognises a messenger DingTalk run and ignores other headless callers', () => {
    expect(
      isDingTalkMessengerMetadata({
        botContext: { messengerInstallationKey: 'dingtalk:singleton', platform: 'dingtalk' },
      }),
    ).toBe(true);
    expect(isDingTalkMessengerMetadata({ botContext: { platform: 'dingtalk' } })).toBe(false);
    expect(
      isDingTalkMessengerMetadata({
        botContext: { messengerInstallationKey: 'slack:T1', platform: 'slack' },
      }),
    ).toBe(false);
  });

  it('explains a headless block in Chinese and includes the topic link', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://chat.example.com/';
    try {
      const text = formatDingTalkImHeadlessBlockedContent({
        agentId: 'agt_1',
        topicId: 'topic_1',
      });
      expect(text).toContain('该操作需要本人确认');
      expect(text).toContain(
        '[在网页端确认](https://chat.example.com/dingtalk/sso?redirect=' +
          encodeURIComponent('/agent/agt_1/topic_1') +
          ')',
      );
      expect(text).not.toContain('https://chat.example.com/agent/agt_1/topic_1');
      expect(text).not.toContain('Blocked by security/privacy');
    } finally {
      process.env.APP_URL = previous;
    }
  });
});
