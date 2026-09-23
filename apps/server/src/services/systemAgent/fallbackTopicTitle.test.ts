import { describe, expect, it } from 'vitest';

import { fallbackTopicTitle } from './fallbackTopicTitle';

describe('fallbackTopicTitle', () => {
  it('clips the first user message to 20 characters', () => {
    const source = '请帮我写一份非常详细的木质素磺酸钠检测规程';
    const title = fallbackTopicTitle(source);
    expect(title).toBe(Array.from(source).slice(0, 20).join(''));
    expect(Array.from(title!).length).toBe(20);
    expect(fallbackTopicTitle('1234567890123456789012345')).toBe('12345678901234567890');
  });

  it('strips a leading DingTalk prefix so the bridge does not add it twice', () => {
    expect(fallbackTopicTitle('钉钉 · 你好')).toBe('你好');
    expect(fallbackTopicTitle('钉钉·周报')).toBe('周报');
  });

  it('returns null when the message is empty after the prefix', () => {
    expect(fallbackTopicTitle('  钉钉 ·  ')).toBeNull();
    expect(fallbackTopicTitle('')).toBeNull();
    expect(fallbackTopicTitle(undefined)).toBeNull();
  });

  it('collapses whitespace before clipping', () => {
    expect(fallbackTopicTitle('第一行\n第二行')).toBe('第一行 第二行');
  });
});
