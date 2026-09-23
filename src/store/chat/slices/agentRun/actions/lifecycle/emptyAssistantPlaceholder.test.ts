import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isEmptyAssistantPlaceholder } from './emptyAssistantPlaceholder';

const assistant = (fields: Partial<UIChatMessage> = {}) =>
  ({ content: '...', id: 'a', role: 'assistant', ...fields }) as UIChatMessage;

describe('isEmptyAssistantPlaceholder', () => {
  it.each(['...', '', '   ', ' ... '])('treats content %j as a placeholder', (content) => {
    expect(isEmptyAssistantPlaceholder(assistant({ content }))).toBe(true);
  });

  it('is false for anything but an assistant row', () => {
    expect(isEmptyAssistantPlaceholder(assistant({ role: 'user' }))).toBe(false);
    expect(isEmptyAssistantPlaceholder(assistant({ role: 'tool' }))).toBe(false);
    expect(isEmptyAssistantPlaceholder(assistant({ role: 'assistantGroup' }))).toBe(false);
    expect(isEmptyAssistantPlaceholder(undefined)).toBe(false);
  });

  it('is false once the row holds real text', () => {
    expect(isEmptyAssistantPlaceholder(assistant({ content: '模板还在' }))).toBe(false);
  });

  it.each<[string, Partial<UIChatMessage>]>([
    ['tool calls', { tools: [{ apiName: 'x', id: 'c1' } as any] }],
    ['assistantGroup children', { children: [{ content: 'x', id: 'b1' } as any] }],
    ['an error', { error: { type: 'ProviderBizError' } as any }],
    ['reasoning', { reasoning: { content: 'thinking' } }],
    ['images', { imageList: [{ alt: '', id: 'i1', url: 'u' }] }],
    ['files', { fileList: [{ id: 'f1' } as any] }],
    ['search grounding', { search: { citations: [] } as any }],
  ])('is false when the row carries %s', (_label, fields) => {
    expect(isEmptyAssistantPlaceholder(assistant(fields))).toBe(false);
  });

  it('ignores whitespace-only reasoning', () => {
    expect(isEmptyAssistantPlaceholder(assistant({ reasoning: { content: '  ' } }))).toBe(true);
  });
});
