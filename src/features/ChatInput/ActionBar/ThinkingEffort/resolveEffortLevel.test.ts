import { EFFORT_CONTROL_REGISTRY } from '@lobechat/model-runtime';
import { describe, expect, it } from 'vitest';

import {
  clampToOfferedLevel,
  hasModelEffortNarrowing,
  type ModelEffortSettings,
  resolveCurrentEffortLevel,
  resolveDefaultEffortLevel,
  resolveOfferedEffortLevels,
} from './resolveEffortLevel';

const cursor = {
  definition: EFFORT_CONTROL_REGISTRY.cursorReasoningEffort,
  key: 'cursorReasoningEffort',
  model: 'grok-4.7',
} as const;

/** A collapsed Cursor card: four upstream variants, `high` is the CLI's unsuffixed one. */
const grokCard: ModelEffortSettings = {
  defaultEffortLevel: 'high',
  effortLevels: ['low', 'medium', 'high', 'xhigh'],
};

describe('resolveDefaultEffortLevel', () => {
  it('falls back to the registry default', () => {
    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.reasoningEffort,
        key: 'reasoningEffort',
        model: 'o3',
      }),
    ).toBe('medium');

    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.thinkingLevel4,
        key: 'thinkingLevel4',
        model: 'gemini-flash-latest',
      }),
    ).toBe('minimal');
  });

  it('uses the model-specific thinkingLevel default', () => {
    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.thinkingLevel,
        key: 'thinkingLevel',
        model: 'gemini-flash-latest',
      }),
    ).toBe('medium');

    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.thinkingLevel,
        key: 'thinkingLevel',
        model: 'gemini-3.5-flash-lite',
      }),
    ).toBe('minimal');
  });

  it('keeps the generic thinkingLevel default for models without an override', () => {
    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.thinkingLevel,
        key: 'thinkingLevel',
        model: 'gemini-3.0-pro',
      }),
    ).toBe('high');

    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.thinkingLevel,
        key: 'thinkingLevel',
      }),
    ).toBe('high');
  });

  it('defaults gpt5_2ReasoningEffort to medium on gpt-5.5 only', () => {
    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.gpt5_2ReasoningEffort,
        key: 'gpt5_2ReasoningEffort',
        model: 'gpt-5.5',
      }),
    ).toBe('medium');

    expect(
      resolveDefaultEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.gpt5_2ReasoningEffort,
        key: 'gpt5_2ReasoningEffort',
        model: 'gpt-5.2',
      }),
    ).toBe('none');
  });
});

describe('resolveCurrentEffortLevel', () => {
  it('returns the persisted level when the control still offers it', () => {
    expect(
      resolveCurrentEffortLevel({
        config: { gpt5_2ReasoningEffort: 'xhigh' },
        definition: EFFORT_CONTROL_REGISTRY.gpt5_2ReasoningEffort,
        key: 'gpt5_2ReasoningEffort',
        model: 'gpt-5.5',
      }),
    ).toBe('xhigh');
  });

  it('falls back to the model-specific default when the persisted level is not offered', () => {
    expect(
      resolveCurrentEffortLevel({
        // `max` belongs to another family's control — it is not offered here.
        config: { gpt5_2ReasoningEffort: 'max' } as never,
        definition: EFFORT_CONTROL_REGISTRY.gpt5_2ReasoningEffort,
        key: 'gpt5_2ReasoningEffort',
        model: 'gpt-5.5',
      }),
    ).toBe('medium');
  });

  it('falls back to the default when nothing is persisted', () => {
    expect(
      resolveCurrentEffortLevel({
        config: {},
        definition: EFFORT_CONTROL_REGISTRY.thinkingLevel,
        key: 'thinkingLevel',
        model: 'gemini-flash-lite-latest',
      }),
    ).toBe('minimal');

    expect(
      resolveCurrentEffortLevel({
        definition: EFFORT_CONTROL_REGISTRY.effort,
        key: 'effort',
        model: 'claude-opus-4-6',
      }),
    ).toBe('high');
  });
});

describe('per-model effort narrowing', () => {
  describe('resolveOfferedEffortLevels', () => {
    it('keeps every registry level when the card does not narrow the control', () => {
      expect(resolveOfferedEffortLevels(cursor.definition)).toEqual([
        ...EFFORT_CONTROL_REGISTRY.cursorReasoningEffort.levels,
      ]);
      expect(resolveOfferedEffortLevels(cursor.definition, { effortLevels: [] })).toEqual([
        ...EFFORT_CONTROL_REGISTRY.cursorReasoningEffort.levels,
      ]);
    });

    it('offers only the card levels, in registry order', () => {
      expect(
        resolveOfferedEffortLevels(cursor.definition, {
          effortLevels: ['xhigh', 'low', 'high', 'medium'],
        }),
      ).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('falls back to every level when the card lists none of the control levels', () => {
      expect(
        resolveOfferedEffortLevels(EFFORT_CONTROL_REGISTRY.grok4_5ReasoningEffort, {
          effortLevels: ['xhigh', 'max'],
        }),
      ).toEqual(['low', 'medium', 'high']);
    });
  });

  describe('clampToOfferedLevel', () => {
    const order = EFFORT_CONTROL_REGISTRY.cursorReasoningEffort.levels;

    it('returns an offered level unchanged', () => {
      expect(clampToOfferedLevel(order, ['low', 'high'], 'high')).toBe('high');
    });

    it('moves a missing level to the nearest offered one', () => {
      expect(clampToOfferedLevel(order, ['low', 'medium', 'high', 'xhigh'], 'max')).toBe('xhigh');
      expect(clampToOfferedLevel(order, ['low', 'medium', 'high', 'xhigh'], 'none')).toBe('low');
    });

    it('breaks a tie toward the stronger level', () => {
      expect(clampToOfferedLevel(order, ['medium', 'xhigh'], 'high')).toBe('xhigh');
      expect(clampToOfferedLevel(order, ['low', 'high'], 'medium')).toBe('high');
    });

    it('gives up on a level the control does not know', () => {
      expect(clampToOfferedLevel(order, ['low', 'high'], 'ultra')).toBeUndefined();
    });
  });

  it('hasModelEffortNarrowing only reports cards that narrow something', () => {
    expect(hasModelEffortNarrowing(undefined)).toBe(false);
    expect(hasModelEffortNarrowing({})).toBe(false);
    expect(hasModelEffortNarrowing({ effortLevels: [] })).toBe(false);
    expect(hasModelEffortNarrowing({ effortLevels: ['high'] })).toBe(true);
    expect(hasModelEffortNarrowing({ defaultEffortLevel: 'medium' })).toBe(true);
  });

  describe('resolveDefaultEffortLevel', () => {
    it('uses the card default when it is offered', () => {
      expect(resolveDefaultEffortLevel({ ...cursor, modelSettings: grokCard })).toBe('high');
      expect(
        resolveDefaultEffortLevel({
          ...cursor,
          modelSettings: { defaultEffortLevel: 'medium', effortLevels: ['low', 'medium', 'high'] },
        }),
      ).toBe('medium');
    });

    it('honours a card default without a level subset', () => {
      expect(
        resolveDefaultEffortLevel({ ...cursor, modelSettings: { defaultEffortLevel: 'max' } }),
      ).toBe('max');
    });

    it('ignores a card default the card does not offer and clamps the registry default', () => {
      expect(
        resolveDefaultEffortLevel({
          ...cursor,
          modelSettings: { defaultEffortLevel: 'max', effortLevels: ['low', 'medium'] },
        }),
      ).toBe('medium');
    });

    it('clamps the registry default onto the card levels, ties toward stronger', () => {
      expect(
        resolveDefaultEffortLevel({
          ...cursor,
          modelSettings: { effortLevels: ['medium', 'xhigh'] },
        }),
      ).toBe('xhigh');
      expect(
        resolveDefaultEffortLevel({ ...cursor, modelSettings: { effortLevels: ['high', 'max'] } }),
      ).toBe('high');
    });

    it('applies narrowing to any control, not only Cursor', () => {
      expect(
        resolveDefaultEffortLevel({
          definition: EFFORT_CONTROL_REGISTRY.gpt5_2ReasoningEffort,
          key: 'gpt5_2ReasoningEffort',
          model: 'gpt-5.5',
          modelSettings: { effortLevels: ['high', 'xhigh'] },
        }),
      ).toBe('high');
    });

    it('keeps the registry default for the full Cursor control', () => {
      expect(resolveDefaultEffortLevel(cursor)).toBe('high');
    });
  });

  describe('resolveCurrentEffortLevel', () => {
    it('keeps a stored level the card offers', () => {
      expect(
        resolveCurrentEffortLevel({
          ...cursor,
          config: { cursorReasoningEffort: 'low' },
          modelSettings: grokCard,
        }),
      ).toBe('low');
    });

    it('shows the nearest offered level for a stored level the card lacks', () => {
      expect(
        resolveCurrentEffortLevel({
          ...cursor,
          config: { cursorReasoningEffort: 'max' },
          modelSettings: grokCard,
        }),
      ).toBe('xhigh');

      expect(
        resolveCurrentEffortLevel({
          ...cursor,
          config: { cursorReasoningEffort: 'minimal' },
          modelSettings: grokCard,
        }),
      ).toBe('low');
    });

    it('falls back to the card default for a level the control does not know', () => {
      expect(
        resolveCurrentEffortLevel({
          ...cursor,
          config: { cursorReasoningEffort: 'ultra' } as never,
          modelSettings: { ...grokCard, defaultEffortLevel: 'medium' },
        }),
      ).toBe('medium');
    });

    it('falls back to the card default when nothing is stored', () => {
      expect(resolveCurrentEffortLevel({ ...cursor, config: {}, modelSettings: grokCard })).toBe(
        'high',
      );
    });

    it('keeps every stored control level when the card does not narrow', () => {
      expect(
        resolveCurrentEffortLevel({ ...cursor, config: { cursorReasoningEffort: 'max' } }),
      ).toBe('max');
    });
  });
});
