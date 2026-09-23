import { afterEach, describe, expect, it } from 'vitest';

import {
  clearStructuredOutputBackoff,
  isStructuredOutputBackedOff,
  isUpstreamHttp400,
  noteStructuredOutputHttp400,
} from './structuredOutputBackoff';

describe('structuredOutputBackoff', () => {
  afterEach(() => {
    clearStructuredOutputBackoff();
  });

  it('treats Codex 400s as cacheable and ignores transport errors', () => {
    expect(isUpstreamHttp400(Object.assign(new Error('nope'), { status: 400 }))).toBe(true);
    expect(isUpstreamHttp400(new Error('[chatgpt/gpt-5.4-mini] 400: {"detail":"x"}'))).toBe(true);
    expect(isUpstreamHttp400(new Error('[openai/gpt-4o] 400: no'))).toBe(true);
    expect(isUpstreamHttp400(new Error('400 status code (no body)'))).toBe(true);
    expect(isUpstreamHttp400(new Error('400: bad request'))).toBe(true);
    expect(isUpstreamHttp400(new Error('4000: nope'))).toBe(false);
    expect(isUpstreamHttp400(Object.assign(new Error('down'), { status: 503 }))).toBe(false);
    expect(isUpstreamHttp400(new Error('ECONNRESET'))).toBe(false);
  });

  it('skips the same provider, model, and task for 10 minutes after a 400', () => {
    const now = 1_000_000;
    expect(
      noteStructuredOutputHttp400('chatgpt', 'gpt-5.4-mini', 'topic', new Error('400 bad'), now),
    ).toBe(true);
    expect(isStructuredOutputBackedOff('chatgpt', 'gpt-5.4-mini', 'topic', now + 1)).toBe(true);
    expect(isStructuredOutputBackedOff('chatgpt', 'gpt-5.4-mini', 'handoff', now + 1)).toBe(false);
    expect(isStructuredOutputBackedOff('chatgpt', 'gpt-5.6-luna', 'topic', now + 1)).toBe(false);
    expect(
      isStructuredOutputBackedOff('chatgpt', 'gpt-5.4-mini', 'topic', now + 10 * 60 * 1000),
    ).toBe(false);
  });

  it('does not cache a non-400 failure', () => {
    expect(
      noteStructuredOutputHttp400('chatgpt', 'gpt-5.4-mini', 'topic', new Error('ECONNRESET'), 0),
    ).toBe(false);
    expect(isStructuredOutputBackedOff('chatgpt', 'gpt-5.4-mini', 'topic', 1)).toBe(false);
  });
});
