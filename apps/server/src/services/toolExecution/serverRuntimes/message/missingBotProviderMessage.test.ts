import { describe, expect, it } from 'vitest';

import { missingBotProviderMessage } from './index';

describe('missingBotProviderMessage', () => {
  it('stays without a page link when the agent is unknown', () => {
    const text = missingBotProviderMessage('discord');
    expect(text).toContain('No enabled discord bot provider found');
    expect(text).not.toContain('/agent/');
  });

  it('links the agent channel page, and wraps DingTalk through sign-in', () => {
    const web = missingBotProviderMessage('slack', 'agt_1');
    expect(web).toContain('[机器人渠道](');
    expect(web).toContain('/agent/agt_1/channel');
    expect(web).not.toContain('/dingtalk/sso');

    const dingtalk = missingBotProviderMessage('slack', 'agt_1', 'dingtalk');
    expect(dingtalk).toContain('/dingtalk/sso?redirect=');
    expect(dingtalk).toContain(encodeURIComponent('/agent/agt_1/channel'));
  });
});
