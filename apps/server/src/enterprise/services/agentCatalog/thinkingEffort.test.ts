import { describe, expect, it } from 'vitest';

import { resolveThinkingEffortChatConfigPatch } from './thinkingEffort';

describe('resolveThinkingEffortChatConfigPatch', () => {
  it('returns the registry chatConfig key and level for a valid pin', () => {
    expect(
      resolveThinkingEffortChatConfigPatch({
        thinkingEffort: { controlKey: 'reasoningEffort', level: 'high' },
      }),
    ).toEqual({ configKey: 'reasoningEffort', level: 'high' });
    expect(
      resolveThinkingEffortChatConfigPatch({
        thinkingEffort: { controlKey: 'gpt5_6ReasoningEffort', level: 'ultra' },
      }),
    ).toEqual({ configKey: 'gpt5_6ReasoningEffort', level: 'ultra' });
  });

  it('returns null when the pin is absent or explicitly unset', () => {
    expect(resolveThinkingEffortChatConfigPatch(undefined)).toBeNull();
    expect(resolveThinkingEffortChatConfigPatch(null)).toBeNull();
    expect(resolveThinkingEffortChatConfigPatch({})).toBeNull();
    expect(resolveThinkingEffortChatConfigPatch({ thinkingEffort: null })).toBeNull();
  });

  it('ignores unknown control keys and levels the control does not offer', () => {
    expect(
      resolveThinkingEffortChatConfigPatch({
        thinkingEffort: { controlKey: 'not-a-control', level: 'high' },
      }),
    ).toBeNull();
    expect(
      resolveThinkingEffortChatConfigPatch({
        thinkingEffort: { controlKey: 'reasoningEffort', level: 'ultra' },
      }),
    ).toBeNull();
  });

  it('fails open on malformed stored values without throwing', () => {
    expect(resolveThinkingEffortChatConfigPatch({ thinkingEffort: 'high' as never })).toBeNull();
    expect(
      resolveThinkingEffortChatConfigPatch({
        thinkingEffort: { controlKey: 1, level: 'high' } as never,
      }),
    ).toBeNull();
    expect(
      resolveThinkingEffortChatConfigPatch({
        thinkingEffort: { controlKey: 'reasoningEffort' } as never,
      }),
    ).toBeNull();
    expect(() => resolveThinkingEffortChatConfigPatch({ thinkingEffort: null })).not.toThrow();
  });
});
