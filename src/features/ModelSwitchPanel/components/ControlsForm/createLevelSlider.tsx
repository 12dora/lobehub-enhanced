'use client';

import type { LobeAgentChatConfig } from '@lobechat/types';
import type { SliderSingleProps } from 'antd/es/slider';
import type { CSSProperties } from 'react';
import { memo } from 'react';

import { clampToOfferedLevel } from '@/features/ChatInput/ActionBar/ThinkingEffort/resolveEffortLevel';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useUpdateAgentConfig } from '@/features/ChatInput/hooks/useUpdateAgentConfig';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import LevelSlider from './LevelSlider';

export interface LevelSliderConfig<T extends string> {
  /**
   * The key in LobeAgentChatConfig to read/write
   */
  configKey: keyof LobeAgentChatConfig;
  /**
   * Default value when no value is provided
   */
  defaultValue: T;
  /**
   * Ordered array of level values (left to right on slider)
   */
  levels: readonly T[];
  /**
   * Optional custom marks for the slider
   */
  marks?: SliderSingleProps['marks'];
  /**
   * Optional style for the slider container
   */
  style?: CSSProperties;
}

export interface CreatedLevelSliderProps<T extends string> {
  defaultValue?: T;
  /**
   * Per-model subset of the configured levels (weakest → strongest), e.g. a model card's
   * `settings.effortLevels`. When set, only these levels are shown, and a value outside
   * them is displayed as the nearest one (ties → stronger); a value the full level list
   * does not know falls back to the default. Omit it to keep every configured level.
   */
  levels?: readonly T[];
  onChange?: (value: T) => void;
  value?: T;
}

/**
 * The value to show on a narrowed slider: the value itself when offered, else the
 * nearest offered level, else the default (itself pulled onto the offered set).
 */
const resolveNarrowedValue = <T extends string>(
  allLevels: readonly T[],
  offered: readonly T[],
  value: unknown,
  fallback: T,
): T => {
  if (typeof value === 'string') {
    const clamped = clampToOfferedLevel(allLevels, offered, value);
    if (clamped) return clamped;
  }

  return clampToOfferedLevel(allLevels, offered, fallback) ?? offered[0] ?? fallback;
};

/**
 * Factory function to create a level slider component that supports both
 * controlled mode (for previews without store access) and uncontrolled mode
 * (reading/writing to agent store).
 */
export function createLevelSliderComponent<T extends string>(config: LevelSliderConfig<T>) {
  const { levels, configKey, defaultValue, marks, style } = config;

  // Inner pure UI component - no store hooks, safe for preview
  const LevelSliderInner = memo<{
    defaultValue: T;
    levels: readonly T[];
    onChange: (_v: T) => void;
    value: T;
  }>(({ value, onChange, defaultValue: dv, levels: shownLevels }) => (
    <LevelSlider<T>
      defaultValue={dv}
      levels={shownLevels}
      marks={marks}
      style={style}
      value={value}
      onChange={onChange}
    />
  ));

  // Store-connected component - uses agent store hooks
  const LevelSliderWithStore = memo<{ defaultValue: T; offered?: readonly T[] }>(
    ({ defaultValue: dv, offered }) => {
      const agentId = useAgentId();
      const { updateAgentChatConfig } = useUpdateAgentConfig();
      const agentConfig = useAgentStore((s) =>
        chatConfigByIdSelectors.getChatConfigById(agentId)(s),
      );

      const resolveValue = (): T => {
        const rawValue = agentConfig[configKey];
        if (offered) return resolveNarrowedValue(levels, offered, rawValue, dv);
        if (typeof rawValue === 'string' && levels.includes(rawValue as T)) return rawValue as T;

        return dv;
      };

      const handleChange = (newValue: T) => {
        updateAgentChatConfig({ [configKey]: newValue });
      };

      return (
        <LevelSliderInner
          defaultValue={dv}
          levels={offered ?? levels}
          value={resolveValue()}
          onChange={handleChange}
        />
      );
    },
  );

  // Main exported component - chooses between controlled and store mode
  const CreatedLevelSlider = memo<CreatedLevelSliderProps<T>>(
    ({
      value: controlledValue,
      onChange: controlledOnChange,
      defaultValue: propDefaultValue,
      levels: offeredLevels,
    }) => {
      // An empty subset would render a slider with nothing to pick — keep every level.
      const offered = offeredLevels?.length ? offeredLevels : undefined;
      const configuredDefault = propDefaultValue ?? defaultValue;
      // A narrowed slider must never default to a level it does not show.
      const dv = offered
        ? resolveNarrowedValue(levels, offered, configuredDefault, configuredDefault)
        : configuredDefault;
      const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;

      if (isControlled) {
        // Controlled mode: use props only, no store access
        return (
          <LevelSliderInner
            defaultValue={dv}
            levels={offered ?? levels}
            value={
              offered
                ? resolveNarrowedValue(levels, offered, controlledValue, dv)
                : (controlledValue ?? dv)
            }
            onChange={controlledOnChange ?? (() => {})}
          />
        );
      }

      // Uncontrolled mode: use store
      return <LevelSliderWithStore defaultValue={dv} offered={offered} />;
    },
  );

  return CreatedLevelSlider;
}
