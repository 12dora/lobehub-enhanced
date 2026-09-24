import type { AIChatModelCard, ModelEffortLevel } from '../types/aiModel';

const RELEASED_AT = '2026-08-11';

const cursorEffort = (
  levels: readonly ModelEffortLevel[],
  defaultEffortLevel: ModelEffortLevel,
): AIChatModelCard['settings'] => ({
  defaultEffortLevel,
  effortLevels: [...levels],
  extendParams: ['cursorReasoningEffort'],
});

/**
 * Cursor-only ids. Cards whose id also exists on another provider are omitted:
 * the live `models()` list still emits them, and a shared id would win the
 * id-only global bank fallback (cursor sorts ahead of those providers).
 */
const cursorChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: false, vision: true },
    contextWindowTokens: 200_000,
    description: "Cursor's in-house coding model.",
    displayName: 'Composer 2.5',
    enabled: true,
    family: 'composer',
    generation: 'composer-2.5',
    id: 'composer-2.5',
    releasedAt: RELEASED_AT,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: false },
    contextWindowTokens: 200_000,
    description: 'Cursor-hosted Grok 4.6.',
    displayName: 'Grok 4.6',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.6',
    id: 'cursor-grok-4.6',
    releasedAt: RELEASED_AT,
    settings: cursorEffort(['low', 'medium', 'high', 'xhigh'], 'high'),
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Claude Opus 5 with a 1M context window.',
    displayName: 'Claude Opus 5 1M Thinking',
    enabled: true,
    family: 'claude',
    generation: 'claude-5',
    id: 'claude-opus-5-thinking',
    releasedAt: RELEASED_AT,
    settings: cursorEffort(['low', 'medium', 'high', 'xhigh', 'max'], 'high'),
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Claude Sonnet 5 with a 1M context window.',
    displayName: 'Claude Sonnet 5 1M Thinking',
    enabled: true,
    family: 'claude',
    generation: 'claude-5',
    id: 'claude-sonnet-5-thinking',
    releasedAt: RELEASED_AT,
    settings: cursorEffort(['low', 'medium', 'high', 'xhigh', 'max'], 'high'),
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'Gemini 3.7 Flash.',
    displayName: 'Gemini 3.7 Flash',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3.7',
    id: 'gemini-3.7-flash',
    releasedAt: RELEASED_AT,
    settings: cursorEffort(['low', 'medium', 'high'], 'high'),
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: false },
    contextWindowTokens: 200_000,
    description: 'Cursor-hosted Grok 4.5.',
    displayName: 'Grok 4.5',
    enabled: false,
    family: 'grok',
    generation: 'grok-4.5',
    id: 'cursor-grok-4.5',
    releasedAt: RELEASED_AT,
    settings: cursorEffort(['low', 'medium', 'high'], 'high'),
    type: 'chat',
  },
];

const withNativeSearch = (model: AIChatModelCard): AIChatModelCard => ({
  ...model,
  abilities: { ...model.abilities, search: true },
  settings: { ...model.settings, searchImpl: 'params' },
});

export default cursorChatModels.map(withNativeSearch);
