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

  it('tells a markdown platform to link AIHub pages with the absolute origin', () => {
    const text = formatBotPlatformContext({
      appUrl: 'https://chat.example.com/',
      platformName: 'Slack',
      supportsMarkdown: true,
    });

    expect(text).toContain('The AIHub web app is at https://chat.example.com.');
    expect(text).toContain(
      'full clickable markdown link that starts with https://chat.example.com',
    );
    expect(text).toContain('Do not write only a menu path.');
    expect(text).not.toContain('/dingtalk/sso');
  });

  it('tells DingTalk to wrap settings links through the sign-in bridge', () => {
    const text = formatBotPlatformContext({
      appUrl: 'https://chat.example.com',
      platformName: 'DingTalk',
      supportsMarkdown: true,
    });

    expect(text).toContain('https://chat.example.com/dingtalk/sso?redirect=<urlencoded app path>');
    expect(text).not.toContain('readMessages');
  });

  it('does not ask a plain-text platform to emit markdown links', () => {
    const text = formatBotPlatformContext({
      appUrl: 'https://chat.example.com',
      platformName: 'QQ',
      supportsMarkdown: false,
    });

    expect(text).not.toContain('<app_links>');
    expect(text).toContain('This platform does NOT support Markdown rendering.');
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
