import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_AGENT_CONFIG, DEFAULT_MODEL } from '@lobechat/const';
import {
  PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY,
  type PlatformAgentVersionConfig,
} from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { DISABLED_ENTERPRISE_FEATURE_FLAGS } from '@/const/platform/featureFlags';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentConfigWithId } from '@/server/services/agent';

import type {
  PlatformAgentOperationHandle,
  PlatformAgentOperationSnapshot,
} from './effectiveResolver';
import { PlatformTaskManagerService } from './taskManagerAgent';

const flagsOn = { ...DISABLED_ENTERPRISE_FEATURE_FLAGS, ENABLE_PLATFORM_MANAGED_AGENTS: true };
const flagsOff = { ...DISABLED_ENTERPRISE_FEATURE_FLAGS, ENABLE_PLATFORM_MANAGED_AGENTS: false };
const db = {} as LobeChatDatabase;

const dependencySnapshot = {
  connectors: [],
  model: {
    modelKey: 'managed-model',
    providerChecksum: 'm'.repeat(64),
    providerKey: 'managed-provider',
    providerRevision: 3,
  },
  skills: [],
};

const snapshot = (versionId: string, displayName = `Task ${versionId}`) =>
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
    platformAgentId: 'platform-task-manager',
    versionId,
  }) satisfies PlatformAgentOperationSnapshot;

const handle = (value: PlatformAgentOperationSnapshot): PlatformAgentOperationHandle => ({
  distribution: 'default',
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
  id: 'builtin-task-agent-id',
  model: 'legacy-model',
  plugins: ['lobe-task'],
  provider: 'legacy-provider',
  slug: BUILTIN_AGENT_SLUGS.taskAgent,
  systemRole: 'Legacy prompt',
  tags: ['legacy'],
  title: 'Legacy task agent',
});

const resolvedConfig = (value: PlatformAgentOperationSnapshot) => ({
  ...base(),
  id: 'builtin-task-agent-id',
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

describe('PlatformTaskManagerService', () => {
  it('returns the exact legacy object with zero platform IO while the flag is off', async () => {
    const beginSystemOperation = vi.fn();
    const resolveForExistingAgent = vi.fn();
    const legacy = base();
    const service = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOff,
      materializationService: { resolveForExistingAgent },
      resolver: { beginSystemOperation },
    });

    await expect(service.getEffectiveBuiltinConfig(legacy)).resolves.toBe(legacy);
    expect(beginSystemOperation).not.toHaveBeenCalled();
    expect(resolveForExistingAgent).not.toHaveBeenCalled();
  });

  it('leaves a non-task-agent slug untouched', async () => {
    const beginSystemOperation = vi.fn();
    const other = { ...base(), slug: 'inbox' };
    const service = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      resolver: { beginSystemOperation },
    });

    await expect(service.getEffectiveBuiltinConfig(other)).resolves.toBe(other);
    expect(beginSystemOperation).not.toHaveBeenCalled();
  });

  it('falls back only for a genuinely absent published task-manager', async () => {
    const legacy = base();
    const beginSystemOperation = vi.fn(async () => null);
    const service = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      resolver: { beginSystemOperation },
    });

    await expect(service.getEffectiveBuiltinConfig(legacy)).resolves.toBe(legacy);
    expect(beginSystemOperation).toHaveBeenCalledWith(
      'user',
      PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY,
    );
  });

  it('overlays identity/prompt while keeping plugins, chatConfig, and light-mode model defaults', async () => {
    const captured = snapshot('v2');
    const validateDependencies = vi.fn(async () => ({ valid: true as const }));
    const resolveForExistingAgent = vi.fn(async () => ({
      agentId: 'builtin-task-agent-id',
      config: resolvedConfig(captured),
      dependencySnapshot,
    }));
    const service = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      materializationService: { resolveForExistingAgent },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies,
    });

    const result = await service.getEffectiveBuiltinConfig(base());
    expect(result).toMatchObject({
      avatar: 'managed-avatar',
      description: 'Managed description',
      id: 'builtin-task-agent-id',
      model: 'legacy-model',
      openingMessage: 'Managed welcome',
      openingQuestions: ['Managed question'],
      provider: 'legacy-provider',
      slug: BUILTIN_AGENT_SLUGS.taskAgent,
      systemRole: 'Managed prompt v2',
      tags: ['managed'],
      title: 'Task v2',
    });
    expect(result.plugins).toEqual(['lobe-task']);
    expect(result.platform).toEqual({
      distribution: 'default',
      managed: true,
      modelLocked: false,
      source: 'platform',
    });
    expect(result.params).toMatchObject({
      ...DEFAULT_AGENT_CONFIG.params,
      temperature: 0.2,
    });
    expect(resolveForExistingAgent).toHaveBeenCalledWith(captured, 'builtin-task-agent-id');
    expect(validateDependencies).toHaveBeenCalledWith(db, dependencySnapshot);
  });

  it('applies a pinned thinking effort only when the user has not set that chatConfig key', async () => {
    const captured = snapshot('v2');
    captured.config.thinkingEffort = { controlKey: 'reasoningEffort', level: 'high' };
    const service = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-task-agent-id',
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

    const userSet = base();
    userSet.chatConfig = { ...userSet.chatConfig, reasoningEffort: 'low' };
    const withUser = await service.getEffectiveBuiltinConfig(userSet);
    expect(withUser.chatConfig.reasoningEffort).toBe('low');
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
      const service = new PlatformTaskManagerService(db, 'user', {
        flags: flagsOn,
        materializationService: {
          resolveForExistingAgent: vi.fn(async () => ({
            agentId: 'builtin-task-agent-id',
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
      const result = await service.getEffectiveBuiltinConfig(row);

      expect(result.model).toBe(expectedModel);
      expect(result.provider).toBe(expectedProvider);
      expect(result.platform?.modelLocked).toBe(false);
      expect(result.plugins).toEqual(['lobe-task']);
      expect(result.systemRole).toBe('Managed prompt v2');
    },
  );

  it('userRow null/empty follows the admin pair even when base already has merged defaults', async () => {
    const captured = snapshot('v2');
    const adminResolved = {
      ...resolvedConfig(captured),
      model: 'gpt-6-astra',
      params: { max_tokens: 4096, temperature: 0.2 },
      provider: 'openai',
    };
    const service = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-task-agent-id',
          config: adminResolved,
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });

    const row = base();
    row.model = 'deepseek-chat';
    row.provider = 'deepseek';
    const result = await service.getEffectiveBuiltinConfig(row, {
      userRow: { model: null, params: null, provider: null },
    });

    expect(result.model).toBe('gpt-6-astra');
    expect(result.provider).toBe('openai');
    expect(result.plugins).toEqual(['lobe-task']);
  });

  it('treats TASK_AGENT.persist defaults as unowned so existing rows follow the admin pin', async () => {
    const captured = snapshot('v2');
    const adminResolved = {
      ...resolvedConfig(captured),
      model: 'gpt-6-astra',
      params: { max_tokens: 4096, temperature: 0.2 },
      provider: 'openai',
    };
    const service = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-task-agent-id',
          config: adminResolved,
          dependencySnapshot,
        })),
      },
      resolver: { beginSystemOperation: vi.fn(async () => handle(captured)) },
      validateDependencies: vi.fn(async () => ({ valid: true as const })),
    });

    const result = await service.getEffectiveBuiltinConfig(base(), {
      userRow: { model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER },
    });

    expect(result.model).toBe('gpt-6-astra');
    expect(result.provider).toBe('openai');
    expect(result.platform?.modelLocked).toBe(false);
  });

  it('propagates resolver and exact dependency failures instead of treating errors as absence', async () => {
    const unavailable = new Error('stable resolver failure');
    const resolverFailure = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      resolver: {
        beginSystemOperation: vi.fn(async () => {
          throw unavailable;
        }),
      },
    });
    await expect(resolverFailure.getEffectiveBuiltinConfig(base())).rejects.toBe(unavailable);

    const exactFailure = new Error('exact dependency failure');
    const captured = snapshot('v2');
    const dependencyFailure = new PlatformTaskManagerService(db, 'user', {
      flags: flagsOn,
      materializationService: {
        resolveForExistingAgent: vi.fn(async () => ({
          agentId: 'builtin-task-agent-id',
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
});
