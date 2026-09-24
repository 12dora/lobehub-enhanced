import type { LobeAgentChatConfig } from '@lobechat/types';
import type { ExtendParamsType, ModelEffortLevel } from 'model-bank';

/**
 * Superset of every discrete "thinking effort" level any model family exposes.
 * Same union as model-bank `ModelEffortLevel` (settings must not import this package).
 * Individual controls only accept the subset listed in their registry entry.
 */
export type EffortLevel = ModelEffortLevel;

export interface EffortControlDefinition {
  /** The LobeAgentChatConfig field the chosen level is written to. */
  configKey: keyof LobeAgentChatConfig;
  /** Static default when the user never picked a level (model-specific overrides may apply). */
  defaultLevel: EffortLevel;
  /** Ordered levels, weakest → strongest. */
  levels: readonly EffortLevel[];
}

/**
 * Single source of truth for every discrete-level "thinking effort" extend param:
 * which chatConfig field it writes, which levels it offers, and its default.
 *
 * Keys intentionally exclude boolean switches (`enableReasoning`, `preserveThinking`,
 * `enableAdaptiveThinking`), token budgets (`reasoningBudgetToken*`, `thinkingBudget`)
 * and non-effort modes (`reasoningMode`, verbosity/image params).
 *
 * The per-key level lists must stay in sync with the sliders under
 * `src/features/ModelSwitchPanel/components/ControlsForm/` — those sliders import
 * their levels from here.
 *
 * Model-specific default overrides that this static table cannot express:
 * - `gpt5_2ReasoningEffort` defaults to `medium` for `gpt-5.5` (see ControlsForm).
 * - `thinkingLevel*` defaults come from `resolveDefaultThinkingLevelForModel`.
 * - A card's `settings.effortLevels` / `settings.defaultEffortLevel` narrow any control
 *   (`narrowEffortLevels`, `resolveModelDefaultEffort`).
 */
export const EFFORT_CONTROL_REGISTRY = {
  codexMaxReasoningEffort: {
    configKey: 'codexMaxReasoningEffort',
    defaultLevel: 'medium',
    levels: ['low', 'medium', 'high', 'xhigh'],
  },
  deepseekV4ReasoningEffort: {
    configKey: 'deepseekV4ReasoningEffort',
    defaultLevel: 'high',
    levels: ['none', 'high', 'max'],
  },
  effort: {
    configKey: 'effort',
    defaultLevel: 'high',
    levels: ['low', 'medium', 'high', 'max'],
  },
  glm5_2ReasoningEffort: {
    configKey: 'glm5_2ReasoningEffort',
    defaultLevel: 'max',
    levels: ['high', 'max'],
  },
  gpt5ReasoningEffort: {
    configKey: 'gpt5ReasoningEffort',
    defaultLevel: 'medium',
    levels: ['minimal', 'low', 'medium', 'high'],
  },
  gpt5_1ReasoningEffort: {
    configKey: 'gpt5_1ReasoningEffort',
    defaultLevel: 'none',
    levels: ['none', 'low', 'medium', 'high'],
  },
  gpt5_2ProReasoningEffort: {
    configKey: 'gpt5_2ProReasoningEffort',
    defaultLevel: 'medium',
    levels: ['medium', 'high', 'xhigh'],
  },
  gpt5_2ReasoningEffort: {
    configKey: 'gpt5_2ReasoningEffort',
    defaultLevel: 'none',
    levels: ['none', 'low', 'medium', 'high', 'xhigh'],
  },
  gpt5_6ReasoningEffort: {
    configKey: 'gpt5_6ReasoningEffort',
    defaultLevel: 'medium',
    levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  },
  chatgptWebThinkingEffort: {
    configKey: 'chatgptWebThinkingEffort',
    defaultLevel: 'standard',
    levels: ['standard', 'extended', 'max'],
  },
  chatgptWebProThinkingEffort: {
    configKey: 'chatgptWebProThinkingEffort',
    defaultLevel: 'standard',
    levels: ['standard'],
  },
  grok4_20ReasoningEffort: {
    configKey: 'grok4_20ReasoningEffort',
    defaultLevel: 'medium',
    levels: ['low', 'medium', 'high', 'xhigh'],
  },
  grok4_3ReasoningEffort: {
    configKey: 'grok4_3ReasoningEffort',
    defaultLevel: 'low',
    levels: ['none', 'low', 'medium', 'high'],
  },
  grok4_5ReasoningEffort: {
    configKey: 'grok4_5ReasoningEffort',
    defaultLevel: 'high',
    levels: ['low', 'medium', 'high'],
  },
  hy3ReasoningEffort: {
    configKey: 'hy3ReasoningEffort',
    defaultLevel: 'high',
    levels: ['no_think', 'low', 'high'],
  },
  kimiK3ReasoningEffort: {
    configKey: 'kimiK3ReasoningEffort',
    defaultLevel: 'max',
    levels: ['low', 'high', 'max'],
  },
  opus47Effort: {
    configKey: 'opus47Effort',
    defaultLevel: 'high',
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  reasoningEffort: {
    configKey: 'reasoningEffort',
    defaultLevel: 'medium',
    levels: ['low', 'medium', 'high'],
  },
  ring2_6ReasoningEffort: {
    configKey: 'ring2_6ReasoningEffort',
    defaultLevel: 'high',
    levels: ['high', 'xhigh'],
  },
  step3_5ReasoningEffort: {
    configKey: 'step3_5ReasoningEffort',
    defaultLevel: 'low',
    levels: ['low', 'high'],
  },
  thinkingLevel: {
    configKey: 'thinkingLevel',
    defaultLevel: 'high',
    levels: ['minimal', 'low', 'medium', 'high'],
  },
  thinkingLevel2: {
    configKey: 'thinkingLevel2',
    defaultLevel: 'high',
    levels: ['low', 'high'],
  },
  thinkingLevel3: {
    configKey: 'thinkingLevel3',
    defaultLevel: 'high',
    levels: ['low', 'medium', 'high'],
  },
  thinkingLevel4: {
    configKey: 'thinkingLevel4',
    defaultLevel: 'minimal',
    levels: ['minimal', 'high'],
  },
  cursorReasoningEffort: {
    configKey: 'cursorReasoningEffort',
    defaultLevel: 'high',
    levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  // Kept last on purpose: `thinking` (OFF / Auto / ON) is closer to a mode than a
  // strength, so models that also expose a real effort key resolve to that key first.
  thinking: {
    configKey: 'thinking',
    defaultLevel: 'auto',
    levels: ['disabled', 'auto', 'enabled'],
  },
} as const satisfies Partial<Record<ExtendParamsType, EffortControlDefinition>>;

export type EffortControlKey = keyof typeof EFFORT_CONTROL_REGISTRY;

export const EFFORT_CONTROL_KEYS = Object.keys(EFFORT_CONTROL_REGISTRY) as EffortControlKey[];

export const isEffortControlKey = (key: string): key is EffortControlKey =>
  Object.hasOwn(EFFORT_CONTROL_REGISTRY, key);

/**
 * Pick the effort control for a model from its `settings.extendParams`.
 * Registry declaration order is the priority order (real effort keys win over
 * the tri-state `thinking` toggle).
 */
export const findEffortControl = (
  extendParams: readonly string[] | undefined,
): { definition: EffortControlDefinition; key: EffortControlKey } | undefined => {
  if (!extendParams || extendParams.length === 0) return undefined;
  const present = new Set(extendParams);
  for (const key of EFFORT_CONTROL_KEYS) {
    if (present.has(key)) return { definition: EFFORT_CONTROL_REGISTRY[key], key };
  }
  return undefined;
};

/**
 * Levels a card actually offers. `settings.effortLevels` is intersected with the
 * control and returned weakest → strongest. An empty intersection, or no narrowing,
 * keeps the control's full list.
 */
export const narrowEffortLevels = (
  control: EffortControlDefinition,
  settings?: { effortLevels?: readonly string[] | null } | null,
): readonly EffortLevel[] => {
  const requested = settings?.effortLevels;
  if (!requested || requested.length === 0) return control.levels;

  const narrowed = control.levels.filter((level) => requested.includes(level));
  return narrowed.length > 0 ? narrowed : control.levels;
};

/**
 * Nearest level in `offered`, ranked by `order` (weakest → strongest). A tie goes
 * to the stronger level. `undefined` when `level` is not in `order` at all.
 */
const nearestEffortLevel = (
  order: readonly EffortLevel[],
  offered: readonly EffortLevel[],
  level: string,
): EffortLevel | undefined => {
  if ((offered as readonly string[]).includes(level)) return level as EffortLevel;

  const rankOf = (value: string) => (order as readonly string[]).indexOf(value);
  const rank = rankOf(level);
  if (rank === -1) return undefined;

  let nearest: EffortLevel | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestRank = -1;

  for (const candidate of offered) {
    const candidateRank = rankOf(candidate);
    if (candidateRank === -1) continue;

    const distance = Math.abs(candidateRank - rank);
    // Equal distance: the stronger level wins, same as the chat pill.
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && candidateRank > nearestRank)
    ) {
      nearest = candidate;
      nearestDistance = distance;
      nearestRank = candidateRank;
    }
  }

  return nearest;
};

/**
 * Clamp a persisted level onto what the control actually offers.
 *
 * `levels`, when passed, is the narrowed set (`narrowEffortLevels`). A stored
 * level in that set is kept. A known level outside it maps to the nearest
 * offered level, and a tie goes to the stronger one. A level the control does
 * not know falls back to the control default, then that same nearest rule.
 * Omitting `levels` keeps the previous behaviour (exact match, else the control
 * default, else the middle level).
 */
export const clampEffortLevel = (
  definition: EffortControlDefinition,
  level: string | undefined,
  levels?: readonly EffortLevel[],
): EffortLevel => {
  const narrowed = levels && levels.length > 0 ? levels : undefined;
  const offered = narrowed ?? definition.levels;
  if (level && (offered as readonly string[]).includes(level)) return level as EffortLevel;

  if (!narrowed) {
    if ((definition.levels as readonly string[]).includes(definition.defaultLevel)) {
      return definition.defaultLevel;
    }
    return definition.levels[Math.floor(definition.levels.length / 2)] ?? definition.defaultLevel;
  }

  const ordered = definition.levels.filter((candidate) =>
    (narrowed as readonly string[]).includes(candidate),
  );
  if (level) {
    const nearest = nearestEffortLevel(definition.levels, ordered, level);
    if (nearest) return nearest;
  }

  return (
    nearestEffortLevel(definition.levels, ordered, definition.defaultLevel) ??
    ordered[0] ??
    definition.defaultLevel
  );
};

/**
 * `settings.defaultEffortLevel` when it is one of the narrowed levels; otherwise
 * the control default clamped onto that set (nearest, ties → stronger).
 */
export const resolveModelDefaultEffort = (
  control: EffortControlDefinition,
  settings?: {
    defaultEffortLevel?: string | null;
    effortLevels?: readonly string[] | null;
  } | null,
): EffortLevel => {
  const offered = narrowEffortLevels(control, settings);
  const pinned = settings?.defaultEffortLevel;
  if (pinned && (offered as readonly string[]).includes(pinned)) return pinned as EffortLevel;

  // No real subset: keep the control default, including when it is the full list.
  if (offered.length === control.levels.length) return control.defaultLevel;

  return clampEffortLevel(control, control.defaultLevel, offered);
};

/** Every `LobeAgentChatConfig` field the registry can write a level into. */
export type EffortConfigKey = (typeof EFFORT_CONTROL_REGISTRY)[EffortControlKey]['configKey'];

export const EFFORT_CONFIG_KEYS = EFFORT_CONTROL_KEYS.map(
  (key) => EFFORT_CONTROL_REGISTRY[key].configKey,
) as EffortConfigKey[];

/**
 * Build the patch that makes a target agent's thinking effort match `source` exactly,
 * for the merge-based agent-config update path.
 *
 * Both layers of that path deep-merge and **cannot drop keys**: the optimistic store
 * dispatch and `AgentModel.updateConfig` both run `merge()` (es-toolkit/compat), which
 * *skips* `undefined` source values. So copying only the keys the source carries would
 * leave a previously selected level on the target — e.g. a long-lived Agent Builder row
 * keeping last week's `high` while the fresh inbox it is being reseeded from shows the
 * default. Every registry key the target holds but the source does not is therefore
 * emitted as an explicit `null`, the same "stored clear" `EffortSelect` already accepts:
 * every reader (`applyModelExtendParams`, `resolveCurrentEffortLevel`, the ControlsForm
 * level sliders) requires `typeof value === 'string'` or truthiness, so `null` reads
 * exactly like "never set".
 *
 * Only registry effort keys appear in the result — the target's search / history /
 * memory / token-budget config is preserved by the merge.
 *
 * @param source chatConfig to inherit the level from (e.g. the inbox agent)
 * @param target the chatConfig being overwritten (e.g. the builder agent), used to keep
 *   the patch minimal: only keys that are actually set there need clearing
 */
export const buildChatConfigEffortReplacement = (
  source: Partial<LobeAgentChatConfig> | undefined | null,
  target?: Partial<LobeAgentChatConfig> | null,
): Partial<LobeAgentChatConfig> => {
  const from = (source ?? {}) as Record<string, unknown>;
  const onto = (target ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const configKey of EFFORT_CONFIG_KEYS) {
    const value = from[configKey];

    if (value !== undefined && value !== null) {
      patch[configKey] = value;
      continue;
    }

    // Nothing to inherit: clear the key only when the target actually carries one.
    if (onto[configKey] !== undefined && onto[configKey] !== null) patch[configKey] = null;
  }

  // `null` is not in the strict level unions, but it is the only value this update path
  // can use to clear a key — see the doc comment above.
  return patch as Partial<LobeAgentChatConfig>;
};
