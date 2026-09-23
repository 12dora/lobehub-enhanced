import { describe, expect, it } from 'vitest';

import {
  findSystemAgentProblems,
  projectDingtalkCapability,
  projectMemoryCapability,
  projectSandboxCapability,
  projectSystemAgentCapability,
} from './capabilities';

describe('capability readiness', () => {
  it('maps a missing sandbox image to unavailable and a hidden tile to disabled', () => {
    expect(
      projectSandboxCapability({
        activeContainers: 0,
        daemonReachable: true,
        detail: 'Docker',
        errorCategory: 'operation_unavailable',
        imagePresent: false,
        lastCheckedAt: new Date('2026-08-01T00:00:00.000Z'),
        lastError: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
        maxContainers: 8,
        pullPolicy: 'never',
        status: 'unavailable',
      }),
    ).toMatchObject({
      key: 'sandbox',
      status: 'unavailable',
      detail: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
    });
    expect(projectSandboxCapability(null).status).toBe('disabled');
  });

  it('flags system-agent slots whose provider or model is missing or disabled', () => {
    const slots = [
      { enabled: true, model: 'mini', name: 'topic', provider: 'alpha' },
      { enabled: false, model: 'skip', name: 'inputCompletion', provider: 'missing' },
      { enabled: true, model: 'gone', name: 'translation', provider: 'alpha' },
    ];
    const found = findSystemAgentProblems(
      slots,
      [
        { enabled: true, id: 'p1', providerKey: 'alpha', status: 'published' },
        { enabled: false, id: 'p2', providerKey: 'beta', status: 'published' },
      ],
      [{ enabled: true, modelKey: 'mini', providerId: 'p1', status: 'published' }],
    );
    expect(found.checked).toBe(2);
    expect(found.problems).toEqual(['translation: 模型 gone 不存在']);
    expect(projectSystemAgentCapability({ ...found, managed: true }).status).toBe('degraded');
    expect(
      projectSystemAgentCapability({
        checked: 1,
        managed: true,
        problems: ['topic: 提供方 openai 不存在'],
      }).status,
    ).toBe('unavailable');
    expect(projectSystemAgentCapability({ checked: 0, managed: false, problems: [] }).status).toBe(
      'disabled',
    );
  });

  it('guards a missing memory probe and reads DingTalk from recorded errors only', () => {
    expect(projectMemoryCapability({ missing: true })).toMatchObject({
      key: 'memory_embedding',
      status: 'unknown',
    });
    expect(
      projectMemoryCapability({ availability: { available: false, reason: 'not_configured' } })
        .status,
    ).toBe('disabled');
    expect(
      projectMemoryCapability({ availability: { available: true, detail: 'text-embed' } }),
    ).toMatchObject({
      status: 'healthy',
      detail: 'text-embed',
    });
    expect(
      projectMemoryCapability({
        availability: { reason: '密钥无效', status: 'unavailable' },
      }).status,
    ).toBe('unavailable');

    expect(
      projectDingtalkCapability({ callsToday: 0, configured: false, errors10m: 0 }).status,
    ).toBe('disabled');
    expect(
      projectDingtalkCapability({
        callsToday: 4,
        configured: true,
        errors10m: 3,
        lastError: 'invalid access_token',
      }),
    ).toMatchObject({ status: 'unavailable', detail: 'invalid access_token' });
    expect(
      projectDingtalkCapability({ callsToday: 2, configured: true, errors10m: 0 }).detail,
    ).toBe('今日 API 调用 2 次');
  });
});
