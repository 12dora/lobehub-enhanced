// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnterpriseLookupMcpClient from './mcpClient';

const mockGetRuntimeConfig = vi.fn();
const mockGetDailyTotal = vi.fn();
const mockIncrement = vi.fn();
const mockReserve = vi.fn();
const mockRelease = vi.fn();
const mockAuditAppend = vi.fn();
const mockListProviderTools = vi.fn();
const mockCallProviderTool = vi.fn();

vi.mock('./settings', () => ({
  getEnterpriseLookupRuntimeConfig: (...args: unknown[]) => mockGetRuntimeConfig(...args),
}));

vi.mock('@/database/models/enterpriseLookupUsage', () => ({
  EnterpriseLookupUsageModel: vi.fn(() => ({
    getDailyTotal: mockGetDailyTotal,
    increment: mockIncrement,
    release: mockRelease,
    reserve: mockReserve,
  })),
}));

vi.mock('@/server/enterprise/services/platformAudit', () => ({
  PlatformAuditService: vi.fn(() => ({
    append: mockAuditAppend,
  })),
}));

vi.mock('./mcpClient', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof EnterpriseLookupMcpClient;
  return {
    ...actual,
    callProviderTool: (...args: unknown[]) => mockCallProviderTool(...args),
    listProviderTools: (...args: unknown[]) => mockListProviderTools(...args),
  };
});

const {
  ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN,
  ENTERPRISE_LOOKUP_DAILY_LIMIT,
  ENTERPRISE_LOOKUP_INTERNAL,
  ENTERPRISE_LOOKUP_NOT_CONFIGURED,
  ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
  EnterpriseLookupService,
  EnterpriseLookupServiceError,
  isConfigured,
  resetEnterpriseLookupHealthForTest,
  shanghaiUsageDate,
} = await import('./index');

const qccConfig = {
  defaultProvider: 'qcc' as const,
  fallbackEnabled: true,
  dailyLimitPerUser: 50,
  qcc: { apiKey: 'qk-secret', categories: ['company', 'risk'] as const },
  tianyancha: { apiKey: 'tk-secret' },
};

afterEach(() => {
  resetEnterpriseLookupHealthForTest();
  vi.useRealTimers();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockGetRuntimeConfig.mockResolvedValue(qccConfig);
  mockGetDailyTotal.mockResolvedValue(0);
  mockIncrement.mockResolvedValue(1);
  mockReserve.mockResolvedValue(true);
  mockRelease.mockResolvedValue(undefined);
  mockAuditAppend.mockResolvedValue({});
  mockListProviderTools.mockResolvedValue([
    { description: 'search companies', inputSchema: { type: 'object' }, name: 'search' },
  ]);
  mockCallProviderTool.mockResolvedValue({
    content: [{ text: '{"name":"华为"}', type: 'text' }],
    isError: false,
  });
});

describe('shanghaiUsageDate', () => {
  it('formats the Asia/Shanghai calendar day', () => {
    // 2026-09-21 23:30 UTC === 2026-09-22 07:30 Asia/Shanghai
    expect(shanghaiUsageDate(new Date('2026-09-21T23:30:00.000Z'))).toBe('2026-09-22');
    // 2026-09-21 15:30 UTC === 2026-09-21 23:30 Asia/Shanghai
    expect(shanghaiUsageDate(new Date('2026-09-21T15:30:00.000Z'))).toBe('2026-09-21');
  });
});

describe('EnterpriseLookupService', () => {
  const service = () => new EnterpriseLookupService({} as never, 'user-1');

  it('isConfigured is false when runtime config is null', async () => {
    mockGetRuntimeConfig.mockResolvedValueOnce(null);
    await expect(isConfigured()).resolves.toBe(false);
  });

  it('status reports remaining quota without secrets', async () => {
    mockGetDailyTotal.mockResolvedValueOnce(3);
    const status = await service().status();
    expect(status).toEqual({
      configured: true,
      dailyLimitPerUser: 50,
      defaultProvider: 'qcc',
      fallbackEnabled: true,
      remaining: 47,
      usedToday: 3,
    });
    expect(JSON.stringify(status)).not.toContain('qk-secret');
  });

  it('listCapabilities uses the default provider and enabled categories', async () => {
    const result = await service().listCapabilities();
    expect(result.provider).toBe('qcc');
    expect(result.categories.map((item) => item.category)).toEqual(['company', 'risk']);
    expect(mockListProviderTools).toHaveBeenCalledWith('qcc', 'company', 'qk-secret');
  });

  it('query enforces the daily limit before calling upstream', async () => {
    mockReserve.mockResolvedValueOnce(false);
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({ code: ENTERPRISE_LOOKUP_DAILY_LIMIT });
    expect(mockCallProviderTool).not.toHaveBeenCalled();
    expect(mockReserve).toHaveBeenCalledWith('user-1', shanghaiUsageDate(), 'qcc', 50);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('query reserves usage and writes a redacted audit event only after success', async () => {
    const result = await service().query({
      arguments: { keyword: '华为', extra: 'ignored' },
      capability: 'search',
    });
    expect(result).toMatchObject({
      capability: 'search',
      category: 'company',
      content: '{"name":"华为"}',
      provider: 'qcc',
    });
    expect(mockReserve).toHaveBeenCalledWith('user-1', shanghaiUsageDate(), 'qcc', 50);
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enterprise_lookup.query',
        actorUserId: 'user-1',
        afterDiff: { capability: 'search', companyKeyword: '华为', provider: 'qcc' },
        targetId: 'qcc/search',
        targetType: 'system',
      }),
    );
    const auditPayload = mockAuditAppend.mock.calls[0][0];
    expect(JSON.stringify(auditPayload)).not.toContain('qk-secret');
    expect(JSON.stringify(auditPayload)).not.toContain('ignored');
  });

  it('does not keep the reservation when the upstream call fails', async () => {
    mockCallProviderTool.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({
      code: ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
      fallbackProvider: 'tianyancha',
    });
    expect(mockReserve).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith('user-1', shanghaiUsageDate(), 'qcc');
    expect(mockAuditAppend).not.toHaveBeenCalled();
  });

  it('releases against the reserved Shanghai date when the vendor call crosses midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T15:59:30.000Z')); // 23:59:30 Asia/Shanghai
    mockCallProviderTool.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-09-21T16:00:05.000Z')); // 00:00:05 next day
      throw new Error('connect ECONNREFUSED');
    });
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({ code: ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE });
    expect(mockReserve).toHaveBeenCalledWith('user-1', '2026-09-21', 'qcc', 50);
    expect(mockRelease).toHaveBeenCalledWith('user-1', '2026-09-21', 'qcc');
    expect(mockRelease).not.toHaveBeenCalledWith('user-1', '2026-09-22', 'qcc');
  });

  it('retries a failed reservation release once', async () => {
    mockCallProviderTool.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    mockRelease.mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(undefined);
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({ code: ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE });
    expect(mockRelease).toHaveBeenCalledTimes(2);
    expect(mockRelease).toHaveBeenNthCalledWith(1, 'user-1', shanghaiUsageDate(), 'qcc');
    expect(mockRelease).toHaveBeenNthCalledWith(2, 'user-1', shanghaiUsageDate(), 'qcc');
  });

  it('still throws the vendor error when release fails twice', async () => {
    mockCallProviderTool.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    mockRelease.mockRejectedValue(new Error('db'));
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({ code: ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE });
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  it('releases the reservation and maps MCP isError to INTERNAL', async () => {
    mockCallProviderTool.mockResolvedValueOnce({
      content: [{ text: 'invalid company id', type: 'text' }],
      isError: true,
    });
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({ code: ENTERPRISE_LOOKUP_INTERNAL });
    expect(mockReserve).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith('user-1', shanghaiUsageDate(), 'qcc');
    expect(mockAuditAppend).not.toHaveBeenCalled();
  });

  it('accepts omitted arguments as an empty object', async () => {
    await expect(service().query({ capability: 'search' })).resolves.toMatchObject({
      capability: 'search',
      provider: 'qcc',
    });
    expect(mockCallProviderTool).toHaveBeenCalledWith('qcc', 'company', 'qk-secret', 'search', {});
  });

  it('skips an unhealthy default provider when no explicit provider is given', async () => {
    mockCallProviderTool.mockRejectedValueOnce(new Error('401 unauthorized'));
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toBeInstanceOf(EnterpriseLookupServiceError);

    mockListProviderTools.mockResolvedValue([
      { description: 'tyc search', inputSchema: { type: 'object' }, name: 'search' },
    ]);
    mockCallProviderTool.mockResolvedValueOnce({
      content: [{ text: 'ok', type: 'text' }],
    });
    const result = await service().query({
      arguments: { keyword: '华为' },
      capability: 'search',
    });
    expect(result.provider).toBe('tianyancha');
    expect(mockCallProviderTool).toHaveBeenLastCalledWith(
      'tianyancha',
      'default',
      'tk-secret',
      'search',
      { keyword: '华为' },
    );
  });

  it('rejects unknown capabilities and empty config', async () => {
    mockListProviderTools.mockResolvedValue([]);
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'missing' }),
    ).rejects.toMatchObject({ code: ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN });
    expect(mockReserve).not.toHaveBeenCalled();

    mockGetRuntimeConfig.mockResolvedValueOnce(null);
    await expect(service().listCapabilities()).rejects.toMatchObject({
      code: ENTERPRISE_LOOKUP_NOT_CONFIGURED,
    });
  });

  it('treats vendor 5xx as unavailable so fallback can run', async () => {
    mockCallProviderTool.mockRejectedValueOnce(new Error('502 Bad Gateway'));
    await expect(
      service().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({
      code: ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
      fallbackProvider: 'tianyancha',
    });
    expect(mockRelease).toHaveBeenCalled();
  });
});
