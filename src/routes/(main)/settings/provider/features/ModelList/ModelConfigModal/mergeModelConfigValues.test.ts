import type { AiProviderModelListItem } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { mergeModelConfigValues } from './mergeModelConfigValues';

/** A collapsed Cursor row as the list shows it: settings the modal does not render. */
const cursorRow: AiProviderModelListItem = {
  abilities: { files: true, functionCall: true, reasoning: true, search: true },
  config: { deploymentName: 'grok-4.7', enabledSearch: true },
  contextWindowTokens: 200_000,
  displayName: 'Grok 4.7',
  enabled: true,
  id: 'grok-4.7',
  settings: {
    defaultEffortLevel: 'high',
    effortLevels: ['low', 'medium', 'high', 'xhigh'],
    extendParams: ['cursorReasoningEffort'],
    searchImpl: 'params',
  },
  type: 'chat',
};

/** What the modal's form hands back: a partial row. */
const save = (values: Partial<AiProviderModelListItem>) =>
  mergeModelConfigValues(cursorRow, values);

describe('mergeModelConfigValues', () => {
  it('keeps the settings keys the form does not render', () => {
    const saved = save({
      displayName: 'Grok 4.7 (renamed)',
      settings: { extendParams: ['cursorReasoningEffort'] },
    });

    expect(saved.displayName).toBe('Grok 4.7 (renamed)');
    expect(saved.settings).toEqual({
      defaultEffortLevel: 'high',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      extendParams: ['cursorReasoningEffort'],
      searchImpl: 'params',
    });
  });

  it('lets the edited keys win, including a cleared extend-param list', () => {
    const saved = save({ settings: { extendParams: [] } });

    expect(saved.settings?.extendParams).toEqual([]);
    expect(saved.settings?.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('keeps unrendered abilities and config keys the same way', () => {
    const saved = save({
      abilities: { functionCall: false, search: true, vision: false },
      config: { deploymentName: 'grok-4.7-new' },
    });

    expect(saved.abilities).toEqual({
      files: true,
      functionCall: false,
      reasoning: true,
      search: true,
      vision: false,
    });
    expect(saved.config).toEqual({ deploymentName: 'grok-4.7-new', enabledSearch: true });
  });

  it('leaves objects the form did not send untouched, so the server keeps its own', () => {
    const saved = save({ displayName: 'Renamed' });

    expect(saved).toEqual({ displayName: 'Renamed' });
  });

  it('sends the form values as they are when there is no stored row', () => {
    const values: Partial<AiProviderModelListItem> = {
      settings: { extendParams: ['reasoningEffort'] },
    };

    expect(mergeModelConfigValues(undefined, values)).toEqual(values);
  });
});
