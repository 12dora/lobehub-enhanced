// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENTERPRISE_LOOKUP_INVALID_ARGUMENTS, EnterpriseLookupServiceError } from './errors';
import {
  buildEnterpriseLookupAuthHeaders,
  buildEnterpriseLookupMcpParams,
  buildEnterpriseLookupMcpUrl,
  callProviderTool,
  classifyEnterpriseLookupProviderError,
  ENTERPRISE_LOOKUP_TOOLS_CACHE_TTL_MS,
  type EnterpriseLookupMcpSession,
  listProviderTools,
  type OpenEnterpriseLookupMcpSession,
  probeProvider,
  QCC_PROBE_CATEGORY,
  resetEnterpriseLookupMcpClientForTest,
  setEnterpriseLookupMcpSessionFactoryForTest,
  TIANYANCHA_CATEGORY,
  TIANYANCHA_MCP_URL,
  TIANYANCHA_PROBE_TOOL,
} from './mcpClient';

afterEach(() => {
  resetEnterpriseLookupMcpClientForTest();
  vi.useRealTimers();
});

const sampleTool = {
  description: 'd',
  inputSchema: { type: 'object' as const },
  name: 'search',
};

const tianyanchaSearchTool = {
  description: 'search companies',
  inputSchema: { type: 'object' as const },
  name: TIANYANCHA_PROBE_TOOL,
};

const streamableHttp401 = (body: string) =>
  Object.assign(new Error(`Streamable HTTP error: Error POSTing to endpoint: ${body}`), {
    code: 401,
  });

const sessionStub = (
  listTools: EnterpriseLookupMcpSession['listTools'],
): EnterpriseLookupMcpSession => ({
  callTool: async () => ({ content: '' }),
  listTools,
});

describe('enterprise lookup MCP client', () => {
  it('builds QCC streamable-HTTP URLs and Bearer headers', () => {
    expect(buildEnterpriseLookupMcpUrl('qcc', 'risk')).toBe(
      'https://agent.qcc.com/mcp/risk/stream',
    );
    expect(buildEnterpriseLookupAuthHeaders('qcc', 'qk')).toEqual({
      Authorization: 'Bearer qk',
    });
    const params = buildEnterpriseLookupMcpParams('qcc', 'company', 'qk-secret');
    expect(params).toMatchObject({
      type: 'http',
      url: 'https://agent.qcc.com/mcp/company/stream',
    });
    expect(params.name).not.toContain('qk-secret');
    expect(JSON.stringify(params.name)).not.toContain('qk-secret');
  });

  it('builds Tianyancha URLs with a raw Authorization header (no Bearer)', () => {
    expect(buildEnterpriseLookupMcpUrl('tianyancha', TIANYANCHA_CATEGORY)).toBe(TIANYANCHA_MCP_URL);
    expect(buildEnterpriseLookupAuthHeaders('tianyancha', 'tyc-key')).toEqual({
      Authorization: 'tyc-key',
    });
  });

  it('strips a stored Bearer prefix so QCC does not send Bearer Bearer', () => {
    expect(buildEnterpriseLookupAuthHeaders('qcc', 'Bearer MMWW')).toEqual({
      Authorization: 'Bearer MMWW',
    });
    expect(buildEnterpriseLookupAuthHeaders('qcc', 'Authorization: Bearer MMWW')).toEqual({
      Authorization: 'Bearer MMWW',
    });
    expect(buildEnterpriseLookupAuthHeaders('qcc', '"Bearer MMWW"')).toEqual({
      Authorization: 'Bearer MMWW',
    });
    expect(buildEnterpriseLookupAuthHeaders('tianyancha', 'Bearer tyc-key')).toEqual({
      Authorization: 'tyc-key',
    });
    expect(buildEnterpriseLookupAuthHeaders('tianyancha', 'Authorization: Bearer tyc-key')).toEqual(
      {
        Authorization: 'tyc-key',
      },
    );
  });

  it('classifies provider failures without exposing upstream text', () => {
    const unauthorized = Object.assign(new Error('MCP 401 invalid api key sk-live'), {
      data: { type: 'AUTHORIZATION_ERROR' },
    });
    expect(classifyEnterpriseLookupProviderError(unauthorized)).toBe('unauthorized');

    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    expect(classifyEnterpriseLookupProviderError(timeout)).toBe('timeout');

    expect(classifyEnterpriseLookupProviderError(new Error('429 quota exceeded'))).toBe(
      'quota_exceeded',
    );
    expect(classifyEnterpriseLookupProviderError(new Error('connect ECONNREFUSED'))).toBe(
      'unreachable',
    );
    expect(classifyEnterpriseLookupProviderError(new Error('502 Bad Gateway'))).toBe('unreachable');
    expect(classifyEnterpriseLookupProviderError(new Error('503 Service Unavailable'))).toBe(
      'unreachable',
    );
    expect(classifyEnterpriseLookupProviderError(new Error('500 Internal Server Error'))).toBe(
      'unreachable',
    );
    expect(classifyEnterpriseLookupProviderError(new Error('weird'))).toBe('internal');

    expect(classifyEnterpriseLookupProviderError(new Error('HTTP 401'))).toBe('unauthorized');
    expect(classifyEnterpriseLookupProviderError(new Error('Unauthorized'))).toBe('unauthorized');
    expect(classifyEnterpriseLookupProviderError(new Error('account_error'))).toBe('unauthorized');
    expect(classifyEnterpriseLookupProviderError(new Error('tyc error 300009: 账号信息有误'))).toBe(
      'unauthorized',
    );
    expect(
      classifyEnterpriseLookupProviderError(
        streamableHttp401(
          '{"error":"account_error","error_description":"tyc error 300009: 账号信息有误","tyc_error_code":300009}',
        ),
      ),
    ).toBe('unauthorized');
    expect(
      classifyEnterpriseLookupProviderError(
        Object.assign(new Error('Streamable HTTP error: Error POSTing to endpoint: {}'), {
          code: 401,
        }),
      ),
    ).toBe('unauthorized');
    expect(
      classifyEnterpriseLookupProviderError({
        content: [{ text: '{"error":"account_error"}', type: 'text' }],
        isError: true,
      }),
    ).toBe('unauthorized');
  });

  it('probeProvider maps session failures to stable reasons and never returns the key', async () => {
    expect(await probeProvider('qcc', '')).toEqual({ ok: false, reason: 'not_configured' });

    setEnterpriseLookupMcpSessionFactoryForTest(async () => {
      throw Object.assign(new Error('401 Bearer sk-secret'), {
        data: { type: 'AUTHORIZATION_ERROR' },
      });
    });
    const result = await probeProvider('qcc', 'sk-secret');
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });

  it('probeProvider returns toolCount after initialize + tools/list', async () => {
    const callTool = vi.fn(async () => ({ content: '' }));
    const disconnect = vi.fn();
    setEnterpriseLookupMcpSessionFactoryForTest(async ({ category, provider }) => {
      expect(provider).toBe('qcc');
      expect(category).toBe(QCC_PROBE_CATEGORY);
      return {
        callTool,
        disconnect,
        listTools: async () => [
          { description: 'search', inputSchema: { type: 'object' as const }, name: 'search' },
        ],
      };
    });
    await expect(probeProvider('qcc', 'k')).resolves.toEqual({ ok: true, toolCount: 1 });
    expect(callTool).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it('listProviderTools caches per provider+category+key fingerprint for 10 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00.000Z'));
    const listTools = vi.fn(async () => [sampleTool]);
    setEnterpriseLookupMcpSessionFactoryForTest(async () => sessionStub(listTools));

    const first = await listProviderTools('qcc', 'company', 'k');
    const second = await listProviderTools('qcc', 'company', 'k');
    expect(first).toEqual([{ description: 'd', inputSchema: { type: 'object' }, name: 'search' }]);
    expect(second).toEqual(first);
    expect(listTools).toHaveBeenCalledTimes(1);

    vi.setSystemTime(
      new Date('2026-09-21T00:00:00.000Z').getTime() + ENTERPRISE_LOOKUP_TOOLS_CACHE_TTL_MS + 1,
    );
    await listProviderTools('qcc', 'company', 'k');
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it('does not cache an empty tools/list result', async () => {
    const listTools = vi.fn(async () => []);
    setEnterpriseLookupMcpSessionFactoryForTest(async () => sessionStub(listTools));
    await expect(listProviderTools('qcc', 'company', 'k')).resolves.toEqual([]);
    await expect(listProviderTools('qcc', 'company', 'k')).resolves.toEqual([]);
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it('does not cache a tools/list failure', async () => {
    const listTools = vi
      .fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce([sampleTool]);
    setEnterpriseLookupMcpSessionFactoryForTest(async () => sessionStub(listTools));
    await expect(listProviderTools('qcc', 'company', 'k')).rejects.toThrow('503');
    await expect(listProviderTools('qcc', 'company', 'k')).resolves.toHaveLength(1);
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a tools cache entry across API keys', async () => {
    const listTools = vi.fn(async () => [sampleTool]);
    setEnterpriseLookupMcpSessionFactoryForTest(async () => sessionStub(listTools));
    await listProviderTools('qcc', 'company', 'key-a');
    await listProviderTools('qcc', 'company', 'key-b');
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it('probeProvider reports unreachable when tools/list fails after initialize', async () => {
    setEnterpriseLookupMcpSessionFactoryForTest(async () =>
      sessionStub(async () => {
        throw new Error('503 Service Unavailable');
      }),
    );
    await expect(probeProvider('qcc', 'k')).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('probeProvider reports unreachable when tools/list returns an empty list', async () => {
    setEnterpriseLookupMcpSessionFactoryForTest(async () => sessionStub(async () => []));
    await expect(probeProvider('qcc', 'k')).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
      toolCount: 0,
    });
  });

  it('rejects non-enum QCC categories before opening a session', async () => {
    const open = vi.fn<OpenEnterpriseLookupMcpSession>();
    setEnterpriseLookupMcpSessionFactoryForTest(open);
    await expect(listProviderTools('qcc', '../other', 'k')).rejects.toMatchObject({
      code: ENTERPRISE_LOOKUP_INVALID_ARGUMENTS,
    });
    expect(open).not.toHaveBeenCalled();
    expect(() => buildEnterpriseLookupMcpUrl('qcc', '../other')).toThrow(
      EnterpriseLookupServiceError,
    );
  });

  it('probeProvider reports unauthorized when Tianyancha rejects a bad key on tools/call', async () => {
    const callTool = vi.fn(async () => {
      throw streamableHttp401(
        '{"error":"account_error","error_description":"tyc error 300009: 账号信息有误","tyc_error_code":300009}',
      );
    });
    const disconnect = vi.fn();
    setEnterpriseLookupMcpSessionFactoryForTest(async ({ category, provider }) => {
      expect(provider).toBe('tianyancha');
      expect(category).toBe(TIANYANCHA_CATEGORY);
      return {
        callTool,
        disconnect,
        listTools: async () => [tianyanchaSearchTool],
      };
    });
    const result = await probeProvider('tianyancha', 'bad-tyc-key');
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(JSON.stringify(result)).not.toContain('bad-tyc-key');
    expect(JSON.stringify(result)).not.toContain('account_error');
    expect(JSON.stringify(result)).not.toContain('账号信息有误');
    expect(callTool).toHaveBeenCalledWith(TIANYANCHA_PROBE_TOOL, {
      query: 'aihub-connection-probe-7f3a9c',
      page: 1,
      page_size: 1,
    });
    expect(disconnect).toHaveBeenCalled();
  });

  it('probeProvider reports unauthorized when Tianyancha returns isError account_error', async () => {
    setEnterpriseLookupMcpSessionFactoryForTest(async () => ({
      callTool: async () => ({
        content: [
          {
            text: '{"error":"account_error","error_description":"tyc error 300009: 账号信息有误"}',
            type: 'text',
          },
        ],
        isError: true,
      }),
      listTools: async () => [tianyanchaSearchTool],
    }));
    const result = await probeProvider('tianyancha', 'bad-tyc-key');
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(JSON.stringify(result)).not.toContain('bad-tyc-key');
    expect(JSON.stringify(result)).not.toContain('account_error');
  });

  it('probeProvider treats a Tianyancha empty search result as a valid key', async () => {
    const callTool = vi.fn(async () => ({ content: [], isError: false }));
    const disconnect = vi.fn();
    setEnterpriseLookupMcpSessionFactoryForTest(async () => ({
      callTool,
      disconnect,
      listTools: async () => [tianyanchaSearchTool, sampleTool],
    }));
    const result = await probeProvider('tianyancha', 'good-tyc-key');
    expect(result).toEqual({ ok: true, toolCount: 2 });
    expect(JSON.stringify(result)).not.toContain('good-tyc-key');
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it('probeProvider skips the Tianyancha auth call when search_companies is absent', async () => {
    const callTool = vi.fn(async () => ({ content: '' }));
    setEnterpriseLookupMcpSessionFactoryForTest(async () => ({
      callTool,
      listTools: async () => [sampleTool],
    }));
    await expect(probeProvider('tianyancha', 'k')).resolves.toEqual({ ok: true, toolCount: 1 });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('probeProvider accepts a Tianyancha key when tools/call isError is not auth or quota', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ text: 'no matching companies', type: 'text' }],
      isError: true,
    }));
    setEnterpriseLookupMcpSessionFactoryForTest(async () => ({
      callTool,
      listTools: async () => [tianyanchaSearchTool],
    }));
    await expect(probeProvider('tianyancha', 'k')).resolves.toEqual({ ok: true, toolCount: 1 });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('probeProvider maps a Tianyancha quota error from tools/call', async () => {
    setEnterpriseLookupMcpSessionFactoryForTest(async () => ({
      callTool: async () => {
        throw new Error('429 quota exceeded');
      },
      listTools: async () => [tianyanchaSearchTool],
    }));
    await expect(probeProvider('tianyancha', 'k')).resolves.toEqual({
      ok: false,
      reason: 'quota_exceeded',
    });
  });

  it('callProviderTool forwards name and arguments', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ text: '{"ok":true}', type: 'text' }],
      isError: false,
    }));
    setEnterpriseLookupMcpSessionFactoryForTest(async () => ({
      callTool,
      listTools: async () => [],
    }));
    const result = await callProviderTool('tianyancha', 'default', 'k', 'search', {
      keyword: '华为',
    });
    expect(callTool).toHaveBeenCalledWith('search', { keyword: '华为' });
    expect(result.isError).toBe(false);
  });
});
