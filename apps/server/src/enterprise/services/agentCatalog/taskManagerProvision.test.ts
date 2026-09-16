import { BUILTIN_AGENT_SLUGS, TASK_AGENT } from '@lobechat/builtin-agents';
import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { PlatformAgentDependencyValidationError } from './errors';
import {
  buildTaskManagerSeed,
  DEFAULT_TASK_MANAGER_DISPLAY_NAME_EN,
  DEFAULT_TASK_MANAGER_DISPLAY_NAME_ZH,
  isTaskManagerIdentity,
  PLATFORM_TASK_MANAGER_AGENT_KEY,
  PLATFORM_TASK_MANAGER_MEMBER_SLUG,
} from './taskManagerProvision';

const getProviderByKey = vi.fn();
const getLatestPublishedProviderRevision = vi.fn();

vi.mock('@/database/repositories/platformAiCatalog', () => ({
  PlatformAiCatalogRepository: class {
    getLatestPublishedProviderRevision = getLatestPublishedProviderRevision;
    getProviderByKey = getProviderByKey;
  },
}));

const db = {} as LobeChatDatabase;
const checksum = 'c'.repeat(64);

const stubPublishedDefault = () => {
  getProviderByKey.mockResolvedValue({
    id: 'provider-id',
    providerKey: DEFAULT_AGENT_CONFIG.provider,
    status: 'published',
  });
  getLatestPublishedProviderRevision.mockResolvedValue({
    checksum,
    payload: {
      models: [{ enabled: true, modelKey: DEFAULT_AGENT_CONFIG.model, type: 'chat' }],
      provider: { enabled: true, providerKey: DEFAULT_AGENT_CONFIG.provider },
    },
    revision: 4,
    status: 'published',
  });
};

describe('buildTaskManagerSeed', () => {
  it('seeds 任务助手 identity, builtin avatar, task-agent system role, and the inbox model pin', async () => {
    stubPublishedDefault();

    const seed = await buildTaskManagerSeed(db, { locale: 'zh-CN' });

    expect(seed.config).toMatchObject({
      avatar: TASK_AGENT.avatar,
      displayName: DEFAULT_TASK_MANAGER_DISPLAY_NAME_ZH,
      modelParameters: {},
      thinkingEffort: null,
    });
    expect(seed.config.systemRole).toContain('dedicated task management assistant');
    expect(seed.config).not.toHaveProperty('plugins');
    expect(seed.dependencySnapshot.model).toEqual({
      modelKey: DEFAULT_AGENT_CONFIG.model,
      providerChecksum: checksum,
      providerKey: DEFAULT_AGENT_CONFIG.provider,
      providerRevision: 4,
    });
  });

  it('falls back to the English display name for a non-zh locale', async () => {
    stubPublishedDefault();

    const seed = await buildTaskManagerSeed(db, { locale: 'en-US' });

    expect(seed.config.displayName).toBe(DEFAULT_TASK_MANAGER_DISPLAY_NAME_EN);
    expect(seed.config.avatar).toBe('/avatars/lobe-ai.png');
  });

  it('defaults to 任务助手 when locale is empty or omitted (DEFAULT_LANG=)', async () => {
    stubPublishedDefault();

    await expect(buildTaskManagerSeed(db)).resolves.toMatchObject({
      config: { displayName: DEFAULT_TASK_MANAGER_DISPLAY_NAME_ZH },
    });
    await expect(buildTaskManagerSeed(db, { locale: '' })).resolves.toMatchObject({
      config: { displayName: DEFAULT_TASK_MANAGER_DISPLAY_NAME_ZH },
    });
    await expect(buildTaskManagerSeed(db, { locale: '   ' })).resolves.toMatchObject({
      config: { displayName: DEFAULT_TASK_MANAGER_DISPLAY_NAME_ZH },
    });
  });

  it('throws when the published catalog cannot pin the default model', async () => {
    getProviderByKey.mockResolvedValue(undefined);
    getLatestPublishedProviderRevision.mockResolvedValue(undefined);

    await expect(buildTaskManagerSeed(db)).rejects.toBeInstanceOf(
      PlatformAgentDependencyValidationError,
    );
  });
});

describe('task-manager identity helpers', () => {
  it('recognizes only the reserved system key and keeps isDefault false at the key/slug layer', () => {
    expect(PLATFORM_TASK_MANAGER_AGENT_KEY).toBe(PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY);
    expect(PLATFORM_TASK_MANAGER_MEMBER_SLUG).toBe(BUILTIN_AGENT_SLUGS.taskAgent);
    expect(isTaskManagerIdentity({ systemKey: 'task-manager' })).toBe(true);
    expect(isTaskManagerIdentity({ systemKey: 'default-inbox' })).toBe(false);
    expect(isTaskManagerIdentity({ systemKey: null })).toBe(false);
  });
});
