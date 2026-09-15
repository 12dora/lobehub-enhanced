import { describe, expect, it } from 'vitest';

import { isDingTalkPushAvailable } from './useDingTalkPushAvailable';

describe('isDingTalkPushAvailable', () => {
  it('accepts a dingtalk platform that advertises push', () => {
    expect(
      isDingTalkPushAvailable([
        { capabilities: { chat: true, push: false }, id: 'slack' },
        { capabilities: { chat: true, push: true }, id: 'dingtalk' },
      ]),
    ).toBe(true);
  });

  it('rejects a chat-only dingtalk connector', () => {
    expect(isDingTalkPushAvailable([{ capabilities: { chat: true, push: false }, id: 'dingtalk' }])) //
      .toBe(false);
  });

  /** An older payload predates `capabilities`; treat the unknown as "no push". */
  it('rejects a payload without capabilities', () => {
    expect(isDingTalkPushAvailable([{ id: 'dingtalk' }])).toBe(false);
  });

  it('rejects when the platform is absent or the payload is not a list', () => {
    expect(isDingTalkPushAvailable([{ capabilities: { push: true }, id: 'telegram' }])).toBe(false);
    expect(isDingTalkPushAvailable(undefined)).toBe(false);
    expect(isDingTalkPushAvailable(null)).toBe(false);
  });
});
