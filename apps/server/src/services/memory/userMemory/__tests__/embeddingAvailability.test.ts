import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMemoryEmbeddingAvailability, vaultHasUsableCredential } from '../embeddingAvailability';

const mocks = vi.hoisted(() => ({
  getAiProviderById: vi.fn(),
  getLLMConfig: vi.fn(() => ({}) as Record<string, unknown>),
  getPlatformAiTakeoverFlags: vi.fn(async () => ({ models: false, providers: false })),
  getUserSettings: vi.fn(),
  isSettingsPolicyEnabled: vi.fn(async () => false),
  loadEffectiveUserSettings: vi.fn(),
  listPlatformCatalogModels: vi.fn(async () => null as unknown[] | null),
  listPlatformPublishedModels: vi.fn(async () => null as unknown[] | null),
  resolvePlatformAiExecutionConfig: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: mocks.getUserSettings,
  })),
}));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(() => ({
    getAiProviderById: mocks.getAiProviderById,
  })),
}));

vi.mock('@/envs/llm', () => ({
  getLLMConfig: mocks.getLLMConfig,
}));

vi.mock('@/server/enterprise/services/settings/runtimeSettingsAdapter', () => ({
  isSettingsPolicyEnabled: mocks.isSettingsPolicyEnabled,
  loadEffectiveUserSettings: mocks.loadEffectiveUserSettings,
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));

vi.mock('@/server/modules/ModelRuntime/platformAiRuntimeBridge', () => ({
  getPlatformAiTakeoverFlags: mocks.getPlatformAiTakeoverFlags,
  listPlatformCatalogModels: mocks.listPlatformCatalogModels,
  listPlatformPublishedModels: mocks.listPlatformPublishedModels,
  resolvePlatformAiExecutionConfig: mocks.resolvePlatformAiExecutionConfig,
}));

const db = {} as never;

describe('getMemoryEmbeddingAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL;
    delete process.env.MEMORY_USER_MEMORY_EMBEDDING_PROVIDER;
    delete process.env.MEMORY_USER_MEMORY_EMBEDDING_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SILICONCLOUD_API_KEY;
    mocks.isSettingsPolicyEnabled.mockResolvedValue(false);
    mocks.getUserSettings.mockResolvedValue({ systemAgent: {} });
    mocks.getPlatformAiTakeoverFlags.mockResolvedValue({ models: false, providers: false });
    mocks.listPlatformCatalogModels.mockResolvedValue(null);
    mocks.listPlatformPublishedModels.mockResolvedValue(null);
    mocks.getAiProviderById.mockResolvedValue(undefined);
    mocks.getLLMConfig.mockReturnValue({});
  });

  it('is not configured when only the built-in embedding default would apply', async () => {
    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('not_configured');
    expect(mocks.resolvePlatformAiExecutionConfig).not.toHaveBeenCalled();
  });

  it('uses a platform-published embedding model and ignores the built-in default', async () => {
    mocks.isSettingsPolicyEnabled.mockResolvedValue(true);
    mocks.getUserSettings.mockResolvedValue({ systemAgent: {} });
    mocks.loadEffectiveUserSettings.mockResolvedValue({
      effective: {
        pathMeta: {
          'systemAgent.userMemoryEmbedding.model': { source: 'platform' },
          'systemAgent.userMemoryEmbedding.provider': { source: 'platform' },
        },
      },
      settings: {
        systemAgent: {
          userMemoryEmbedding: {
            model: 'Qwen/Qwen3-Embedding-4B',
            provider: 'siliconcloud',
          },
        },
      },
    });
    mocks.getPlatformAiTakeoverFlags.mockResolvedValue({ models: true, providers: true });
    mocks.listPlatformPublishedModels.mockResolvedValue([{ id: 'Qwen/Qwen3-Embedding-4B' }]);
    mocks.resolvePlatformAiExecutionConfig.mockResolvedValue({
      allowedModels: [{ modelKey: 'Qwen/Qwen3-Embedding-4B', type: 'embedding' }],
      keyVaults: { apiKey: 'sf-key' },
      runtimeProvider: 'siliconcloud',
    });

    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result).toMatchObject({
      available: true,
      model: 'Qwen/Qwen3-Embedding-4B',
      provider: 'siliconcloud',
    });
  });

  it('is unavailable when the managed provider publishes no embedding model', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: {
        userMemoryEmbedding: {
          model: 'Qwen/Qwen3-Embedding-4B',
          provider: 'siliconcloud',
        },
      },
    });
    mocks.getPlatformAiTakeoverFlags.mockResolvedValue({ models: true, providers: true });
    mocks.listPlatformPublishedModels.mockResolvedValue([]);
    mocks.resolvePlatformAiExecutionConfig.mockResolvedValue({
      allowedModels: [],
      keyVaults: { apiKey: 'sf-key' },
      runtimeProvider: 'siliconcloud',
    });

    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result).toMatchObject({
      available: false,
      model: 'Qwen/Qwen3-Embedding-4B',
      provider: 'siliconcloud',
      reason: 'model_not_enabled',
    });
    expect(mocks.getAiProviderById).not.toHaveBeenCalled();
  });

  it('reports missing credentials when the enabled platform model has no key', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: {
        userMemoryEmbedding: {
          model: 'Qwen/Qwen3-Embedding-4B',
          provider: 'siliconcloud',
        },
      },
    });
    mocks.getPlatformAiTakeoverFlags.mockResolvedValue({ models: true, providers: true });
    mocks.listPlatformPublishedModels.mockResolvedValue([]);
    mocks.resolvePlatformAiExecutionConfig.mockResolvedValue({
      allowedModels: [{ modelKey: 'Qwen/Qwen3-Embedding-4B', type: 'embedding' }],
      keyVaults: {},
      runtimeProvider: 'siliconcloud',
    });

    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result).toMatchObject({
      available: false,
      provider: 'siliconcloud',
      reason: 'missing_credentials',
    });
  });

  it('rejects a published model that is not an embedding', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: {
        userMemoryEmbedding: {
          model: 'Qwen/Qwen3-Embedding-4B',
          provider: 'siliconcloud',
        },
      },
    });
    mocks.getPlatformAiTakeoverFlags.mockResolvedValue({ models: true, providers: true });
    mocks.listPlatformPublishedModels.mockResolvedValue([{ id: 'Qwen/Qwen3-Embedding-4B' }]);
    mocks.resolvePlatformAiExecutionConfig.mockResolvedValue({
      allowedModels: [{ modelKey: 'Qwen/Qwen3-Embedding-4B', type: 'chat' }],
      keyVaults: { apiKey: 'sf-key' },
      runtimeProvider: 'siliconcloud',
    });

    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result.reason).toBe('model_not_enabled');
    expect(result.available).toBe(false);
  });

  it('requires the model in the published catalog when only models are hosted', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: {
        userMemoryEmbedding: {
          model: 'Qwen/Qwen3-Embedding-4B',
          provider: 'siliconcloud',
        },
      },
    });
    mocks.getPlatformAiTakeoverFlags.mockResolvedValue({ models: true, providers: false });
    mocks.listPlatformCatalogModels.mockResolvedValue([]);
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: { apiKey: 'user-key' } });

    const blocked = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });
    expect(blocked).toMatchObject({ available: false, reason: 'model_not_enabled' });

    mocks.listPlatformCatalogModels.mockResolvedValue([
      { enabled: false, id: 'Qwen/Qwen3-Embedding-4B', type: 'embedding' },
    ]);
    const disabled = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });
    expect(disabled.reason).toBe('model_not_enabled');

    mocks.listPlatformCatalogModels.mockResolvedValue([
      { enabled: true, id: 'Qwen/Qwen3-Embedding-4B', type: 'embedding' },
    ]);
    const enabled = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });
    expect(enabled).toMatchObject({
      available: true,
      model: 'Qwen/Qwen3-Embedding-4B',
      provider: 'siliconcloud',
    });
  });

  it('keeps the built-in embedding when that provider env key is what the runtime uses', async () => {
    mocks.isSettingsPolicyEnabled.mockResolvedValue(true);
    mocks.getUserSettings.mockResolvedValue({ systemAgent: {} });
    mocks.loadEffectiveUserSettings.mockResolvedValue({
      effective: {
        pathMeta: {
          'systemAgent.userMemoryEmbedding.model': { source: 'builtin' },
          'systemAgent.userMemoryEmbedding.provider': { source: 'builtin' },
        },
      },
      settings: {
        systemAgent: {
          userMemoryEmbedding: {
            model: 'text-embedding-3-small',
            provider: 'openai',
          },
        },
      },
    });
    mocks.getLLMConfig.mockReturnValue({ OPENAI_API_KEY: 'sk-openai' });

    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result).toMatchObject({
      available: true,
      model: 'text-embedding-3-small',
      provider: 'openai',
    });
  });

  it('does not treat a built-in selection as available without a runtime credential', async () => {
    mocks.isSettingsPolicyEnabled.mockResolvedValue(true);
    mocks.getUserSettings.mockResolvedValue({ systemAgent: {} });
    mocks.loadEffectiveUserSettings.mockResolvedValue({
      effective: {
        pathMeta: {
          'systemAgent.userMemoryEmbedding.model': { source: 'builtin' },
          'systemAgent.userMemoryEmbedding.provider': { source: 'builtin' },
        },
      },
      settings: {
        systemAgent: {
          userMemoryEmbedding: {
            model: 'text-embedding-3-small',
            provider: 'openai',
          },
        },
      },
    });

    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result).toMatchObject({
      available: false,
      provider: 'openai',
      reason: 'missing_credentials',
    });
  });

  it('does not treat MEMORY_USER_MEMORY_EMBEDDING_API_KEY as a runtime credential', async () => {
    process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-4B';
    process.env.MEMORY_USER_MEMORY_EMBEDDING_PROVIDER = 'siliconcloud';
    process.env.MEMORY_USER_MEMORY_EMBEDDING_API_KEY = 'sf-only';

    const blocked = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });
    expect(blocked).toMatchObject({
      available: false,
      provider: 'siliconcloud',
      reason: 'missing_credentials',
    });

    mocks.getLLMConfig.mockReturnValue({ SILICONCLOUD_API_KEY: 'sf-runtime' });
    const ready = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });
    expect(ready).toMatchObject({
      available: true,
      model: 'Qwen/Qwen3-Embedding-4B',
      provider: 'siliconcloud',
    });
  });

  it('does not mark lobehub available unless its runtime exposes an embedding route', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: {
        userMemoryEmbedding: { model: 'gpt-5', provider: 'lobehub' },
      },
    });
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: { apiKey: 'lh-key' } });

    const result = await getMemoryEmbeddingAvailability({ db, userId: 'user-1' });

    expect(result).toMatchObject({
      available: false,
      provider: 'lobehub',
      reason: 'model_not_enabled',
    });
  });
});

describe('vaultHasUsableCredential', () => {
  it('accepts an API key and rejects an empty vault', () => {
    expect(vaultHasUsableCredential('siliconcloud', { apiKey: 'sf-key' })).toBe(true);
    expect(vaultHasUsableCredential('siliconcloud', {})).toBe(false);
  });
});
