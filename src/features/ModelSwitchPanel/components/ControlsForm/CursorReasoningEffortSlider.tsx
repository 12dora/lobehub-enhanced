import { EFFORT_CONTROL_REGISTRY } from '@lobechat/model-runtime';

import { type CreatedLevelSliderProps, createLevelSliderComponent } from './createLevelSlider';

const { configKey, defaultLevel, levels } = EFFORT_CONTROL_REGISTRY.cursorReasoningEffort;
type CursorReasoningEffort =
  (typeof EFFORT_CONTROL_REGISTRY)['cursorReasoningEffort']['levels'][number];

export type CursorReasoningEffortSliderProps = CreatedLevelSliderProps<CursorReasoningEffort>;

// Registry levels are the union over every Cursor model; ControlsForm narrows them to the
// card's own `settings.effortLevels` through the `levels` prop.
const CursorReasoningEffortSlider = createLevelSliderComponent<CursorReasoningEffort>({
  configKey,
  defaultValue: defaultLevel,
  levels,
  style: { minWidth: 200 },
});

export default CursorReasoningEffortSlider;
