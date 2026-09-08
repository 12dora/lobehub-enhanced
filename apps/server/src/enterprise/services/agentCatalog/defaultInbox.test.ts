import { DEFAULT_AGENT_CONFIG, DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import {
  PLATFORM_AGENT_DEFAULT_INBOX_SYSTEM_KEY,
  type PlatformAgentVersionConfig,
} from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { DISABLED_ENTERPRISE_FEATURE_FLAGS } from '@/const/platform/featureFlags';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentConfigWithId } from '@/server/services/agent';

import { PlatformDefaultInboxService } from './defaultInbox';
import type {
  PlatformAgentOperationHandle,
  PlatformAgentOperationSnapshot,
} from './effectiveResolver';

const flagsOn = { ...DISABLED_ENTERPRISE_FEATURE_FLAGS, ENABLE_PLATFORM_MANAGED_AGENTS: true };
const flagsOff = { ...DISABLED_ENTERPRISE_FEATURE_FLAGS, ENABLE_PLATFORM_MANAGED_AGENTS: false };
const db = {} as LobeChatDatabase;

const dependencySnapshot = {
  connectors: [
    {
      allowedToolKeys: ['search.run'],
      connectorId: 'connector-1',
      connectorKey: 'managed-search',
      publishedChecksum: 'c'.repeat(64),
      publishedRevision: 2,
    },
  ],
  model: {
    modelKey: 'managed-model',
    providerChecksum: 'm'.repeat(64),
    providerKey: 'managed-provider',
    providerRevision: 3,
  },
  skills: [{ checksum: 's'.repeat(64), skillKey: 'managed-skill', version: '2.0.0' }],
};

const snapshot = (versionId: string, displayName = `Inbox ${versionId}`) =>
  ({
    checksum: versionId === 'v2' ? '2'.repeat(64) : '1'.repeat(64),
    config: {
      avatar: 'managed-avatar',
      backgroundColor: '#123456',
      description: 'Managed description',
      displayName,
      modelParameters: { temperature: 0.2 } as PlatformAgentVersionConfig['modelParameters'],
      openingMessage: 'Managed welcome',
      openingQuestions: ['Managed question'],
      systemRole: `Managed prompt ${versionId}`,
      tags: ['managed'],
      thinkingEffort: null as PlatformAgentVersionConfig['thinkingEffort'],
    },
    platformAgentId: 'platform-default-inbox',
    versionId,
  }) satisfies PlatformAgentOperationSnapshot;

const handle = (value: PlatformAgentOperationSnapshot): PlatformAgentOperationHandle => ({
  distribution: 'mandatory',
  getSnapshot: () => value,
  platformAgentId: value.platformAgentId,
});

const base = (): AgentConfigWithId & {
  description?: string | null;
  slug: string;
  tags?: string[];
} => ({
  ...DEFAULT_AGENT_CONFIG,
  avatar: 'legacy-avatar',
  description: 'Legacy description',
  id: 'builtin-inbox-id',
  model: 'legacy-model',
  plugins: ['legacy-tool'],
  provider: 'legacy-provider',
  slug: INBOX_SESSION_ID,
  systemRole: 'Legacy prompt',
  tags: ['legacy'],
  title: 'Legacy inbox',
});

const resolvedConfig = (value: PlatformAgentOperationSnapshot) => ({
  ...base(),
  id: 'builtin-inbox-id',
  model: dependencySnapshot.model.modelKey,
  params: { temperature: value.config.modelParameters.temperature },
  platform: {
    managed: true as const,
    source: 'platform' as const,
  },
  plugins: [],
  provider: dependencySnapshot.model.providerKey,
  slug: null,
  systemRole: value.config.systemRole,
  title: value.config.displayName,
});

describe('PlatformDefaultInboxService', () => {
  it('returns the exact legacy object with zero platform IO while the flag is off', async () => {
    const beginSystemOperation = vi.fn();
    const resolveForExistingAgent = vi.fn();
    const legacy = base();
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOff,
      materializationService: { resolveForExistingAgent },
      resolver: { beginSystemOperation },
    });

    await expect(service.getEffectiveBuiltinConfig(legacy)).resolves.toBe(legacy);
    expect(beginSystemOperation).not.toHaveBeenCalled();
    expect(resolveForExistingAgent).not.toHaveBeenCalled();
  });

  it('falls back only for a genuinely absent published default', async () => {
    const legacy = base();
    const beginSystemOperation = vi.fn(async () => null);
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      resolver: { beginSystemOperation },
    });

    await expect(service.getEffectiveBuiltinConfig(legacy)).resolves.toBe(legacy);
    expect(beginSystemOperation).toHaveBeenCalledWith(
      'user',
      PLATFORM_AGENT_DEFAULT_INBOX_SYSTEM_KEY,
    );
  });

  it('overlays every managed field while preserving the builtin id/slug and non-managed config', async () => {
    const captured = snapshot('v2');
    const validateDependencies = vi.fn(async () => ({ valid: true as const }));
    const resolveForExistingAgent = vi.fn(async () => ({
      agentId: 'builtin-inbox-id',
      config: resolvedConfig(captured),
      dependencySnapshot,
    }));
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      materializationService: { resolveForExistingAgent },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies,
    });

    const result = await service.getEffectiveBuiltinConfig(base());
    expect(result).toMatchObject({
      avatar: 'managed-avatar',
      description: 'Managed description',
      id: 'builtin-inbox-id',
      model: 'managed-model',
      openingMessage: 'Managed welcome',
      openingQuestions: ['Managed question'],
      provider: 'managed-provider',
      slug: INBOX_SESSION_ID,
      systemRole: 'Managed prompt v2',
      tags: ['managed'],
      title: 'Inbox v2',
    });
    expect(result.plugins).toEqual([]);
    expect(result.platform).toEqual({
      distribution: 'mandatory',
      managed: true,
      modelLocked: true,
      source: 'platform',
    });
    expect(result.params).toMatchObject({
      ...DEFAULT_AGENT_CONFIG.params,
      temperature: 0.2,
    });
    expect(resolveForExistingAgent).toHaveBeenCalledWith(captured, 'builtin-inbox-id');
    expect(validateDependencies).toHaveBeenCalledWith(db, dependencySnapshot);
  });

  it.each([
    { expectedPlugins: ['legacy-tool'], takeover: false },
    { expectedPlugins: [] as string[], takeover: true },
  ])(
    'plugins overlay: takeover=$takeover keeps vs blanks user tool toggles',
    async ({ expectedPlugins, takeover }) => {
      const captured = snapshot('v2');
      const service = new PlatformDefaultInboxService(db, 'user', {
        flags: flagsOn,
        isTakeoverActive: async () => takeover,
        materializationService: {
          resolveForExistingAgent: vi.fn(async () => ({
            agentId: 'builtin-inbox-id',
            config: resolvedConfig(captured),
            dependencySnapshot,
          })),
        },
        resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
        validateDependencies: vi.fn(async () => ({ valid: true as const })),
      });

      const result = await service.getEffectiveBuiltinConfig(base());
      expect(result.plugins).toEqual(expectedPlugins);
      expect(result.platform).toEqual({
        distribution: 'mandatory',
        managed: true,
        modelLocked: takeover,
        source: 'platform',
      });
      expect(result.model).toBe(takeover ? 'managed-model' : 'legacy-model');
      expect(result.provider).toBe(takeover ? 'managed-provider' : 'legacy-provider');
      expect(result.systemRole).toBe('Managed prompt v2');
    },
  );

  it('overlays a provision-shaped published version onto the builtin inbox', async () => {
    const captured = snapshot('v1', 'Lobe AI');
    captured.config.avatar = DEFAULT_INBOX_AVATAR;
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-inbox-id',
          config: resolvedConfig(captured),
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });

    await expect(service.getEffectiveBuiltinConfig(base())).resolves.toMatchObject({
      avatar: DEFAULT_INBOX_AVATAR,
      slug: INBOX_SESSION_ID,
      title: 'Lobe AI',
    });
  });

  it('keeps a captured V2 result pinned after the published pointer rolls back to V1', async () => {
    const v2 = snapshot('v2');
    const v1 = snapshot('v1');
    const beginSystemOperation = vi
      .fn()
      .mockResolvedValueOnce(handle(v2))
      .mockResolvedValueOnce(handle(v1));
    const resolveForExistingAgent = vi.fn(async (value: PlatformAgentOperationSnapshot) => ({
      agentId: 'builtin-inbox-id',
      config: resolvedConfig(value),
      dependencySnapshot,
    }));
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      materializationService: { resolveForExistingAgent },
      resolver: { beginSystemOperation },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });

    const operationStartedOnV2 = await service.getEffectiveBuiltinConfig(base());
    const operationStartedAfterRollback = await service.getEffectiveBuiltinConfig(base());
    expect(operationStartedOnV2.systemRole).toBe('Managed prompt v2');
    expect(operationStartedAfterRollback.systemRole).toBe('Managed prompt v1');
  });

  it('applies a pinned thinking effort only when the user has not set that chatConfig key', async () => {
    const captured = snapshot('v2');
    captured.config.thinkingEffort = { controlKey: 'reasoningEffort', level: 'high' };
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-inbox-id',
          config: resolvedConfig(captured),
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });

    const withDefault = await service.getEffectiveBuiltinConfig(base());
    expect(withDefault.chatConfig.reasoningEffort).toBe('high');
    expect(withDefault.chatConfig.enableStreaming).toBe(base().chatConfig.enableStreaming);
    expect(withDefault.title).toBe('Inbox v2');

    const userSet = base();
    userSet.chatConfig = { ...userSet.chatConfig, reasoningEffort: 'low' };
    const withUser = await service.getEffectiveBuiltinConfig(userSet);
    expect(withUser.chatConfig.reasoningEffort).toBe('low');
  });

  it('leaves chatConfig unchanged when the version does not pin an effort', async () => {
    const captured = snapshot('v2');
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-inbox-id',
          config: resolvedConfig(captured),
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });

    const legacy = base();
    const result = await service.getEffectiveBuiltinConfig(legacy);
    expect(result.chatConfig).toEqual(legacy.chatConfig);
  });

  it('treats managed avatar null as an authoritative clear', async () => {
    const baseSnapshot = snapshot('v2');
    const captured: PlatformAgentOperationSnapshot = {
      ...baseSnapshot,
      config: { ...baseSnapshot.config, avatar: null },
    };
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-inbox-id',
          config: resolvedConfig(captured),
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });

    expect((await service.getEffectiveBuiltinConfig(base())).avatar).toBeNull();
  });

  it('propagates resolver and exact dependency failures instead of treating errors as absence', async () => {
    const unavailable = new Error('stable resolver failure');
    const resolverFailure = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      resolver: {
        beginSystemOperation: vi.fn(async () => {
          throw unavailable;
        }),
      },
    });
    await expect(resolverFailure.getEffectiveBuiltinConfig(base())).rejects.toBe(unavailable);

    const exactFailure = new Error('exact dependency failure');
    const captured = snapshot('v2');
    const dependencyFailure = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => true,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-inbox-id',
          config: resolvedConfig(captured),
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => {
        throw exactFailure;
      }),
    });
    await expect(dependencyFailure.getEffectiveBuiltinConfig(base())).rejects.toBe(exactFailure);
  });

  it.each([
    {
      expectedModel: 'gpt-5.6-sol',
      expectedProvider: 'chatgpt',
      model: 'gpt-5.6-sol',
      name: 'user pair wins when both provider and model are set',
      provider: 'chatgpt',
    },
    {
      expectedModel: 'gpt-6-astra',
      expectedProvider: 'openai',
      model: '',
      name: 'empty user row uses the admin pair',
      provider: '',
    },
    {
      expectedModel: 'gpt-6-astra',
      expectedProvider: 'openai',
      model: '',
      name: 'user provider without model uses the admin pair (never mixed)',
      provider: 'chatgpt',
    },
  ])(
    'light-mode model defaults: $name',
    async ({ expectedModel, expectedProvider, model, provider }) => {
      const captured = snapshot('v2');
      const adminResolved = {
        ...resolvedConfig(captured),
        model: 'gpt-6-astra',
        params: { max_tokens: 4096, temperature: 0.2 },
        provider: 'openai',
      };
      const service = new PlatformDefaultInboxService(db, 'user', {
        flags: flagsOn,
        isTakeoverActive: async () => false,
        materializationService: {
          resolveForExistingAgent: vi.fn(async () => ({
            agentId: 'builtin-inbox-id',
            config: adminResolved,
            dependencySnapshot,
          })),
        },
        resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
        validateDependencies: vi.fn(async () => ({ valid: true as const })),
      });

      const row = base();
      row.model = model;
      row.provider = provider;
      row.params = { temperature: 0.9 };
      const result = await service.getEffectiveBuiltinConfig(row);

      expect(result.model).toBe(expectedModel);
      expect(result.provider).toBe(expectedProvider);
      // No userRow: admin mapped keys overlay base. Snapshot only maps temperature.
      expect(result.params).toMatchObject({ temperature: 0.2 });
      expect(result.platform).toEqual({
        distribution: 'mandatory',
        managed: true,
        modelLocked: false,
        source: 'platform',
      });
      expect(result.systemRole).toBe('Managed prompt v2');
      expect(result.title).toBe('Inbox v2');
      expect(result.plugins).toEqual(['legacy-tool']);
    },
  );

  const lightOverlay = () => {
    const captured = snapshot('v2');
    const adminResolved = {
      ...resolvedConfig(captured),
      model: 'gpt-6-astra',
      params: { max_tokens: 4096, temperature: 0.2 },
      provider: 'openai',
    };
    const service = new PlatformDefaultInboxService(db, 'user', {
      flags: flagsOn,
      isTakeoverActive: async () => false,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-inbox-id',
          config: adminResolved,
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });
    return service;
  };

  it('userRow null/empty follows the admin pair even when base already has merged defaults', async () => {
    const row = base();
    row.model = 'deepseek-chat';
    row.params = { ...DEFAULT_AGENT_CONFIG.params };
    row.provider = 'deepseek';

    const result = await lightOverlay().getEffectiveBuiltinConfig(row, {
      userRow: { model: null, params: null, provider: null },
    });

    expect(result.model).toBe('gpt-6-astra');
    expect(result.provider).toBe('openai');
    expect(result.params).toMatchObject({
      ...DEFAULT_AGENT_CONFIG.params,
      temperature: 0.2,
    });
    expect(result.params).not.toHaveProperty('max_tokens');
    expect(result.platform).toEqual({
      distribution: 'mandatory',
      managed: true,
      modelLocked: false,
      source: 'platform',
    });
  });

  it('userRow with both provider and model keeps the user pair', async () => {
    const row = base();
    row.model = 'deepseek-chat';
    row.provider = 'deepseek';

    const result = await lightOverlay().getEffectiveBuiltinConfig(row, {
      userRow: { model: 'gpt-5.6-sol', params: {}, provider: 'chatgpt' },
    });

    expect(result.model).toBe('gpt-5.6-sol');
    expect(result.provider).toBe('chatgpt');
  });

  it('userRow with provider only never mixes pairs and uses the admin pair', async () => {
    const row = base();
    row.model = 'deepseek-chat';
    row.provider = 'deepseek';

    const result = await lightOverlay().getEffectiveBuiltinConfig(row, {
      userRow: { model: null, provider: 'chatgpt' },
    });

    expect(result.model).toBe('gpt-6-astra');
    expect(result.provider).toBe('openai');
  });

  it('light-mode params: merged DEFAULT_AGENT_CONFIG does not shadow admin; userRow keys win', async () => {
    const row = base();
    row.model = 'deepseek-chat';
    row.params = { ...DEFAULT_AGENT_CONFIG.params };
    row.provider = 'deepseek';
    const service = lightOverlay();

    const fromEmptyRow = await service.getEffectiveBuiltinConfig(row, {
      userRow: { model: null, params: {}, provider: null },
    });
    expect(fromEmptyRow.params).toMatchObject({
      frequency_penalty: 0,
      presence_penalty: 0,
      temperature: 0.2,
      top_p: 1,
    });
    expect(fromEmptyRow.params).not.toHaveProperty('max_tokens');

    const fromUserKeys = await service.getEffectiveBuiltinConfig(row, {
      userRow: { model: null, params: { temperature: 0.9 }, provider: null },
    });
    expect(fromUserKeys.params).toMatchObject({
      frequency_penalty: 0,
      presence_penalty: 0,
      temperature: 0.9,
      top_p: 1,
    });
  });

  it('light-mode params overlay only mapped admin modelParameters, then user keys', async () => {
    const captured = snapshot('v2');
    const makeService = (modelParameters: PlatformAgentVersionConfig['modelParameters']) => {
      captured.config.modelParameters = modelParameters;
      const adminResolved = {
        ...resolvedConfig(captured),
        model: 'gpt-6-astra',
        // Deliberately filled like buildPlatformAgentRuntimeConfig — must NOT overlay.
        params: { ...DEFAULT_AGENT_CONFIG.params, temperature: 1, top_p: 1 },
        provider: 'openai',
      };
      return new PlatformDefaultInboxService(db, 'user', {
        flags: flagsOn,
        isTakeoverActive: async () => false,
        materializationService: {
          resolveForExistingAgent: vi.fn(async () => ({
            agentId: 'builtin-inbox-id',
            config: adminResolved,
            dependencySnapshot,
          })),
        },
        resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
        validateDependencies: vi.fn(async () => ({ valid: true as const })),
      });
    };

    const row = base();
    row.params = { temperature: 0.35, top_p: 0.8 };

    const emptyAdmin = await makeService({}).getEffectiveBuiltinConfig(row, {
      userRow: { model: null, params: {}, provider: null },
    });
    expect(emptyAdmin.params).toEqual({ temperature: 0.35, top_p: 0.8 });

    const adminTemp = await makeService({ temperature: 0.2 }).getEffectiveBuiltinConfig(row, {
      userRow: { model: null, params: {}, provider: null },
    });
    expect(adminTemp.params).toEqual({ temperature: 0.2, top_p: 0.8 });

    const userWins = await makeService({ temperature: 0.2 }).getEffectiveBuiltinConfig(row, {
      userRow: { model: null, params: { top_p: 0.5 }, provider: null },
    });
    expect(userWins.params).toEqual({ temperature: 0.2, top_p: 0.5 });
  });

  describe('getPublishedIdentity', () => {
    it('returns null with zero platform IO while the flag is off', async () => {
      const beginSystemOperation = vi.fn();
      const resolveForExistingAgent = vi.fn();
      const service = new PlatformDefaultInboxService(db, 'user', {
        flags: flagsOff,
        materializationService: { resolveForExistingAgent },
        resolver: { beginSystemOperation },
      });

      await expect(service.getPublishedIdentity()).resolves.toBeNull();
      expect(beginSystemOperation).not.toHaveBeenCalled();
      expect(resolveForExistingAgent).not.toHaveBeenCalled();
    });

    it('returns null when there is no published default', async () => {
      const beginSystemOperation = vi.fn(async () => null);
      const resolveForExistingAgent = vi.fn();
      const service = new PlatformDefaultInboxService(db, 'user', {
        flags: flagsOn,
        materializationService: { resolveForExistingAgent },
        resolver: { beginSystemOperation },
      });

      await expect(service.getPublishedIdentity()).resolves.toBeNull();
      expect(beginSystemOperation).toHaveBeenCalledWith(
        'user',
        PLATFORM_AGENT_DEFAULT_INBOX_SYSTEM_KEY,
      );
      expect(resolveForExistingAgent).not.toHaveBeenCalled();
    });

    it('returns catalog display fields without materializing', async () => {
      const captured = snapshot('v2', 'Published inbox');
      const resolveForExistingAgent = vi.fn();
      const validateDependencies = vi.fn();
      const service = new PlatformDefaultInboxService(db, 'user', {
        flags: flagsOn,
        materializationService: { resolveForExistingAgent },
        resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
        validateDependencies,
      });

      await expect(service.getPublishedIdentity()).resolves.toEqual({
        avatar: 'managed-avatar',
        backgroundColor: '#123456',
        title: 'Published inbox',
      });
      expect(resolveForExistingAgent).not.toHaveBeenCalled();
      expect(validateDependencies).not.toHaveBeenCalled();
    });

    it('propagates resolver failures instead of treating errors as absence', async () => {
      const unavailable = new Error('stable resolver failure');
      const service = new PlatformDefaultInboxService(db, 'user', {
        flags: flagsOn,
        resolver: {
          beginSystemOperation: vi.fn(async () => {
            throw unavailable;
          }),
        },
      });

      await expect(service.getPublishedIdentity()).rejects.toBe(unavailable);
    });
  });
});
