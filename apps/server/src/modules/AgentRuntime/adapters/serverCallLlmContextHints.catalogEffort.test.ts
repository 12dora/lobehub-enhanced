/**
 * @vitest-environment node
 */
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveServerCallLlmContextHints } from './serverCallLlmContextHints';
import { buildServerChatPayload } from './serverCallLlmPayload';

const { Adapter, loadModels, resolveCatalog } = vi.hoisted(() => {
  const resolveCatalog = vi.fn();
  const Adapter = vi.fn(function MockAiCatalogRuntimeAdapter() {
    return { resolve: resolveCatalog };
  });
  return { Adapter, loadModels: vi.fn(), resolveCatalog };
});

vi.mock('@/business/client/model-bank/loadModels', () => ({ loadModels }));

vi.mock('@/server/enterprise/services/aiCatalog/runtimeAdapter', () => ({
  AiCatalogRuntimeAdapter: Adapter,
}));

const serverDB = { kind: 'test-db' };

const cursorEffortCard = (
  id: string,
  providerId: string,
  levels: string[],
  defaultEffortLevel = 'high',
) => ({
  id,
  providerId,
  settings: {
    defaultEffortLevel,
    effortLevels: levels,
    extendParams: ['cursorReasoningEffort'],
  },
});

const publishedState = (models: object[]) => ({
  enabledAiModels: models,
});

const resolveHints = async (model: string, provider: string, effort?: string) => {
  const hints = await resolveServerCallLlmContextHints({
    ctx: {
      agentConfig: { chatConfig: effort ? { cursorReasoningEffort: effort } : {} },
      serverDB,
    } as any,
    llmPayload: { messages: [] } as any,
    model,
    provider,
  });

  const payload = buildServerChatPayload({
    messages: [],
    model,
    resolvedExtendParams: (hints.resolvedExtendParams ?? {}) as Partial<ChatStreamPayload>,
    stream: true,
    tools: undefined,
  });

  return { hints, payload };
};

describe('resolveServerCallLlmContextHints — published catalog effort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadModels.mockResolvedValue([]);
    resolveCatalog.mockResolvedValue(publishedState([]));
  });

  it.each(['grok-4.7', 'grok-4.7-fast', 'claude-opus-5-5'])(
    'puts the chosen cursor effort on payload.reasoning_effort for %s',
    async (model) => {
      resolveCatalog.mockResolvedValue(
        publishedState([
          cursorEffortCard(model, 'cursor', ['low', 'medium', 'high', 'xhigh'], 'high'),
        ]),
      );

      const { payload } = await resolveHints(model, 'cursor', 'low');

      expect(payload.reasoning_effort).toBe('low');
      expect(Adapter).toHaveBeenCalledWith(serverDB);
    },
  );

  it('reads a custom cursor provider from the published card, not the static bank', async () => {
    loadModels.mockResolvedValue([
      cursorEffortCard('grok-4.7', 'cursor', ['low', 'medium', 'high'], 'high'),
    ]);
    resolveCatalog.mockResolvedValue(
      publishedState([
        cursorEffortCard('grok-4.7', 'acme-cursor', ['none', 'low', 'medium', 'high'], 'medium'),
      ]),
    );

    const { payload } = await resolveHints('grok-4.7', 'acme-cursor', 'none');

    expect(payload.reasoning_effort).toBe('none');
  });

  it('matches a published card by deploymentName', async () => {
    resolveCatalog.mockResolvedValue(
      publishedState([
        {
          ...cursorEffortCard('corp-grok', 'cursor', ['low', 'high'], 'high'),
          config: { deploymentName: 'grok-4.7' },
        },
      ]),
    );

    const { payload } = await resolveHints('grok-4.7', 'cursor', 'low');

    expect(payload.reasoning_effort).toBe('low');
  });

  it('clamps a stored level onto the published card, nearest with ties toward stronger', async () => {
    resolveCatalog.mockResolvedValue(
      publishedState([cursorEffortCard('grok-4.7', 'cursor', ['low', 'medium', 'high'], 'high')]),
    );

    const tooStrong = await resolveHints('grok-4.7', 'cursor', 'max');
    expect(tooStrong.payload.reasoning_effort).toBe('high');

    resolveCatalog.mockResolvedValue(
      publishedState([cursorEffortCard('grok-4.7', 'cursor', ['low', 'high'], 'high')]),
    );
    const tie = await resolveHints('grok-4.7', 'cursor', 'medium');
    expect(tie.payload.reasoning_effort).toBe('high');
  });

  it('falls back to the static bank when the published catalog has no card', async () => {
    loadModels.mockResolvedValue([
      cursorEffortCard('cursor-grok-4.6', 'cursor', ['low', 'medium', 'high', 'xhigh'], 'high'),
    ]);

    const { payload } = await resolveHints('cursor-grok-4.6', 'cursor', 'low');

    expect(payload.reasoning_effort).toBe('low');
  });

  it('falls back to the static bank when the catalog projection throws', async () => {
    resolveCatalog.mockRejectedValue(new Error('catalog unavailable'));
    loadModels.mockResolvedValue([
      cursorEffortCard('cursor-grok-4.6', 'cursor', ['low', 'medium', 'high'], 'high'),
    ]);

    const { payload } = await resolveHints('cursor-grok-4.6', 'cursor', 'low');

    expect(payload.reasoning_effort).toBe('low');
  });

  it('does not copy bank extend params onto a published card that has none', async () => {
    loadModels.mockResolvedValue([
      cursorEffortCard('grok-4.7', 'cursor', ['low', 'medium', 'high'], 'high'),
    ]);
    resolveCatalog.mockResolvedValue(
      publishedState([{ id: 'grok-4.7', providerId: 'cursor', settings: {} }]),
    );

    const { payload } = await resolveHints('grok-4.7', 'cursor', 'low');

    expect(payload.reasoning_effort).toBeUndefined();
  });

  it('skips the catalog when the runtime has no database and uses the bank', async () => {
    loadModels.mockResolvedValue([
      cursorEffortCard('cursor-grok-4.6', 'cursor', ['low', 'high'], 'high'),
    ]);

    const hints = await resolveServerCallLlmContextHints({
      ctx: {
        agentConfig: { chatConfig: { cursorReasoningEffort: 'low' } },
      } as any,
      llmPayload: { messages: [] } as any,
      model: 'cursor-grok-4.6',
      provider: 'cursor',
    });

    expect(Adapter).not.toHaveBeenCalled();
    expect(hints.resolvedExtendParams?.reasoning_effort).toBe('low');
  });
});
