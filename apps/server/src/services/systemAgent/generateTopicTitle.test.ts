import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { SystemAgentService } from './index';
import { clearStructuredOutputBackoff } from './structuredOutputBackoff';

const noteRuntimeError = vi.hoisted(() => vi.fn());

vi.mock('@/server/enterprise/services/platformSystem/noteRuntimeError', () => ({
  noteRuntimeError,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = vi.fn();
    static getInfoForAIGeneration = vi.fn();
  },
}));

vi.mock('@/server/enterprise/services/settings/runtimeSettingsAdapter', () => ({
  getEffectiveSystemAgentConfig: vi.fn(),
  isSettingsPolicyEnabled: vi.fn(async () => false),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

const generateObject = vi.fn();

describe('SystemAgentService.generateTopicTitle', () => {
  const service = new SystemAgentService({} as never, 'user-1');

  beforeEach(() => {
    clearStructuredOutputBackoff();
    noteRuntimeError.mockClear();
    generateObject.mockReset();
    vi.mocked(initModelRuntimeFromDB)
      .mockReset()
      .mockResolvedValue({ generateObject } as never);
    vi.spyOn(service, 'getTaskModelConfig').mockResolvedValue({
      model: 'gpt-5.4-mini',
      provider: 'chatgpt',
    } as Awaited<ReturnType<SystemAgentService['getTaskModelConfig']>>);
    vi.spyOn(service, 'getUserLocale').mockResolvedValue('zh-CN');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearStructuredOutputBackoff();
  });

  it('returns the model title when structured output succeeds', async () => {
    generateObject.mockResolvedValue({ title: '木质素检测' });

    await expect(
      service.generateTopicTitle({ lastAssistantContent: 'done', userPrompt: '写一份规程' }),
    ).resolves.toBe('木质素检测');
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('falls back to the user message when the model returns an empty title', async () => {
    generateObject.mockResolvedValue({});

    await expect(
      service.generateTopicTitle({
        lastAssistantContent: 'done',
        userPrompt: '钉钉 · 你好，帮我看待办',
      }),
    ).resolves.toBe('你好，帮我看待办');
  });

  it('logs provider and model on a 400 and does not call that model again for 10 minutes', async () => {
    const error = Object.assign(new Error('[chatgpt/gpt-5.4-mini] 400: {"detail":"stream"}'), {
      status: 400,
    });
    generateObject.mockRejectedValue(error);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      service.generateTopicTitle({ lastAssistantContent: 'done', userPrompt: '第一句用户的话' }),
    ).resolves.toBe('第一句用户的话');
    expect(errorLog).toHaveBeenCalledWith(
      'SystemAgentService.generateTopicTitle failed [chatgpt/gpt-5.4-mini]:',
      error,
    );
    expect(noteRuntimeError).toHaveBeenCalledWith('system_agent', error, {
      model: 'gpt-5.4-mini',
      operation: 'generateTopicTitle',
      provider: 'chatgpt',
    });

    generateObject.mockClear();
    await expect(
      service.generateTopicTitle({ lastAssistantContent: 'done', userPrompt: '下一句' }),
    ).resolves.toBe('下一句');
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe('SystemAgentService.generateSkillMeta', () => {
  const service = new SystemAgentService({} as never, 'user-1');

  beforeEach(() => {
    clearStructuredOutputBackoff();
    noteRuntimeError.mockClear();
    generateObject.mockReset();
    vi.mocked(initModelRuntimeFromDB)
      .mockReset()
      .mockResolvedValue({ generateObject } as never);
    vi.spyOn(service, 'getTaskModelConfig').mockResolvedValue({
      model: 'gpt-5.4-mini',
      provider: 'chatgpt',
    } as Awaited<ReturnType<SystemAgentService['getTaskModelConfig']>>);
    vi.spyOn(service, 'getUserLocale').mockResolvedValue('zh-CN');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearStructuredOutputBackoff();
  });

  it('records provider and model when skill meta generation throws', async () => {
    const error = new Error('skill meta failed');
    generateObject.mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      service.generateSkillMeta({ content: 'A skill that writes weekly notes.' }),
    ).resolves.toBeNull();
    expect(noteRuntimeError).toHaveBeenCalledWith('system_agent', error, {
      model: 'gpt-5.4-mini',
      operation: 'generateSkillMeta',
      provider: 'chatgpt',
    });
  });
});
