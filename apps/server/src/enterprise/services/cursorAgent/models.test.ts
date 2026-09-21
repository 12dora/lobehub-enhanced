// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseCursorModelList } from './models';

describe('parseCursorModelList', () => {
  it('parses id/name lines and strips (current)/(default) suffixes', () => {
    const models = parseCursorModelList(`Available models

auto - Auto (default)
composer-2.5 - Composer 2.5
cursor-grok-4.6-high - Cursor Grok 4.6 High (current)
not a model line
`);

    expect(models).toEqual([
      { id: 'auto', name: 'Auto' },
      { id: 'composer-2.5', name: 'Composer 2.5' },
      { id: 'cursor-grok-4.6-high', name: 'Cursor Grok 4.6 High' },
    ]);
  });

  it('strips zero-width characters and collapses repeated whitespace in ids and names', () => {
    const models = parseCursorModelList(
      [
        'grok-4.7-low - Grok 4.7  Low',
        'grok-4.7-high-fast - Grok 4.7  High Fast\u200B\u200B',
        'grok-4.7-medium\u200B - Grok\uFEFF 4.7\t\tMedium',
      ].join('\n'),
    );

    expect(models).toEqual([
      { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
      { id: 'grok-4.7-high-fast', name: 'Grok 4.7 High Fast' },
      { id: 'grok-4.7-medium', name: 'Grok 4.7 Medium' },
    ]);
  });
});
