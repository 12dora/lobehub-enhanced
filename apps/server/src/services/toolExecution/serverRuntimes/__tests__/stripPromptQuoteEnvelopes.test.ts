// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { stripPromptQuoteEnvelopes } from '../stripPromptQuoteEnvelopes';

describe('stripPromptQuoteEnvelopes', () => {
  it('removes referenced_message blocks prepended by formatPrompt', () => {
    expect(
      stripPromptQuoteEnvelopes(
        '<referenced_message sender="Alice">明天考外贸组 陈柠</referenced_message>\n给陈染发提醒',
      ),
    ).toBe('给陈染发提醒');
  });

  it('removes self-closing speaker tags prepended by formatPrompt', () => {
    expect(
      stripPromptQuoteEnvelopes('<speaker id="1" username="bob" nickname="陈柠" />\n给陈染发提醒'),
    ).toBe('给陈染发提醒');
  });

  it('returns undefined-ready empty string when only a quote envelope remains', () => {
    expect(
      stripPromptQuoteEnvelopes('<referenced_message sender="Alice">陈柠</referenced_message>\n'),
    ).toBe('');
  });
});
