import { describe, expect, it, vi } from 'vitest';

import { isPlatformModuleId } from '@/const/platform';
import { isModuleEnabled } from '@/server/enterprise/services/moduleSettings';

import { adminSystemCapabilityKeySchema } from '../../contracts/adminSystem/status';
import {
  CAPABILITY_KEYS,
  capabilityModuleEnabled,
  DINGTALK_PERSONAL_BROKER_HEALTH_TIMEOUT_MS,
  fallbackCapabilities,
  findSystemAgentProblems,
  probeDingtalkPersonalBroker,
  projectDingtalkCapability,
  projectDingtalkPersonalCapability,
  projectMemoryCapability,
  projectSandboxCapability,
  projectSystemAgentCapability,
  readDingtalkPersonalDataEnabled,
} from './capabilities';

vi.mock('@/server/enterprise/services/moduleSettings', () => ({
  isModuleEnabled: vi.fn(async () => true),
}));

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
      projectDingtalkCapability({
        callsToday: 2,
        configured: true,
        dailyAlertThreshold: 20_000,
        errors10m: 0,
      }).detail,
    ).toBe('今日 API 调用 2 次（告警阈值 20000）');
  });

  it('keeps the call-count line unchanged when the daily alert is disabled', () => {
    expect(
      projectDingtalkCapability({
        callsToday: 2,
        configured: true,
        dailyAlertThreshold: 0,
        errors10m: 0,
      }).detail,
    ).toBe('今日 API 调用 2 次');
  });

  it('keeps the DingTalk personal-data status key inside the status array cap', () => {
    expect(adminSystemCapabilityKeySchema.options).toEqual([...CAPABILITY_KEYS]);
    expect(CAPABILITY_KEYS).toContain('dingtalk_personal');
    expect(CAPABILITY_KEYS.length).toBeLessThanOrEqual(8);
    expect(fallbackCapabilities(null).map((item) => item.key)).toContain('dingtalk_personal');
    expect(
      fallbackCapabilities(null).find((item) => item.key === 'dingtalk_personal')?.status,
    ).toBe('unknown');
  });

  it('reads the raw personalDataEnabled switch and ignores non-booleans', () => {
    expect(readDingtalkPersonalDataEnabled({ personalDataEnabled: true })).toBe(true);
    expect(readDingtalkPersonalDataEnabled({ personalDataEnabled: false })).toBe(false);
    expect(readDingtalkPersonalDataEnabled({ personalDataEnabled: 'true' })).toBe(false);
    expect(readDingtalkPersonalDataEnabled({ personalDataEnabled: 1 })).toBe(false);
    expect(readDingtalkPersonalDataEnabled({})).toBe(false);
    expect(readDingtalkPersonalDataEnabled(null)).toBe(false);
    expect(readDingtalkPersonalDataEnabled([])).toBe(false);
  });

  it('projects DingTalk personal data as disabled, unavailable, or an authorization count', () => {
    expect(
      projectDingtalkPersonalCapability({
        authorizedCount: 3,
        brokerConfigured: true,
        enabled: false,
        healthOk: false,
      }),
    ).toMatchObject({
      key: 'dingtalk_personal',
      reason: '未启用钉钉个人数据',
      status: 'disabled',
    });
    expect(
      projectDingtalkPersonalCapability({
        authorizedCount: 0,
        brokerConfigured: false,
        enabled: false,
        healthOk: false,
      }),
    ).toMatchObject({ status: 'disabled', reason: '未启用钉钉个人数据' });
    expect(
      projectDingtalkPersonalCapability({
        authorizedCount: 0,
        brokerConfigured: false,
        enabled: true,
        healthOk: false,
      }),
    ).toMatchObject({ status: 'unavailable', reason: '未检测到钉钉个人数据服务' });
    expect(
      projectDingtalkPersonalCapability({
        authorizedCount: 0,
        brokerConfigured: true,
        enabled: true,
        healthOk: false,
      }),
    ).toMatchObject({ status: 'unavailable', reason: '钉钉个人数据服务健康检查失败' });
    expect(
      projectDingtalkCapability({
        callsToday: 4,
        configured: true,
        errors10m: 0,
        moduleEnabled: false,
      }),
    ).toMatchObject({ key: 'dingtalk_connector', reason: '钉钉模块未启用', status: 'disabled' });
    expect(
      projectDingtalkPersonalCapability({
        authorizedCount: 3,
        brokerConfigured: true,
        enabled: true,
        healthOk: true,
        moduleEnabled: false,
      }),
    ).toMatchObject({
      key: 'dingtalk_personal',
      reason: '钉钉个人数据模块未启用',
      status: 'disabled',
    });
    expect(
      projectDingtalkPersonalCapability({
        authorizedCount: 12,
        brokerConfigured: true,
        enabled: true,
        healthOk: true,
      }).detail,
    ).toBe('已授权 12 人');
    expect(
      projectDingtalkPersonalCapability({
        authorizedCount: 0,
        brokerConfigured: false,
        enabled: false,
        healthOk: false,
        readFailed: true,
      }).status,
    ).toBe('unknown');
  });

  it('follows isModuleEnabled for known ids and stays on until a new id exists', async () => {
    vi.mocked(isModuleEnabled).mockReset().mockResolvedValue(false);
    await expect(capabilityModuleEnabled('sandbox')).resolves.toBe(false);
    expect(isModuleEnabled).toHaveBeenCalledWith('sandbox');
    vi.mocked(isModuleEnabled).mockClear();
    if (isPlatformModuleId('dingtalk')) {
      await expect(capabilityModuleEnabled('dingtalk')).resolves.toBe(false);
      expect(isModuleEnabled).toHaveBeenCalledWith('dingtalk');
    } else {
      await expect(capabilityModuleEnabled('dingtalk')).resolves.toBe(true);
      expect(isModuleEnabled).not.toHaveBeenCalled();
    }
    if (isPlatformModuleId('dingtalkPersonal')) {
      await expect(capabilityModuleEnabled('dingtalkPersonal')).resolves.toBe(false);
    } else {
      await expect(capabilityModuleEnabled('dingtalkPersonal')).resolves.toBe(true);
    }
    vi.mocked(isModuleEnabled).mockResolvedValue(true);
  });

  it('probes the personal-data broker /healthz with no auth header and a 3s timeout', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(
      probeDingtalkPersonalBroker(
        { DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080/' },
        fetchImpl as typeof fetch,
      ),
    ).resolves.toBe('ok');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://aihub-dws:8080/healthz',
      expect.objectContaining({ method: 'GET' }),
    );
    expect((fetchImpl.mock.calls[0] as unknown[] | undefined)?.[1]).not.toHaveProperty('headers');

    await expect(probeDingtalkPersonalBroker({ DINGTALK_PERSONAL_BROKER_URL: '' })).resolves.toBe(
      'missing',
    );
    await expect(
      probeDingtalkPersonalBroker({ DINGTALK_PERSONAL_BROKER_URL: 'ftp://aihub-dws' }),
    ).resolves.toBe('missing');

    const down = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 }));
    await expect(
      probeDingtalkPersonalBroker(
        { DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080' },
        down as typeof fetch,
      ),
    ).resolves.toBe('down');
    const refused = vi.fn(async () => new Response('no', { status: 503 }));
    await expect(
      probeDingtalkPersonalBroker(
        { DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080' },
        refused as typeof fetch,
      ),
    ).resolves.toBe('down');
  });

  it('treats a broker health check that exceeds 3 seconds as down', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }),
      );
      const pending = probeDingtalkPersonalBroker(
        { DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080' },
        fetchImpl as typeof fetch,
      );
      await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_HEALTH_TIMEOUT_MS);
      await expect(pending).resolves.toBe('down');
    } finally {
      vi.useRealTimers();
    }
  });
});
