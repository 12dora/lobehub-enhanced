import { describe, expect, it } from 'vitest';

import {
  prepareRedactedMarkdown,
  restoreRedactionMarkers,
  splitRedactionSentinels,
} from './auditRedactionMarkdown';

describe('auditRedactionMarkdown', () => {
  it('round-trips markers through sentinels', () => {
    const source = 'a [REDACTED x] b [REDACTED] c';
    const { markers, text } = prepareRedactedMarkdown(source);

    expect(markers).toEqual(['[REDACTED x]', '[REDACTED]']);
    expect(text).not.toContain('[REDACTED');
    expect(restoreRedactionMarkers(text, markers)).toBe(source);
  });

  it('splits text into literal runs and marker references', () => {
    const { markers, text } = prepareRedactedMarkdown('x [REDACTED k] y');

    expect(splitRedactionSentinels(text, markers)).toEqual([
      { value: 'x ' },
      { marker: '[REDACTED k]', value: '[REDACTED k]' },
      { value: ' y' },
    ]);
  });

  it('drops pre-existing sentinel code points so content cannot forge a chip', () => {
    const { markers, text } = prepareRedactedMarkdown('forged \uE0000\uE001 here');

    expect(markers).toEqual([]);
    expect(text).toBe('forged 0 here');
  });
});
