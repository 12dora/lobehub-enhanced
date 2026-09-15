import { describe, expect, it } from 'vitest';

import {
  formatIdlePolicyZh,
  formatRelativeTimeZh,
  formatStatusText,
  formatTopicListText,
  parseDingTalkCommand,
} from './commands';

describe('parseDingTalkCommand', () => {
  it('maps Chinese aliases and English names', () => {
    expect(parseDingTalkCommand('/会话')).toEqual({ args: '', name: 'topics' });
    expect(parseDingTalkCommand('/topics')).toEqual({ args: '', name: 'topics' });
    expect(parseDingTalkCommand('/继续 2')).toEqual({ args: '2', name: 'resume' });
    expect(parseDingTalkCommand('/resume 2')).toEqual({ args: '2', name: 'resume' });
    expect(parseDingTalkCommand('/助手')).toEqual({ args: '', name: 'agents' });
    expect(parseDingTalkCommand('/切换 3')).toEqual({ args: '3', name: 'agents' });
    expect(parseDingTalkCommand('/use 3')).toEqual({ args: '3', name: 'agents' });
    expect(parseDingTalkCommand('/新会话')).toEqual({ args: '', name: 'new' });
    expect(parseDingTalkCommand('/当前')).toEqual({ args: '', name: 'status' });
    expect(parseDingTalkCommand('/停止')).toEqual({ args: '', name: 'stop' });
    expect(parseDingTalkCommand('/帮助')).toEqual({ args: '', name: 'help' });
    expect(parseDingTalkCommand('/help')).toEqual({ args: '', name: 'help' });
  });

  it('returns the raw name for unknown slash commands', () => {
    expect(parseDingTalkCommand('/未知')).toEqual({ args: '', name: '未知' });
    expect(parseDingTalkCommand('/foo bar')).toEqual({ args: 'bar', name: 'foo' });
  });

  it('returns null when the text is not a slash command', () => {
    expect(parseDingTalkCommand('hello')).toBeNull();
    expect(parseDingTalkCommand('')).toBeNull();
    expect(parseDingTalkCommand(undefined)).toBeNull();
  });
});

describe('formatTopicListText', () => {
  it('renders numbered titles with relative time', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const { text } = formatTopicListText(
      [
        { id: 't1', title: '周报', updatedAt: new Date('2026-09-15T11:50:00Z') },
        { id: 't2', title: '', updatedAt: new Date('2026-09-15T10:00:00Z') },
      ],
      now,
    );
    expect(text).toContain('1. 周报 · 10 分钟前');
    expect(text).toContain('2. 未命名会话 · 2 小时前');
  });
});

describe('formatStatusText', () => {
  it('includes agent, topic, and idle policy', () => {
    expect(
      formatStatusText({
        agentName: 'Inbox',
        idleNewTopicEnabled: true,
        idleNewTopicHours: 24,
        topicTitle: '钉钉 · 周报',
      }),
    ).toBe('当前助手：Inbox\n当前会话：钉钉 · 周报\n空闲策略：24 小时后自动新会话');
    expect(formatIdlePolicyZh({ idleNewTopicEnabled: false })).toBe('空闲策略：已关闭');
  });
});

describe('formatRelativeTimeZh', () => {
  it('uses 刚刚 for sub-minute deltas', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    expect(formatRelativeTimeZh(new Date('2026-09-15T11:59:30Z'), now)).toBe('刚刚');
  });
});
