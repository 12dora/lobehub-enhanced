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
  ENTERPRISE_LOOKUP_INVALID_ARGUMENTS,
  ENTERPRISE_LOOKUP_NOT_CONFIGURED,
  ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
  EnterpriseLookupService,
  EnterpriseLookupServiceError,
  isConfigured,
  parseEnterpriseLookupCompanyCandidates,
  pickUniqueCompanyCandidate,
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

/** Live Tianyancha `search_companies` shape: guidance blockquote then a markdown table. */
const TIANYANCHA_SEARCH_MARKDOWN_FIXTURE = [
  '> 后续调用建议：如需进一步查询这些后续公司的详细信息，请使用 get_company_basic_profile，并将 company_name 设为上表中的公司名称。',
  '',
  '| 企业名称 | 统一社会信用代码 | 法定代表人 | 经营状态 | company_id |',
  '| --- | --- | --- | --- | --- |',
  '| 浙江捷发科技股份有限公司 | 91330600597214350R | 邵国标 | 存续 | 2319755677 |',
  '| 南京捷发科技有限公司 | 91320102736064154F | 王伟 | 存续 | 2319755678 |',
].join('\n');

describe('parseEnterpriseLookupCompanyCandidates', () => {
  it('reads QCC Result.Data rows', () => {
    const candidates = parseEnterpriseLookupCompanyCandidates(
      JSON.stringify({
        Result: {
          Data: [
            {
              CreditCode: '914403001922038216',
              Name: '华为技术有限公司',
              OperName: '赵明路',
              Status: '存续',
            },
          ],
        },
      }),
    );
    expect(candidates).toEqual([
      {
        creditCode: '914403001922038216',
        legalPerson: '赵明路',
        name: '华为技术有限公司',
        status: '存续',
      },
    ]);
  });

  it('falls back to markdown/text company lines', () => {
    const candidates = parseEnterpriseLookupCompanyCandidates(
      '已用 **天眼查** 检索「捷发科技」。\n1. **浙江捷发科技股份有限公司** · 91330600597214350R / 邵国标\n2. 杭州捷发科技有限公司 · 91330000700000000X',
    );
    expect(candidates.map((item) => item.name)).toEqual([
      '浙江捷发科技股份有限公司',
      '杭州捷发科技有限公司',
    ]);
    expect(candidates[0]?.creditCode).toBe('91330600597214350R');
  });

  it('prefers Tianyancha markdown table rows and ignores guidance prose', () => {
    const candidates = parseEnterpriseLookupCompanyCandidates(TIANYANCHA_SEARCH_MARKDOWN_FIXTURE);
    expect(candidates).toEqual([
      {
        creditCode: '91330600597214350R',
        legalPerson: '邵国标',
        name: '浙江捷发科技股份有限公司',
        status: '存续',
      },
      {
        creditCode: '91320102736064154F',
        legalPerson: '王伟',
        name: '南京捷发科技有限公司',
        status: '存续',
      },
    ]);
    expect(candidates.map((item) => item.name)).not.toContain('这些后续公司');
  });

  it('maps markdown table columns by header aliases', () => {
    const candidates = parseEnterpriseLookupCompanyCandidates(
      [
        '| 公司名称 | 信用代码 | 法人 | 状态 | id |',
        '| --- | --- | --- | --- | --- |',
        '| 杭州捷发科技有限公司 | 91330000700000000X | 张三 | 注销 | 99 |',
      ].join('\n'),
    );
    expect(candidates).toEqual([
      {
        creditCode: '91330000700000000X',
        legalPerson: '张三',
        name: '杭州捷发科技有限公司',
        status: '注销',
      },
    ]);
  });

  it('ignores blockquotes, headings, list-marker prose and sentence fragments', () => {
    const candidates = parseEnterpriseLookupCompanyCandidates(
      [
        '> 后续调用建议：请使用 get_company_basic_profile 查询这些后续公司',
        '# 候选企业',
        '- 建议调用 search_companies 获取这些后续公司',
        '1. 请使用 get_company_basic_profile 查询这些后续公司的详情',
        '请先核验浙江捷发科技股份有限公司是否为同一主体。',
        '这些后续公司',
      ].join('\n'),
    );
    expect(candidates).toEqual([]);
  });

  it('picks the unique exact-name candidate among several', () => {
    const unique = pickUniqueCompanyCandidate(
      [
        { creditCode: '1', legalPerson: '甲', name: '杭州捷发科技有限公司', status: '存续' },
        { creditCode: '2', legalPerson: '乙', name: '浙江捷发科技股份有限公司', status: '存续' },
      ],
      '浙江捷发科技股份有限公司',
    );
    expect(unique?.creditCode).toBe('2');
    expect(
      pickUniqueCompanyCandidate(
        [{ name: '杭州捷发科技有限公司' }, { name: '浙江捷发科技股份有限公司' }],
        '捷发科技',
      ),
    ).toBeUndefined();
  });

  it('keeps same-name JSON rows that differ by legal person when credit codes are missing', () => {
    const candidates = parseEnterpriseLookupCompanyCandidates(
      JSON.stringify({
        items: [
          { Name: '某某有限公司', OperName: '甲', Status: '存续' },
          { Name: '某某有限公司', OperName: '乙', Status: '存续' },
        ],
      }),
    );
    expect(candidates).toEqual([
      { legalPerson: '甲', name: '某某有限公司', status: '存续' },
      { legalPerson: '乙', name: '某某有限公司', status: '存续' },
    ]);
  });

  it('keeps same-name markdown rows that differ by credit code', () => {
    const candidates = parseEnterpriseLookupCompanyCandidates(
      '1. 某某有限公司 · 91330000111111111X\n2. 某某有限公司 · 91330000222222222Y',
    );
    expect(candidates).toHaveLength(2);
    expect(candidates.map((item) => item.creditCode)).toEqual([
      '91330000111111111X',
      '91330000222222222Y',
    ]);
  });

  it('does not treat a single inexact candidate as unique', () => {
    expect(
      pickUniqueCompanyCandidate([{ creditCode: '1', name: '华为技术有限公司' }], '华为'),
    ).toBeUndefined();
  });

  it('does not auto-pick when several rows share the exact name', () => {
    expect(
      pickUniqueCompanyCandidate(
        [
          { creditCode: '1', legalPerson: '甲', name: '某某有限公司' },
          { creditCode: '2', legalPerson: '乙', name: '某某有限公司' },
        ],
        '某某有限公司',
      ),
    ).toBeUndefined();
  });
});

describe('EnterpriseLookupService.companyProfile', () => {
  const service = () => new EnterpriseLookupService({} as never, 'user-1');

  beforeEach(() => {
    mockListProviderTools.mockImplementation(async (provider: string) => {
      if (provider === 'tianyancha') {
        return [
          { description: 'search', inputSchema: { type: 'object' }, name: 'search_companies' },
          {
            description: 'basic',
            inputSchema: { type: 'object' },
            name: 'get_company_basic_profile',
          },
        ];
      }
      return [
        { description: 'search', inputSchema: { type: 'object' }, name: 'get_company_by_query' },
        {
          description: 'basic',
          inputSchema: { type: 'object' },
          name: 'get_company_registration_info',
        },
      ];
    });
  });

  it('rejects an empty name without calling upstream', async () => {
    await expect(service().companyProfile({ name: '  ' })).rejects.toMatchObject({
      code: ENTERPRISE_LOOKUP_INVALID_ARGUMENTS,
    });
    expect(mockCallProviderTool).not.toHaveBeenCalled();
  });

  it('rejects unknown aspects without calling upstream', async () => {
    await expect(
      service().companyProfile({ aspects: ['tender' as 'basic'], name: '华为技术有限公司' }),
    ).rejects.toMatchObject({ code: ENTERPRISE_LOOKUP_INVALID_ARGUMENTS });
    expect(mockCallProviderTool).not.toHaveBeenCalled();
  });

  it('searches QCC then fetches registration info for a unique match', async () => {
    mockCallProviderTool.mockImplementation(async (_provider, _category, _key, capability) => {
      if (capability === 'get_company_by_query') {
        return {
          content: [
            {
              text: JSON.stringify({
                Result: {
                  Data: [
                    {
                      CreditCode: '914403001922038216',
                      Name: '华为技术有限公司',
                      OperName: '赵明路',
                      Status: '存续',
                    },
                  ],
                },
              }),
              type: 'text',
            },
          ],
          isError: false,
        };
      }
      return {
        content: [
          { text: '{"Name":"华为技术有限公司","RegistCapi":"4032711万人民币"}', type: 'text' },
        ],
        isError: false,
      };
    });

    const result = await service().companyProfile({ name: '华为技术有限公司' });
    expect(result).toMatchObject({
      match: 'unique',
      provider: 'qcc',
      query: '华为技术有限公司',
    });
    expect(result.candidates).toEqual([
      {
        creditCode: '914403001922038216',
        legalPerson: '赵明路',
        name: '华为技术有限公司',
        status: '存续',
      },
    ]);
    expect(result.profile).toContain('4032711');
    expect(mockCallProviderTool).toHaveBeenCalledTimes(2);
    expect(mockCallProviderTool).toHaveBeenNthCalledWith(
      1,
      'qcc',
      'company',
      'qk-secret',
      'get_company_by_query',
      { searchKey: '华为技术有限公司' },
    );
    expect(mockCallProviderTool).toHaveBeenNthCalledWith(
      2,
      'qcc',
      'company',
      'qk-secret',
      'get_company_registration_info',
      { searchKey: '914403001922038216' },
    );
    expect(mockReserve).toHaveBeenCalledTimes(2);
    expect(mockAuditAppend).toHaveBeenCalledTimes(2);
  });

  it('parses Tianyancha markdown search results without guidance-prose names', async () => {
    mockCallProviderTool.mockResolvedValueOnce({
      content: [{ text: TIANYANCHA_SEARCH_MARKDOWN_FIXTURE, type: 'text' }],
      isError: false,
    });

    const result = await service().companyProfile({
      name: '捷发科技',
      provider: 'tianyancha',
    });
    expect(result.match).toBe('ambiguous');
    expect(result.candidates).toEqual([
      {
        creditCode: '91330600597214350R',
        legalPerson: '邵国标',
        name: '浙江捷发科技股份有限公司',
        status: '存续',
      },
      {
        creditCode: '91320102736064154F',
        legalPerson: '王伟',
        name: '南京捷发科技有限公司',
        status: '存续',
      },
    ]);
    expect(result.profile).toBeUndefined();
    expect(mockCallProviderTool).toHaveBeenCalledTimes(1);
  });

  it('returns candidates and does not fetch a profile when several names match', async () => {
    mockCallProviderTool.mockResolvedValueOnce({
      content: [
        {
          text: JSON.stringify({
            items: [
              {
                creditCode: '91330600597214350R',
                legalPersonName: '邵国标',
                name: '浙江捷发科技股份有限公司',
                regStatus: '存续',
              },
              {
                creditCode: '91330000XXXX',
                legalPersonName: '张三',
                name: '杭州捷发科技有限公司',
                regStatus: '存续',
              },
            ],
          }),
          type: 'text',
        },
      ],
      isError: false,
    });

    const result = await service().companyProfile({
      name: '捷发科技',
      provider: 'tianyancha',
    });
    expect(result.match).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
    expect(result.profile).toBeUndefined();
    expect(mockCallProviderTool).toHaveBeenCalledTimes(1);
    expect(mockCallProviderTool).toHaveBeenCalledWith(
      'tianyancha',
      'default',
      'tk-secret',
      'search_companies',
      { page: 1, page_size: 5, query: '捷发科技' },
    );
  });

  it('fetches Tianyancha basic profile when one candidate name equals the input', async () => {
    mockCallProviderTool.mockImplementation(async (_provider, _category, _key, capability) => {
      if (capability === 'search_companies') {
        return {
          content: [
            {
              text: JSON.stringify({
                items: [
                  {
                    creditCode: 'A',
                    legalPersonName: '甲',
                    name: '杭州捷发科技有限公司',
                    regStatus: '存续',
                  },
                  {
                    creditCode: '91330600597214350R',
                    legalPersonName: '邵国标',
                    name: '浙江捷发科技股份有限公司',
                    regStatus: '存续',
                  },
                ],
              }),
              type: 'text',
            },
          ],
          isError: false,
        };
      }
      return {
        content: [
          { text: '{"name":"浙江捷发科技股份有限公司","regCapital":"5000万"}', type: 'text' },
        ],
        isError: false,
      };
    });

    const result = await service().companyProfile({
      name: '浙江捷发科技股份有限公司',
      provider: 'tianyancha',
    });
    expect(result.match).toBe('unique');
    expect(mockCallProviderTool).toHaveBeenNthCalledWith(
      2,
      'tianyancha',
      'default',
      'tk-secret',
      'get_company_basic_profile',
      { company_name: '浙江捷发科技股份有限公司' },
    );
  });

  it('returns ambiguous when two legal entities share the registered name', async () => {
    mockCallProviderTool.mockResolvedValueOnce({
      content: [
        {
          text: JSON.stringify({
            Result: {
              Data: [
                { Name: '某某有限公司', OperName: '甲', Status: '存续' },
                { Name: '某某有限公司', OperName: '乙', Status: '存续' },
              ],
            },
          }),
          type: 'text',
        },
      ],
      isError: false,
    });

    const result = await service().companyProfile({ name: '某某有限公司' });
    expect(result.match).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
    expect(result.profile).toBeUndefined();
    expect(mockCallProviderTool).toHaveBeenCalledTimes(1);
    expect(mockReserve).toHaveBeenCalledTimes(1);
  });

  it('keeps a unique search hit when the basic profile hits the daily limit', async () => {
    mockReserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockCallProviderTool.mockImplementation(async (_provider, _category, _key, capability) => {
      if (capability === 'get_company_by_query') {
        return {
          content: [
            {
              text: JSON.stringify({
                Result: {
                  Data: [
                    {
                      CreditCode: '914403001922038216',
                      Name: '华为技术有限公司',
                      OperName: '赵明路',
                      Status: '存续',
                    },
                  ],
                },
              }),
              type: 'text',
            },
          ],
          isError: false,
        };
      }
      throw new Error('basic profile must not be called after quota exhaustion');
    });

    const result = await service().companyProfile({ name: '华为技术有限公司' });
    expect(result).toMatchObject({
      match: 'unique',
      note: '今日查询次数已达上限，未拉取工商基本信息。',
      provider: 'qcc',
      query: '华为技术有限公司',
    });
    expect(result.profile).toBeUndefined();
    expect(result.candidates).toEqual([
      {
        creditCode: '914403001922038216',
        legalPerson: '赵明路',
        name: '华为技术有限公司',
        status: '存续',
      },
    ]);
    expect(mockCallProviderTool).toHaveBeenCalledTimes(1);
    expect(mockReserve).toHaveBeenCalledTimes(2);
    expect(mockAuditAppend).toHaveBeenCalledTimes(1);
  });

  it('still throws when the search itself hits the daily limit', async () => {
    mockReserve.mockResolvedValueOnce(false);
    await expect(service().companyProfile({ name: '华为技术有限公司' })).rejects.toMatchObject({
      code: ENTERPRISE_LOOKUP_DAILY_LIMIT,
    });
    expect(mockCallProviderTool).not.toHaveBeenCalled();
  });
});
