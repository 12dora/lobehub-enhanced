import { describe, expect, it, vi } from 'vitest';

import {
  createEnterpriseLookupRuntime,
  ENTERPRISE_LOOKUP_CONTENT_LIMIT,
  ENTERPRISE_LOOKUP_INTERNAL_TOOL_CONTENT,
  formatLookupBody,
  type IEnterpriseLookupService,
} from './index';

const makeService = (
  overrides: Partial<IEnterpriseLookupService> = {},
): IEnterpriseLookupService => ({
  listCapabilities: vi.fn().mockResolvedValue({
    categories: [
      {
        category: 'company',
        tools: [
          { description: 'Search companies', inputSchema: { type: 'object' }, name: 'search' },
        ],
      },
    ],
    provider: 'qcc',
  }),
  query: vi.fn().mockResolvedValue({
    capability: 'search',
    provider: 'qcc',
    result: { name: '示例科技有限公司' },
  }),
  ...overrides,
});

describe('EnterpriseLookupExecutionRuntime', () => {
  it('returns compact listCapabilities JSON with provider guidance', async () => {
    const runtime = createEnterpriseLookupRuntime(makeService());

    const result = await runtime.listCapabilities({ category: 'company', provider: 'qcc' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('数据来源：企查查');
    expect(result.content).toContain('queryEnterprise');
    expect(result.content).toContain('企业名称 · 统一社会信用代码/法定代表人');
    expect(result.content).toContain('"provider":"qcc"');
    expect(result.content).not.toMatch(/\n {2}"/);
    expect(result.state).toMatchObject({
      category: 'company',
      provider: 'qcc',
      success: true,
      toolCount: 1,
      truncated: false,
    });
  });

  it('formats query results as compact JSON and names the provider', async () => {
    const runtime = createEnterpriseLookupRuntime(makeService());

    const result = await runtime.queryEnterprise({
      arguments: { keyword: '示例科技' },
      capability: 'search',
      provider: 'qcc',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('数据来源：企查查');
    expect(result.content).toContain('能力：search');
    expect(result.content).toContain('"name":"示例科技有限公司"');
    expect(result.content).not.toMatch(/\n {2}"/);
    expect(result.state).toMatchObject({
      capability: 'search',
      provider: 'qcc',
      success: true,
      truncated: false,
    });
  });

  it('unwraps MCP text content instead of dumping the envelope', async () => {
    const query = vi.fn().mockResolvedValue({
      capability: 'getDetail',
      provider: 'tianyancha',
      result: { content: [{ text: '# 示例科技\n注册资本 1000万', type: 'text' }] },
    });
    const runtime = createEnterpriseLookupRuntime(makeService({ query }));

    const result = await runtime.queryEnterprise({
      capability: 'getDetail',
      provider: 'tianyancha',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('数据来源：天眼查');
    expect(result.content).toContain('# 示例科技');
    expect(result.content).not.toContain('"type":"text"');
  });

  it('truncates large upstream payloads and says so', async () => {
    const huge = '企'.repeat(ENTERPRISE_LOOKUP_CONTENT_LIMIT + 800);
    const query = vi.fn().mockResolvedValue({ provider: 'qcc', result: huge });
    const runtime = createEnterpriseLookupRuntime(makeService({ query }));

    const result = await runtime.queryEnterprise({ capability: 'search' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ truncated: true });
    expect(result.content).toContain(
      `（结果已截断，仅保留前 ${ENTERPRISE_LOOKUP_CONTENT_LIMIT} 字符）`,
    );
    const body = (result.state as { resultText: string }).resultText;
    expect(body.length).toBe(ENTERPRISE_LOOKUP_CONTENT_LIMIT);
  });

  it.each([
    ['ENTERPRISE_LOOKUP_NOT_CONFIGURED', '企业查询未配置'],
    ['ENTERPRISE_LOOKUP_DAILY_LIMIT', '今日查询次数已达上限'],
    ['ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN', '未知能力'],
    ['ENTERPRISE_LOOKUP_INVALID_ARGUMENTS', '查询参数无效'],
  ] as const)('maps %s to short Chinese guidance', async (code, snippet) => {
    const query = vi.fn().mockRejectedValue({ code, message: 'upstream secret token=abc' });
    const runtime = createEnterpriseLookupRuntime(makeService({ query }));

    const result = await runtime.queryEnterprise({ capability: 'search' });

    expect(result.success).toBe(false);
    expect(result.content).toContain(snippet);
    expect(result.content).toContain(code);
    expect(result.content).not.toContain('token=abc');
    expect(result.error).toMatchObject({ code });
  });

  it('tells the model to re-list on PROVIDER_UNAVAILABLE with fallbackProvider', async () => {
    const query = vi.fn().mockRejectedValue({
      code: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
      fallbackProvider: 'tianyancha',
      message: 'Connection refused 10.0.0.8',
    });
    const runtime = createEnterpriseLookupRuntime(makeService({ query }));

    const result = await runtime.queryEnterprise({ capability: 'search', provider: 'qcc' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE');
    expect(result.content).toContain('天眼查');
    expect(result.content).toContain('tianyancha');
    expect(result.content).toContain('listCapabilities');
    expect(result.content).toContain('仅重试一次');
    expect(result.content).not.toContain('10.0.0.8');
    expect(result.error).toMatchObject({
      code: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
      fallbackProvider: 'tianyancha',
    });
  });

  it('sanitizes unknown errors to an internal failure', async () => {
    const query = vi.fn().mockRejectedValue(new Error('ECONNRESET postgres://user:pass@db/secret'));
    const runtime = createEnterpriseLookupRuntime(makeService({ query }));

    const result = await runtime.queryEnterprise({ capability: 'search' });

    expect(result.success).toBe(false);
    expect(result.content).toBe(ENTERPRISE_LOOKUP_INTERNAL_TOOL_CONTENT);
    expect(result.content).not.toContain('postgres://');
    expect(result.error).toMatchObject({ code: 'ENTERPRISE_LOOKUP_INTERNAL' });
  });

  it('parses fallbackProvider from a CODE:provider TRPC message', async () => {
    const query = vi.fn().mockRejectedValue({
      data: { httpStatus: 400 },
      message: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE:tianyancha',
    });
    const runtime = createEnterpriseLookupRuntime(makeService({ query }));

    const result = await runtime.queryEnterprise({ capability: 'search', provider: 'qcc' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('天眼查');
    expect(result.content).toContain('listCapabilities');
    expect(result.error).toMatchObject({
      code: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
      fallbackProvider: 'tianyancha',
    });
  });

  it('reads fallbackProvider from tRPC data.errorData', async () => {
    const query = vi.fn().mockRejectedValue({
      data: {
        errorData: {
          code: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
          fallbackProvider: 'qcc',
        },
      },
      message: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
    });
    const runtime = createEnterpriseLookupRuntime(makeService({ query }));

    const result = await runtime.queryEnterprise({ capability: 'search' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('企查查');
    expect(result.error).toMatchObject({
      code: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
      fallbackProvider: 'qcc',
    });
  });

  it('reads ENTERPRISE_LOOKUP codes out of TRPC message envelopes', async () => {
    const listCapabilities = vi.fn().mockRejectedValue({
      data: { httpStatus: 400 },
      message: 'ENTERPRISE_LOOKUP_DAILY_LIMIT',
    });
    const runtime = createEnterpriseLookupRuntime(makeService({ listCapabilities }));

    const result = await runtime.listCapabilities({});

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'ENTERPRISE_LOOKUP_DAILY_LIMIT' });
    expect(result.content).toContain('今日查询次数已达上限');
  });
});

describe('formatLookupBody', () => {
  it('joins MCP text parts', () => {
    expect(
      formatLookupBody({
        content: [
          { text: 'alpha', type: 'text' },
          { text: 'beta', type: 'text' },
        ],
      }),
    ).toBe('alpha\nbeta');
  });

  it('compact-stringifies objects', () => {
    expect(formatLookupBody({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });
});
