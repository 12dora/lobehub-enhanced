import { describe, expect, it } from 'vitest';

import {
  formatIdlePolicyZh,
  formatRelativeTimeZh,
  formatStatusText,
  formatTopicListText,
  parseDingTalkBareNumber,
  parseDingTalkCommand,
} from './commands';
import {
  DINGTALK_COMMAND_SHORTCUT_BUTTONS,
  DINGTALK_HELP_TEXT,
  DINGTALK_UNKNOWN_COMMAND_REPLY,
  DINGTALK_WELCOME_TEXT,
} from './const';

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

  it('accepts plain-word commands without a slash', () => {
    expect(parseDingTalkCommand('帮助')).toEqual({ args: '', name: 'help' });
    expect(parseDingTalkCommand('新会话')).toEqual({ args: '', name: 'new' });
    expect(parseDingTalkCommand('最近会话')).toEqual({ args: '', name: 'topics' });
    expect(parseDingTalkCommand('会话列表')).toEqual({ args: '', name: 'topics' });
    expect(parseDingTalkCommand('切换助手')).toEqual({ args: '', name: 'agents' });
    expect(parseDingTalkCommand('助手列表')).toEqual({ args: '', name: 'agents' });
    expect(parseDingTalkCommand('当前')).toEqual({ args: '', name: 'status' });
    expect(parseDingTalkCommand('当前状态')).toEqual({ args: '', name: 'status' });
    expect(parseDingTalkCommand('停止')).toEqual({ args: '', name: 'stop' });
  });

  it('matches the whole trimmed message and ignores full-width punctuation', () => {
    expect(parseDingTalkCommand('  帮助。')).toEqual({ args: '', name: 'help' });
    expect(parseDingTalkCommand('“新会话”')).toEqual({ args: '', name: 'new' });
    expect(parseDingTalkCommand('切换助手！')).toEqual({ args: '', name: 'agents' });
    expect(parseDingTalkCommand('／帮助')).toEqual({ args: '', name: 'help' });
    expect(parseDingTalkCommand('帮助我')).toBeNull();
    expect(parseDingTalkCommand('助手')).toBeNull();
    expect(parseDingTalkCommand('会话')).toBeNull();
  });

  it('keeps help copy in plain language without slashes, emoji, or exclamation marks', () => {
    expect(DINGTALK_HELP_TEXT).toContain('## 常用指令');
    expect(DINGTALK_HELP_TEXT).toContain('点下面的按钮即可：查看助手、新会话、最近会话。');
    expect(DINGTALK_HELP_TEXT).toContain('也可以直接发送“新会话”“切换助手”“帮助”。');
    expect(DINGTALK_HELP_TEXT.endsWith('群聊中请 @机器人')).toBe(true);
    expect(DINGTALK_HELP_TEXT).not.toContain('/');
    expect(DINGTALK_WELCOME_TEXT).not.toContain('/');
    expect(DINGTALK_UNKNOWN_COMMAND_REPLY).not.toContain('/');
    expect(DINGTALK_HELP_TEXT).not.toMatch(/[!！]/);
    expect(DINGTALK_HELP_TEXT).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(DINGTALK_COMMAND_SHORTCUT_BUTTONS.map((button) => button.command)).toEqual([
      '/助手',
      '/新会话',
      '/会话',
      '/帮助',
    ]);
  });

  it('returns the raw name for unknown slash commands', () => {
    expect(parseDingTalkCommand('/未知')).toEqual({ args: '', name: '未知' });
    expect(parseDingTalkCommand('/foo bar')).toEqual({ args: 'bar', name: 'foo' });
  });

  it('returns null when the text is not a slash or plain-word command', () => {
    expect(parseDingTalkCommand('hello')).toBeNull();
    expect(parseDingTalkCommand('')).toBeNull();
    expect(parseDingTalkCommand(undefined)).toBeNull();
    expect(parseDingTalkCommand('2')).toBeNull();
  });
});

describe('parseDingTalkBareNumber', () => {
  it('parses a whole-message number after punctuation normalize', () => {
    expect(parseDingTalkBareNumber('2')).toBe(2);
    expect(parseDingTalkBareNumber(' ２。')).toBe(2);
    expect(parseDingTalkBareNumber('12')).toBe(12);
    expect(parseDingTalkBareNumber('0')).toBeNull();
    expect(parseDingTalkBareNumber('帮助')).toBeNull();
    expect(parseDingTalkBareNumber('2 再问')).toBeNull();
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
