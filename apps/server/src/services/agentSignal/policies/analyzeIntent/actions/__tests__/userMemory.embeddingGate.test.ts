// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runMemoryActionAgent } from '../userMemory';

const { mockCreateServerAgentToolsEngine, mockGetMemoryEmbeddingAvailability } = vi.hoisted(() => ({
  mockCreateServerAgentToolsEngine: vi.fn(),
  mockGetMemoryEmbeddingAvailability: vi.fn(),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
}));

vi.mock('@/server/services/memory/userMemory/embeddingAvailability', () => ({
  getMemoryEmbeddingAvailability: mockGetMemoryEmbeddingAvailability,
}));

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn(async () => []),
}));

const agentService = {
  getAgentConfig: vi.fn(async () => ({
    model: 'gpt-4',
    plugins: [],
    provider: 'openai',
  })),
};

const pluginModel = {
  query: vi.fn(async () => []),
};

describe('runMemoryActionAgent memoryEmbeddingAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServerAgentToolsEngine.mockReturnValue({
      generateToolsDetailed: () => ({ enabledToolIds: [], tools: [] }),
      getEnabledPluginManifests: () => new Map(),
    });
  });

  it('passes embedding availability into the memory tools engine', async () => {
    mockGetMemoryEmbeddingAvailability.mockResolvedValue({
      available: false,
      reason: 'missing_credentials',
    });

    const result = await runMemoryActionAgent(
      { agentId: 'agent-1', message: 'Remember this preference.' },
      {
        agentService: agentService as never,
        db: {} as never,
        pluginModel: pluginModel as never,
        userId: 'user-1',
        workspaceId: 'ws-1',
      },
    );

    expect(mockGetMemoryEmbeddingAvailability).toHaveBeenCalledWith({
      db: {},
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        globalMemoryEnabled: true,
        memoryEmbeddingAvailable: false,
      }),
    );
    expect(result.status).toBe('failed');
  });

  it('passes available=true when embedding credentials resolve', async () => {
    mockGetMemoryEmbeddingAvailability.mockResolvedValue({ available: true });

    await runMemoryActionAgent(
      { agentId: 'agent-1', message: 'Remember this preference.' },
      {
        agentService: agentService as never,
        db: {} as never,
        pluginModel: pluginModel as never,
        userId: 'user-1',
      },
    );

    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ memoryEmbeddingAvailable: true }),
    );
  });

  it('passes available=false when the availability check throws', async () => {
    mockGetMemoryEmbeddingAvailability.mockRejectedValue(new Error('db down'));

    await runMemoryActionAgent(
      { agentId: 'agent-1', message: 'Remember this preference.' },
      {
        agentService: agentService as never,
        db: {} as never,
        pluginModel: pluginModel as never,
        userId: 'user-1',
      },
    );

    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ memoryEmbeddingAvailable: false }),
    );
  });
});
