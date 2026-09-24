import { describe, expect, it } from 'vitest';

import { type FamilyKnownCard, inheritFamilyCard } from './familyInherit';

const grok46: FamilyKnownCard = {
  abilities: {
    files: true,
    functionCall: true,
    reasoning: true,
    search: true,
    structuredOutput: true,
    vision: true,
  },
  id: 'grok-4.6',
  releasedAt: '2026-08-01',
  settings: {
    extendParams: ['grok4_20ReasoningEffort'],
    searchImpl: 'params',
    searchProvider: 'builtin',
  },
};

const grok45: FamilyKnownCard = {
  abilities: { functionCall: true, reasoning: true, search: true, vision: true },
  id: 'grok-4.5',
  releasedAt: '2026-07-08',
  settings: { extendParams: ['grok4_5ReasoningEffort'], searchImpl: 'params' },
};

const grok420Reasoning: FamilyKnownCard = {
  abilities: { reasoning: true, search: true },
  id: 'grok-4.20-0309-reasoning',
  releasedAt: '2026-03-09',
  settings: { extendParams: ['grok4_3ReasoningEffort'], searchImpl: 'params' },
};

const grok420NonReasoning: FamilyKnownCard = {
  abilities: { reasoning: false, search: true, vision: true },
  id: 'grok-4.20-0309-non-reasoning',
  releasedAt: '2026-03-09',
  settings: { extendParams: ['grok4_20ReasoningEffort'], searchImpl: 'params' },
};

const providerGrok = [grok46, grok45, grok420Reasoning, grok420NonReasoning];

describe('inheritFamilyCard', () => {
  it('gives grok-4.7 the 4.6 donor, not 4.20, and only abilities plus effort/search settings', () => {
    const inherited = inheritFamilyCard('grok-4.7', {
      globalCards: [],
      providerCards: providerGrok,
    });

    expect(inherited).toEqual({
      abilities: {
        files: true,
        functionCall: true,
        reasoning: true,
        search: true,
        structuredOutput: true,
        vision: true,
      },
      settings: { extendParams: ['grok4_20ReasoningEffort'], searchImpl: 'params' },
    });
    expect(inherited).not.toHaveProperty('id');
    expect(inherited).not.toHaveProperty('displayName');
    expect(inherited?.settings).not.toHaveProperty('searchProvider');
  });

  it('compares the minor as a decimal, so 4.20 equals 4.2 and is older than 4.6', () => {
    const newer = inheritFamilyCard('grok-4.7', {
      globalCards: [],
      providerCards: [
        {
          abilities: { files: true, reasoning: true },
          id: 'grok-4.6',
          releasedAt: '2026-08-01',
          settings: { extendParams: ['grok4_20ReasoningEffort'] },
        },
        {
          abilities: { files: false, reasoning: true },
          id: 'grok-4.3',
          releasedAt: '2026-05-01',
          settings: { extendParams: ['grok4_5ReasoningEffort'] },
        },
        {
          abilities: { files: false, reasoning: false },
          id: 'grok-4.20',
          releasedAt: '2026-03-09',
          settings: { extendParams: ['enableReasoning'] },
        },
      ],
    });
    const between = inheritFamilyCard('grok-4.4', {
      globalCards: [],
      providerCards: [
        {
          abilities: { files: true, reasoning: true },
          id: 'grok-4.6',
          releasedAt: '2026-08-01',
          settings: { extendParams: ['grok4_20ReasoningEffort'] },
        },
        {
          abilities: { files: false, reasoning: true },
          id: 'grok-4.3',
          releasedAt: '2026-05-01',
          settings: { extendParams: ['grok4_5ReasoningEffort'] },
        },
        {
          abilities: { files: false, reasoning: false },
          id: 'grok-4.20',
          releasedAt: '2026-03-09',
          settings: { extendParams: ['enableReasoning'] },
        },
      ],
    });

    expect(newer?.settings?.extendParams).toEqual(['grok4_20ReasoningEffort']);
    expect(newer?.abilities?.files).toBe(true);
    expect(between?.settings?.extendParams).toEqual(['grok4_5ReasoningEffort']);
    // grok-4.3's `files: false` is not copied onto the new id.
    expect(between?.abilities?.files).toBeUndefined();
  });

  it('prefers the provider bank over a closer global card of the same stem', () => {
    const inherited = inheritFamilyCard('grok-4.7', {
      globalCards: [grok46],
      providerCards: [grok45],
    });

    expect(inherited?.settings?.extendParams).toEqual(['grok4_5ReasoningEffort']);
  });

  it('falls through to the global bank when the provider has no card of that stem', () => {
    const inherited = inheritFamilyCard('grok-4.7', {
      globalCards: [grok46],
      providerCards: [
        { abilities: { reasoning: true }, id: 'claude-opus-4', releasedAt: '2026-01-01' },
      ],
    });

    expect(inherited?.settings?.extendParams).toEqual(['grok4_20ReasoningEffort']);
  });

  it('falls through to the global same-variant bucket when the provider stem has none', () => {
    const inherited = inheritFamilyCard('grok-4.7', {
      globalCards: [grok46],
      providerCards: [grok420Reasoning, grok420NonReasoning],
    });

    expect(inherited?.settings?.extendParams).toEqual(['grok4_20ReasoningEffort']);
    expect(inherited?.abilities?.files).toBe(true);
  });

  it('returns undefined when neither bank has the exact variant bucket', () => {
    const inherited = inheritFamilyCard('grok-4.7', {
      globalCards: [grok420Reasoning],
      providerCards: [grok420NonReasoning],
    });

    expect(inherited).toBeUndefined();
  });

  it('returns undefined when nothing shares the family stem', () => {
    expect(
      inheritFamilyCard('brand-new-cursor-model', {
        globalCards: providerGrok,
        providerCards: [],
      }),
    ).toBeUndefined();
    expect(
      inheritFamilyCard('grok-keyword-only-test-model', {
        globalCards: providerGrok,
        providerCards: [],
      }),
    ).toBeUndefined();
  });

  it('never lets a non-reasoning id inherit reasoning or extendParams', () => {
    const inherited = inheritFamilyCard('grok-4.7-non-reasoning', {
      globalCards: [],
      providerCards: [
        grok420NonReasoning,
        {
          abilities: { reasoning: true, search: true, vision: true },
          id: 'grok-4.6-non-reasoning',
          releasedAt: '2026-08-01',
          settings: { extendParams: ['grok4_20ReasoningEffort'], searchImpl: 'params' },
        },
      ],
    });

    expect(inherited).toEqual({
      abilities: { reasoning: false, search: true, vision: true },
      settings: { searchImpl: 'params' },
    });
  });

  it('strips vendor prefixes, effort, fast, thinking, and date suffixes before matching', () => {
    const inherited = inheritFamilyCard('cursor-grok-4.7-high-fast', {
      globalCards: [],
      providerCards: [{ ...grok46, id: 'xai/grok-4.6-thinking' }],
    });
    const dated = inheritFamilyCard('x-ai/grok-4.7-2026-03-09', {
      globalCards: [],
      providerCards: [grok46],
    });

    expect(inherited?.abilities?.files).toBe(true);
    expect(dated?.settings?.extendParams).toEqual(['grok4_20ReasoningEffort']);
  });

  it('matches variant words for codex, opus, pro, and composer', () => {
    const cards: FamilyKnownCard[] = [
      {
        abilities: { reasoning: true },
        id: 'gpt-5.3-codex-high',
        releasedAt: '2026-02-01',
        settings: { extendParams: ['gpt5_2ReasoningEffort'] },
      },
      {
        abilities: { reasoning: false },
        id: 'gpt-5.4',
        releasedAt: '2026-03-01',
        settings: { extendParams: ['gpt5_6ReasoningEffort'] },
      },
      {
        abilities: { vision: true },
        id: 'claude-opus-4-thinking-high',
        releasedAt: '2026-01-01',
        settings: { searchImpl: 'params' },
      },
      {
        abilities: { vision: false },
        id: 'claude-sonnet-5-thinking-high',
        releasedAt: '2026-06-01',
      },
      {
        abilities: { vision: true },
        id: 'gemini-3-pro',
        releasedAt: '2026-01-01',
        settings: { searchImpl: 'params' },
      },
      {
        abilities: { vision: false },
        id: 'gemini-3.7-flash',
        releasedAt: '2026-06-01',
      },
      {
        abilities: { functionCall: true },
        id: 'composer-2',
        releasedAt: '2026-01-01',
      },
    ];
    const pools = { globalCards: [], providerCards: cards };

    expect(inheritFamilyCard('gpt-5.3-codex', pools)?.settings?.extendParams).toEqual([
      'gpt5_2ReasoningEffort',
    ]);
    expect(inheritFamilyCard('gpt-5.5-codex-low', pools)?.abilities?.reasoning).toBe(true);
    expect(inheritFamilyCard('claude-opus-5', pools)?.abilities?.vision).toBe(true);
    expect(inheritFamilyCard('claude-sonnet-5', pools)).toBeUndefined();
    expect(inheritFamilyCard('gemini-3.5-pro', pools)?.settings?.searchImpl).toBe('params');
    expect(inheritFamilyCard('composer-2.5', pools)?.abilities?.functionCall).toBe(true);
  });

  it('breaks version ties with the latest releasedAt', () => {
    const inherited = inheritFamilyCard('grok-4.7', {
      globalCards: [],
      providerCards: [
        {
          abilities: { reasoning: false },
          id: 'grok-4.6',
          releasedAt: '2026-01-01',
          settings: { searchImpl: 'internal' },
        },
        {
          abilities: { reasoning: true },
          id: 'grok-4.6-fast',
          releasedAt: '2026-08-01',
          settings: { searchImpl: 'params' },
        },
      ],
    });

    expect(inherited?.settings?.searchImpl).toBe('params');
    expect(inherited?.abilities?.reasoning).toBe(true);
  });

  it('prefers a dated donor over one with no releasedAt when versions tie', () => {
    const inherited = inheritFamilyCard('composer-2.5', {
      globalCards: [],
      providerCards: [
        { abilities: { functionCall: false }, id: 'composer-2' },
        {
          abilities: { functionCall: true },
          id: 'composer-2-fast',
          releasedAt: '2026-04-01',
        },
      ],
    });

    expect(inherited?.abilities?.functionCall).toBe(true);
  });

  it('returns undefined when every donor is newer than the unknown id', () => {
    const donors = [grok46, grok45, grok420Reasoning];

    expect(inheritFamilyCard('grok-4', { globalCards: [], providerCards: donors })).toBeUndefined();
    expect(
      inheritFamilyCard('grok-4.20', { globalCards: [], providerCards: donors }),
    ).toBeUndefined();
  });

  it('matches every dotted, hyphenated, letter-attached, and revision example against a worse donor', () => {
    const enable = 'enableReasoning' as const;
    const budget = 'reasoningBudgetToken' as const;
    const gpt = 'gpt5_2ReasoningEffort' as const;
    const card = (
      id: string,
      extendParam: typeof enable | typeof budget | typeof gpt,
      extras: Partial<FamilyKnownCard> = {},
    ): FamilyKnownCard => ({
      abilities: { files: true, reasoning: true },
      releasedAt: '2026-01-01',
      type: 'chat',
      ...extras,
      id,
      settings: { extendParams: [extendParam], ...extras.settings },
    });

    const cases: Array<{
      donors: FamilyKnownCard[];
      expected?: typeof enable | typeof budget | typeof gpt;
      files?: boolean;
      globalDonors?: FamilyKnownCard[];
      noReasoning?: boolean;
      searchImpl?: 'internal' | 'params' | 'tool';
      type?: string;
      unknown: string;
    }> = [
      {
        donors: [
          card('claude-opus-4-6', enable),
          card('claude-opus-4', budget),
          card('claude-opus-5', gpt, { releasedAt: '2026-06-01' }),
        ],
        expected: enable,
        unknown: 'claude-opus-4-7',
      },
      {
        donors: [
          card('claude-sonnet-4-6', enable),
          card('claude-4.7-sonnet', budget),
          card('claude-sonnet-4.8', gpt, { releasedAt: '2026-06-01' }),
        ],
        expected: budget,
        unknown: 'claude-sonnet-4.7',
      },
      {
        donors: [
          card('claude-3.5-sonnet', enable),
          card('claude-3-sonnet', budget),
          card('claude-3.5-haiku', gpt),
        ],
        expected: enable,
        unknown: 'claude-3-5-sonnet-20241022',
      },
      {
        donors: [card('o3-mini', enable), card('o1-mini', budget), card('o4', gpt)],
        expected: enable,
        unknown: 'o4-mini',
      },
      {
        donors: [card('o1', enable), card('o4-mini', budget), card('o3-mini', gpt)],
        expected: enable,
        unknown: 'o3',
      },
      {
        donors: [card('o4-mini', enable, { abilities: { reasoning: true } }), card('o3', budget)],
        expected: enable,
        unknown: 'o5-mini',
      },
      {
        donors: [card('gpt-3o', enable), card('gpt-4', budget), card('gpt-4o-mini', gpt)],
        expected: enable,
        unknown: 'gpt-4o',
      },
      {
        donors: [card('gpt-4o', enable), card('gpt-4', budget), card('gpt-4o-mini', gpt)],
        expected: enable,
        unknown: 'gpt-4.1o',
      },
      {
        donors: [
          card('kimi-k2', enable),
          card('kimi-k4', budget, { releasedAt: '2026-06-01' }),
          card('kimi-3', gpt),
        ],
        expected: enable,
        unknown: 'kimi-k3',
      },
      {
        donors: [
          card('grok-4.20-0309-non-reasoning', enable, {
            abilities: { reasoning: true, search: true },
            settings: { searchImpl: 'params' },
          }),
          card('grok-4.6-non-reasoning', budget, {
            abilities: { files: true, reasoning: true },
            settings: { searchImpl: 'internal' },
          }),
          card('grok-4.20', gpt, { settings: { searchImpl: 'tool' } }),
        ],
        files: false,
        searchImpl: 'params',
        unknown: 'grok-4-20-non-reasoning',
      },
      {
        donors: [
          card('gemini-2.0-flash', enable),
          card('gemini-2.0-flash-lite', budget),
          card('gemini-2.5-flash', gpt, { releasedAt: '2026-06-01' }),
        ],
        expected: enable,
        unknown: 'gemini-2.0-flash-001',
      },
      {
        donors: [
          card('gemini-2.5-flash', enable),
          card('gemini-2.5-pro', budget),
          card('gemini-2.0-flash', gpt),
        ],
        expected: enable,
        unknown: 'gemini-2.5-flash-preview-04-17',
      },
      {
        donors: [card('grok-4.6', enable), card('grok-4.6-pro', budget)],
        expected: enable,
        unknown: 'grok-4.7-fast',
      },
      {
        donors: [
          card('grok-4.6', enable, { type: 'chat' }),
          card('grok-4.5', budget, { type: 'image', abilities: { functionCall: true } }),
        ],
        expected: budget,
        type: 'image',
        unknown: 'grok-4.7',
      },
      {
        donors: [card('grok-4.6', enable, { type: 'image' })],
        unknown: 'grok-4.7',
      },
      {
        donors: [card('grok-4.6', enable), card('grok-4.5', budget)],
        unknown: 'grok-4.20',
      },
      {
        donors: [card('grok-4.6', enable), card('grok-4.5', budget), card('grok-4.20', gpt)],
        unknown: 'grok-4',
      },
      {
        donors: [
          card('gpt-5.2', enable, {
            abilities: { functionCall: true, reasoning: false, vision: true },
          }),
        ],
        expected: enable,
        noReasoning: true,
        unknown: 'gpt-5.4',
      },
      {
        donors: [card('deepseek-v4-pro', budget), card('deepseek-v4-flash', gpt)],
        expected: enable,
        globalDonors: [card('deepseek-v3.2', enable)],
        unknown: 'deepseek-v4',
      },
      {
        donors: [card('claude-3-5-haiku-20241022', enable)],
        expected: enable,
        unknown: 'claude-haiku-4-5',
      },
      {
        donors: [card('claude-haiku-4-5', enable)],
        expected: enable,
        unknown: 'claude-4-5-haiku',
      },
      {
        donors: [card('claude-haiku-4-5', enable)],
        unknown: 'claude-3-5-haiku-20241022',
      },
    ];

    for (const testCase of cases) {
      const inherited = inheritFamilyCard(
        testCase.unknown,
        { globalCards: testCase.globalDonors ?? [], providerCards: testCase.donors },
        testCase.type ? { type: testCase.type } : undefined,
      );
      if (!testCase.expected && !testCase.searchImpl) {
        expect(inherited, testCase.unknown).toBeUndefined();
        continue;
      }
      if (testCase.searchImpl) {
        expect(inherited?.settings?.searchImpl, testCase.unknown).toBe(testCase.searchImpl);
        expect(inherited?.settings?.extendParams, testCase.unknown).toBeUndefined();
        expect(inherited?.abilities?.reasoning, testCase.unknown).toBe(false);
        expect(inherited?.abilities?.files, testCase.unknown).not.toBe(true);
        continue;
      }
      expect(inherited?.settings?.extendParams, testCase.unknown).toEqual([testCase.expected]);
      if (testCase.noReasoning) {
        expect(inherited?.abilities?.reasoning, testCase.unknown).toBeUndefined();
      }
    }
  });

  it('does not copy extendParams when the caller opts out', () => {
    const inherited = inheritFamilyCard(
      'grok-4.7-xhigh',
      { globalCards: [], providerCards: [grok46] },
      { extendParams: false },
    );

    expect(inherited?.settings).toEqual({ searchImpl: 'params' });
    expect(inherited?.abilities?.reasoning).toBe(true);
  });

  it('keeps cursor bank cards out of another provider and drops cursor effort keys', () => {
    const cursorGemini: FamilyKnownCard = {
      abilities: { reasoning: true, vision: true },
      id: 'gemini-3.7-flash',
      providerId: 'cursor',
      releasedAt: '2026-08-11',
      settings: {
        defaultEffortLevel: 'high',
        effortLevels: ['low', 'medium', 'high'],
        extendParams: ['cursorReasoningEffort'],
        searchImpl: 'params',
      },
    };
    const cursorOpus: FamilyKnownCard = {
      abilities: { reasoning: true },
      id: 'claude-opus-5-thinking',
      providerId: 'cursor',
      releasedAt: '2026-08-11',
      settings: {
        defaultEffortLevel: 'high',
        effortLevels: ['low', 'high', 'max'],
        extendParams: ['cursorReasoningEffort'],
        searchImpl: 'params',
      },
    };

    expect(
      inheritFamilyCard('gemini-3.8-flash', { globalCards: [cursorGemini], providerCards: [] }),
    ).toBeUndefined();
    expect(
      inheritFamilyCard('claude-opus-6-thinking', { globalCards: [cursorOpus], providerCards: [] }),
    ).toBeUndefined();

    const mixed = inheritFamilyCard('claude-opus-6-thinking', {
      globalCards: [],
      providerCards: [
        {
          abilities: { reasoning: true },
          id: 'claude-opus-5-thinking',
          releasedAt: '2026-08-11',
          settings: {
            defaultEffortLevel: 'high',
            effortLevels: ['low', 'high', 'max'],
            extendParams: ['cursorReasoningEffort', 'enableReasoning'],
            searchImpl: 'params',
          },
        },
      ],
    });
    expect(mixed?.settings).toEqual({
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    });
    expect(mixed?.settings).not.toHaveProperty('effortLevels');
    expect(mixed?.settings).not.toHaveProperty('defaultEffortLevel');

    const forCursor = inheritFamilyCard(
      'gemini-3.8-flash',
      { globalCards: [cursorGemini], providerCards: [] },
      { includeCursorDonors: true },
    );
    expect(forCursor?.settings?.extendParams).toEqual(['cursorReasoningEffort']);
    expect(forCursor?.settings?.searchImpl).toBe('params');
    expect(forCursor?.settings?.effortLevels).toBeUndefined();
    expect(forCursor?.settings?.defaultEffortLevel).toBeUndefined();
  });
});
