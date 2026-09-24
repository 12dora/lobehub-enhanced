import type {
  EffortControlDefinition,
  EffortControlKey,
  EffortLevel,
} from '@lobechat/model-runtime';
import { narrowEffortLevels, resolveDefaultThinkingLevelForModel } from '@lobechat/model-runtime';
import type { LobeAgentChatConfig } from '@lobechat/types';
import type { AiModelSettings } from 'model-bank';

/**
 * Per-model narrowing of an effort control, read from the enabled model card
 * (`AiModelSettings.effortLevels` / `AiModelSettings.defaultEffortLevel`). A collapsed
 * Cursor card, for example, offers only the levels its upstream variants exist for.
 */
export type ModelEffortSettings = Pick<AiModelSettings, 'defaultEffortLevel' | 'effortLevels'>;

export interface EffortControlContext {
  definition: EffortControlDefinition;
  key: EffortControlKey;
  model?: string;
  /** The model card's narrowing; absent → the control's full registry levels and default. */
  modelSettings?: ModelEffortSettings;
}

const isOffered = (levels: readonly string[], level: string) => levels.includes(level);

/** Whether a model card narrows its effort control at all (levels subset or pinned default). */
export const hasModelEffortNarrowing = (settings: ModelEffortSettings | undefined): boolean =>
  !!settings?.effortLevels?.length || !!settings?.defaultEffortLevel;

/**
 * The levels this model actually offers, weakest → strongest in registry order:
 * `settings.effortLevels` intersected with the control's levels, or every level of the
 * control when the card does not narrow it (or the narrowing matches nothing).
 */
export const resolveOfferedEffortLevels = (
  definition: EffortControlDefinition,
  settings?: ModelEffortSettings,
): readonly EffortLevel[] => {
  if (!settings?.effortLevels?.length) return definition.levels;

  const narrowed: readonly string[] = narrowEffortLevels(definition, settings);
  // Re-derive from the registry list so the order is always weakest → strongest.
  const offered = definition.levels.filter((level) => narrowed.includes(level));

  return offered.length > 0 ? offered : definition.levels;
};

/**
 * Map `level` onto the nearest level in `offered`, ranked by `order` (the control's full
 * registry order); a tie goes to the stronger level. Returns `undefined` when `level` is
 * not part of `order` at all (e.g. a value persisted for another model family), so the
 * caller can fall back to a default instead of guessing.
 */
export const clampToOfferedLevel = <T extends string>(
  order: readonly string[],
  offered: readonly T[],
  level: string,
): T | undefined => {
  if (isOffered(offered, level)) return level as T;

  const rank = order.indexOf(level);
  if (rank === -1) return undefined;

  let nearest: T | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of offered) {
    const candidateRank = order.indexOf(candidate);
    if (candidateRank === -1) continue;

    const distance = Math.abs(candidateRank - rank);
    // `offered` runs weakest → strongest, so `<=` lets the stronger level win a tie.
    if (distance <= nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
};

/**
 * The level a control shows before the user has ever picked one.
 *
 * 1. The model card's `settings.defaultEffortLevel` when it is one of the offered levels.
 * 2. Otherwise `EffortControlDefinition.defaultLevel`, with the two model-specific
 *    overrides the registry table cannot express (mirroring `ControlsForm.tsx` so the
 *    quick selector and the slider never disagree):
 *    - `thinkingLevel` follows `resolveDefaultThinkingLevelForModel` (Gemini flash
 *      variants default lower). Only `thinkingLevel` is affected — the runtime's
 *      `thinkingLevel2/3/4` defaults are already what the registry stores, and
 *      `ControlsForm` likewise passes the resolved value to `ThinkingLevelSlider` only.
 *    - `gpt5_2ReasoningEffort` defaults to `medium` on `gpt-5.5`.
 *    That default is then clamped onto the model's offered levels (nearest, ties →
 *    stronger), so a narrowed card never shows a level it cannot run.
 */
export const resolveDefaultEffortLevel = ({
  definition,
  key,
  model,
  modelSettings,
}: EffortControlContext): EffortLevel => {
  const offered = resolveOfferedEffortLevels(definition, modelSettings);
  const pinned = offered.find((level) => level === modelSettings?.defaultEffortLevel);

  if (pinned) return pinned;

  let fallback: EffortLevel = definition.defaultLevel;

  if (key === 'thinkingLevel') {
    const modelDefault = resolveDefaultThinkingLevelForModel(model);
    if (modelDefault && isOffered(definition.levels, modelDefault)) fallback = modelDefault;
  } else if (
    key === 'gpt5_2ReasoningEffort' &&
    model === 'gpt-5.5' &&
    isOffered(definition.levels, 'medium')
  ) {
    fallback = 'medium';
  }

  return clampToOfferedLevel(definition.levels, offered, fallback) ?? offered[0] ?? fallback;
};

/**
 * The level to render as selected (and the level a service model is projected onto):
 *
 * - a persisted level the model offers → as is;
 * - a persisted level of this control that the model's narrowed set lacks (e.g. `max` on
 *   a card without `max`) → the nearest offered level, ties → stronger;
 * - anything else (unset, or a level the control does not know) → the default above.
 */
export const resolveCurrentEffortLevel = ({
  config,
  ...context
}: EffortControlContext & { config?: LobeAgentChatConfig }): EffortLevel => {
  const { definition, modelSettings } = context;
  const stored = config?.[definition.configKey];

  if (typeof stored === 'string') {
    const offered = resolveOfferedEffortLevels(definition, modelSettings);
    const clamped = clampToOfferedLevel(definition.levels, offered, stored);
    if (clamped) return clamped;
  }

  return resolveDefaultEffortLevel(context);
};
