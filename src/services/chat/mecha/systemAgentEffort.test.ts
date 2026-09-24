import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as aiInfraStore from '@/store/aiInfra';

import { resolveSystemAgentEffortParams, withSystemAgentEffortParams } from './systemAgentEffort';

const item = (reasoningEffort?: string | null) => ({
  model: 'gpt-5.6',
  provider: 'openai',
  reasoningEffort: reasoningEffort as never,
});

interface TestCard {
  id: string;
  providerId: string;
  settings?: { defaultEffortLevel?: string; effortLevels?: string[]; extendParams?: string[] };
}

const mockCatalog = ({
  builtinAiModelList = [],
  enabledAiModels = [],
}: {
  builtinAiModelList?: TestCard[];
  enabledAiModels?: TestCard[];
}) => {
  vi.spyOn(aiInfraStore, 'getAiInfraStoreState').mockReturnValue({
    builtinAiModelList,
    enabledAiModels,
  } as never);
};

const mockEnabledAiModels = (enabledAiModels: TestCard[]) => {
  mockCatalog({ enabledAiModels });
};

const openaiCard = (extendParams: string[] | undefined) => ({
  id: 'gpt-5.6',
  providerId: 'openai',
  settings: extendParams ? { extendParams } : undefined,
});

describe('resolveSystemAgentEffortParams', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnabledAiModels([openaiCard(['gpt5_6ReasoningEffort'])]);
  });

  it('returns {} when the service model stores no level', () => {
    expect(resolveSystemAgentEffortParams(item())).toEqual({});
  });

  it('returns {} for an explicit null clear', () => {
    expect(resolveSystemAgentEffortParams(item(null))).toEqual({});
  });

  it('drops a null level rather than putting it on the wire', () => {
    expect(withSystemAgentEffortParams({ ...item(null), model: 'gpt-5.6' })).toEqual({
      model: 'gpt-5.6',
      provider: 'openai',
    });
  });

  it('returns {} for an undefined item', () => {
    expect(resolveSystemAgentEffortParams(undefined)).toEqual({});
  });

  it('returns {} when the model exposes no discrete effort control', () => {
    mockEnabledAiModels([openaiCard(['enableReasoning', 'reasoningBudgetToken'])]);

    expect(resolveSystemAgentEffortParams(item('high'))).toEqual({});
  });

  it('returns {} when the model has no extend params at all', () => {
    mockEnabledAiModels([openaiCard(undefined)]);

    expect(resolveSystemAgentEffortParams(item('high'))).toEqual({});
  });

  it('maps the stored level onto the wire param the control declares', () => {
    expect(resolveSystemAgentEffortParams(item('xhigh'))).toEqual({ reasoning_effort: 'xhigh' });
  });

  it('clamps a level the current model no longer offers back to the control default', () => {
    mockEnabledAiModels([
      {
        id: 'gpt-5.6',
        providerId: 'openai',
        settings: { extendParams: ['grok4_5ReasoningEffort'] },
      },
    ]);

    expect(resolveSystemAgentEffortParams(item('max'))).toEqual({ reasoning_effort: 'high' });
  });

  it('emits only the resolved control, never params for options it did not configure', () => {
    mockEnabledAiModels([
      {
        id: 'gpt-5.6',
        providerId: 'openai',
        settings: {
          extendParams: [
            'enableAdaptiveThinking',
            'enableReasoning',
            'reasoningBudgetToken',
            'effort',
          ],
        },
      },
    ]);

    const result = resolveSystemAgentEffortParams(item('high'));

    expect(result).toEqual({ effort: 'high' });
    expect(result).not.toHaveProperty('thinking');
  });

  it('routes through the control the registry prioritises when several are present', () => {
    mockEnabledAiModels([
      {
        id: 'gpt-5.6',
        providerId: 'openai',
        settings: { extendParams: ['thinking', 'thinkingLevel'] },
      },
    ]);

    expect(resolveSystemAgentEffortParams(item('low'))).toEqual({ thinkingLevel: 'low' });
  });

  it('falls back to a canonical same-id card for an empty aggregator (lobehub) card', () => {
    mockEnabledAiModels([
      openaiCard(['gpt5_6ReasoningEffort']),
      { id: 'gpt-5.6', providerId: 'lobehub', settings: { extendParams: [] } },
    ]);

    expect(
      resolveSystemAgentEffortParams({
        model: 'gpt-5.6',
        provider: 'lobehub',
        reasoningEffort: 'xhigh' as never,
      }),
    ).toEqual({ reasoning_effort: 'xhigh' });
  });

  it('falls back to a builtin canonical card when only the LobeHub card is enabled', () => {
    mockCatalog({
      builtinAiModelList: [openaiCard(['gpt5_6ReasoningEffort'])],
      enabledAiModels: [{ id: 'gpt-5.6', providerId: 'lobehub', settings: { extendParams: [] } }],
    });

    expect(
      resolveSystemAgentEffortParams({
        model: 'gpt-5.6',
        provider: 'lobehub',
        reasoningEffort: 'xhigh' as never,
      }),
    ).toEqual({ reasoning_effort: 'xhigh' });
  });

  it.each(['standard', 'extended', 'max'] as const)(
    'projects ChatGPT Web %s onto chatgptWebThinkingEffort',
    (level) => {
      mockEnabledAiModels([
        {
          id: 'gpt-5-6-thinking',
          providerId: 'chatgptweb',
          settings: { extendParams: ['chatgptWebThinkingEffort'] },
        },
      ]);

      expect(
        resolveSystemAgentEffortParams({
          model: 'gpt-5-6-thinking',
          provider: 'chatgptweb',
          reasoningEffort: level,
        }),
      ).toEqual({ chatgptWebThinkingEffort: level });
    },
  );

  it('does not emit chatgptWebThinkingEffort for a non-ChatGPT-Web model', () => {
    expect(resolveSystemAgentEffortParams(item('extended'))).toEqual({
      reasoning_effort: 'medium',
    });
    expect(resolveSystemAgentEffortParams(item('extended'))).not.toHaveProperty(
      'chatgptWebThinkingEffort',
    );
  });

  it("does not inherit another provider's controls for a non-aggregator empty card", () => {
    mockEnabledAiModels([
      openaiCard(['gpt5_6ReasoningEffort']),
      { id: 'gpt-5.6', providerId: 'cometapi', settings: { extendParams: [] } },
    ]);

    expect(
      resolveSystemAgentEffortParams({
        model: 'gpt-5.6',
        provider: 'cometapi',
        reasoningEffort: 'xhigh' as never,
      }),
    ).toEqual({});
  });

  describe('per-model effort narrowing (collapsed Cursor card)', () => {
    const cursorItem = (reasoningEffort: string) => ({
      model: 'grok-4.7',
      provider: 'cursor',
      reasoningEffort: reasoningEffort as never,
    });

    type Narrowing = Omit<NonNullable<TestCard['settings']>, 'extendParams'>;

    const cursorCard = (settings: Narrowing = {}): TestCard => ({
      id: 'grok-4.7',
      providerId: 'cursor',
      settings: { extendParams: ['cursorReasoningEffort'], ...settings },
    });

    const narrowed: Narrowing = {
      defaultEffortLevel: 'high',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
    };

    it('keeps a level the card offers', () => {
      mockEnabledAiModels([cursorCard(narrowed)]);

      expect(resolveSystemAgentEffortParams(cursorItem('medium'))).toEqual({
        reasoning_effort: 'medium',
      });
    });

    it('clamps a level the card lacks onto the nearest offered level', () => {
      mockEnabledAiModels([cursorCard(narrowed)]);

      expect(resolveSystemAgentEffortParams(cursorItem('max'))).toEqual({
        reasoning_effort: 'xhigh',
      });
      expect(resolveSystemAgentEffortParams(cursorItem('minimal'))).toEqual({
        reasoning_effort: 'low',
      });
    });

    it('uses the card default for a level the control does not know', () => {
      mockEnabledAiModels([cursorCard({ ...narrowed, defaultEffortLevel: 'medium' })]);

      expect(resolveSystemAgentEffortParams(cursorItem('extended'))).toEqual({
        reasoning_effort: 'medium',
      });
    });

    it('breaks a tie toward the stronger level', () => {
      mockEnabledAiModels([cursorCard({ effortLevels: ['medium', 'xhigh'] })]);

      expect(resolveSystemAgentEffortParams(cursorItem('high'))).toEqual({
        reasoning_effort: 'xhigh',
      });
    });

    it('passes every control level through when the card does not narrow', () => {
      mockEnabledAiModels([cursorCard()]);

      expect(resolveSystemAgentEffortParams(cursorItem('max'))).toEqual({
        reasoning_effort: 'max',
      });
    });

    it('narrows any control, e.g. an OpenAI card', () => {
      mockEnabledAiModels([
        {
          ...openaiCard(['gpt5_6ReasoningEffort']),
          settings: { effortLevels: ['low', 'high'], extendParams: ['gpt5_6ReasoningEffort'] },
        },
      ]);

      expect(resolveSystemAgentEffortParams(item('ultra'))).toEqual({ reasoning_effort: 'high' });
    });
  });
});
