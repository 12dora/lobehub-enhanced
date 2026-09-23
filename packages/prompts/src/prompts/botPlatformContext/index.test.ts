import { describe, expect, it } from 'vitest';

import { formatBotPlatformContext } from './index';

const READ_MESSAGES_LINE =
  '- When the user\'s message references prior context you don\'t have (e.g. "what do you think?", "summarize this", "look at that"), use `readMessages` IMMEDIATELY to fetch recent chat history before responding. Never ask the user to repeat what was already said in the channel.';

describe('formatBotPlatformContext', () => {
  it('keeps the readMessages line for platforms whose history is readable', () => {
    const slack = formatBotPlatformContext({ platformName: 'Slack', supportsMarkdown: true });

    expect(slack).toContain(READ_MESSAGES_LINE);
    expect(slack).toContain('platform="Slack"');
    expect(slack).toContain('<message_delivery>');
  });

  it('omits the readMessages line for DingTalk and leaves the rest of the prompt', () => {
    const slack = formatBotPlatformContext({ platformName: 'Slack', supportsMarkdown: true });
    const dingtalk = formatBotPlatformContext({
      platformName: 'DingTalk',
      supportsMarkdown: true,
    });
    const lower = formatBotPlatformContext({ platformName: 'dingtalk', supportsMarkdown: true });

    expect(dingtalk).not.toContain('readMessages');
    expect(lower).not.toContain('readMessages');
    expect(dingtalk).toContain('silently read more history');
    expect(dingtalk).toBe(
      slack
        .replace('platform="Slack"', 'platform="DingTalk"')
        .replace('**Slack**', '**DingTalk**')
        .replace(`${READ_MESSAGES_LINE}\n`, ''),
    );
    expect(lower).toBe(
      slack
        .replace('platform="Slack"', 'platform="dingtalk"')
        .replace('**Slack**', '**dingtalk**')
        .replace(`${READ_MESSAGES_LINE}\n`, ''),
    );
  });

  it('still tells a plain-text DingTalk caller not to use Markdown', () => {
    const text = formatBotPlatformContext({
      platformName: 'DingTalk',
      supportsMarkdown: false,
    });

    expect(text).not.toContain('readMessages');
    expect(text).toContain('This platform does NOT support Markdown rendering.');
  });
});
