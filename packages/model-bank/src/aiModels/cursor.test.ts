import { describe, expect, it } from 'vitest';

import { ModelProvider } from '../const/modelProvider';
import cursorChatModels from './cursor';
import { LOBE_DEFAULT_MODEL_LIST } from './index';

describe('cursor chat models', () => {
  it('enables functionCall on every chat model (prompt-protocol emulation is model-agnostic)', () => {
    expect(cursorChatModels.length).toBeGreaterThan(0);
    for (const model of cursorChatModels) {
      expect(model.type).toBe('chat');
      expect(model.abilities?.functionCall, model.id).toBe(true);
    }
  });

  it('collapses effort variants onto base ids', () => {
    const byId = Object.fromEntries(cursorChatModels.map((model) => [model.id, model]));
    expect(Object.keys(byId)).toEqual([
      'composer-2.5',
      'cursor-grok-4.6',
      'claude-opus-5-thinking',
      'claude-sonnet-5-thinking',
      'gemini-3.7-flash',
      'cursor-grok-4.5',
    ]);
    expect(byId['composer-2.5']?.settings).toEqual({ searchImpl: 'params' });
    expect(byId['cursor-grok-4.6']?.settings).toMatchObject({
      defaultEffortLevel: 'high',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      extendParams: ['cursorReasoningEffort'],
      searchImpl: 'params',
    });
    expect(byId['claude-opus-5-thinking']?.enabled).toBe(true);
    expect(byId['cursor-grok-4.5']?.enabled).toBe(false);
    expect(byId['cursor-grok-4.6']?.displayName).toBe('Grok 4.6');
    expect(byId['cursor-grok-4.5']?.displayName).toBe('Grok 4.5');
  });

  it('does not reuse an id that another provider bank already lists', () => {
    const cursorIds = new Set(
      LOBE_DEFAULT_MODEL_LIST.filter((model) => model.providerId === ModelProvider.Cursor).map(
        (model) => model.id,
      ),
    );

    const collisions = LOBE_DEFAULT_MODEL_LIST.flatMap((model) =>
      model.providerId !== ModelProvider.Cursor && cursorIds.has(model.id)
        ? [`${model.providerId}:${model.id}`]
        : [],
    );

    expect(collisions).toEqual([]);
  });
});
