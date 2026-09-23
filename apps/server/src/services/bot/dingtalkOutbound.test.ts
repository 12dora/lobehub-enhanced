import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDingTalkDeliveredText,
  clearDingTalkDeliveredTextForThread,
  composeDingTalkFinalText,
  DINGTALK_DELIVERED_TEXT_MAX_KEYS,
  DINGTALK_DELIVERED_TEXT_TTL_MS,
  DINGTALK_EMPTY_TURN_REPLY,
  isBlankDingTalkAssistantText,
  rememberDingTalkDeliveredText,
  renderDingTalkPartial,
  resolveDingTalkOutboundText,
  takeDingTalkDeliveredText,
} from './dingtalkOutbound';

describe('DingTalk outbound text', () => {
  afterEach(() => {
    clearDingTalkDeliveredText();
  });

  it('treats whitespace and ellipsis placeholders as blank, and keeps real sentences', () => {
    expect(isBlankDingTalkAssistantText('')).toBe(true);
    expect(isBlankDingTalkAssistantText(' \n\t ')).toBe(true);
    expect(isBlankDingTalkAssistantText('...')).toBe(true);
    expect(isBlankDingTalkAssistantText('…')).toBe(true);
    expect(isBlankDingTalkAssistantText('。。。')).toBe(true);
    expect(isBlankDingTalkAssistantText('wait...')).toBe(false);
    expect(isBlankDingTalkAssistantText('答案')).toBe(false);
  });

  it('does not send a bubble for empty or ellipsis-only text', () => {
    expect(
      resolveDingTalkOutboundText({ content: '...', hadToolCalls: false, otherMessageSent: false }),
    ).toBe('');
    expect(
      resolveDingTalkOutboundText({ content: '  ', hadToolCalls: false, otherMessageSent: false }),
    ).toBe('');
  });

  it('sends a short Chinese line after tool calls when nothing else was sent', () => {
    expect(
      resolveDingTalkOutboundText({ content: '...', hadToolCalls: true, otherMessageSent: false }),
    ).toBe(DINGTALK_EMPTY_TURN_REPLY);
    expect(
      resolveDingTalkOutboundText({ content: '', hadToolCalls: true, otherMessageSent: false }),
    ).toBe(DINGTALK_EMPTY_TURN_REPLY);
  });

  it('skips the fallback when another message was already sent', () => {
    expect(
      resolveDingTalkOutboundText({ content: '...', hadToolCalls: true, otherMessageSent: true }),
    ).toBe('');
  });

  it('keeps a real streamed partial and converts tables in the final text', () => {
    rememberDingTalkDeliveredText('dingtalk:cid', 'op-1', '**已经查过**');
    expect(takeDingTalkDeliveredText('dingtalk:cid', 'op-1')).toBe('**已经查过**');

    const table = ['| 项目 | 内容 |', '| --- | --- |', '| 甲方 | 福瑞思 |'].join('\n');
    expect(
      composeDingTalkFinalText({
        rawContent: table,
        toolCalls: 1,
      }),
    ).toBe('**甲方**：福瑞思');

    expect(
      composeDingTalkFinalText({
        deliveredText: '工具结果已经说明了',
        otherMessageSent: false,
        rawContent: '...',
        toolCalls: 2,
      }),
    ).toBe('工具结果已经说明了');

    expect(
      composeDingTalkFinalText({
        otherMessageSent: false,
        rawContent: '...',
        totalToolCalls: 1,
      }),
    ).toBe(DINGTALK_EMPTY_TURN_REPLY);

    expect(
      composeDingTalkFinalText({
        otherMessageSent: true,
        rawContent: '...',
        toolCalls: 1,
      }),
    ).toBe('');
  });

  it('does not stream a placeholder partial, and converts a table partial', () => {
    expect(renderDingTalkPartial('...')).toBeUndefined();
    expect(renderDingTalkPartial('  ')).toBeUndefined();
    expect(renderDingTalkPartial('| 项目 | 内容 |\n| --- | --- |\n| 乙方 | 开关厂 |')).toBe(
      '**乙方**：开关厂',
    );
  });

  it('expires a partial after 30 minutes and caps the map', () => {
    rememberDingTalkDeliveredText('dingtalk:old', 'op', '旧', 0);
    expect(takeDingTalkDeliveredText('dingtalk:old', 'op', DINGTALK_DELIVERED_TEXT_TTL_MS)).toBe(
      '',
    );

    for (let i = 0; i < DINGTALK_DELIVERED_TEXT_MAX_KEYS + 1; i++) {
      rememberDingTalkDeliveredText(`dingtalk:t${i}`, undefined, `text-${i}`, i);
    }
    expect(
      takeDingTalkDeliveredText('dingtalk:t0', undefined, DINGTALK_DELIVERED_TEXT_MAX_KEYS),
    ).toBe('');
    expect(
      takeDingTalkDeliveredText(
        `dingtalk:t${DINGTALK_DELIVERED_TEXT_MAX_KEYS}`,
        undefined,
        DINGTALK_DELIVERED_TEXT_MAX_KEYS,
      ),
    ).toBe(`text-${DINGTALK_DELIVERED_TEXT_MAX_KEYS}`);
  });

  it('clears one thread on the error and waiting paths without dropping another', () => {
    rememberDingTalkDeliveredText('dingtalk:a', 'op', 'A');
    rememberDingTalkDeliveredText('dingtalk:b', 'op', 'B');
    clearDingTalkDeliveredTextForThread('dingtalk:a');
    expect(takeDingTalkDeliveredText('dingtalk:a', 'op')).toBe('');
    expect(takeDingTalkDeliveredText('dingtalk:b', 'op')).toBe('B');
  });

  it('leaves a fenced table inside the answer unchanged', () => {
    const fenced = '```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```';
    expect(composeDingTalkFinalText({ rawContent: fenced })).toBe(fenced);
  });
});
