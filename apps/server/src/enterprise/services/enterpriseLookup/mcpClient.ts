import { createHash } from 'node:crypto';

import type { MCPClientParams, McpTool } from '@/libs/mcp';
import { MCPClient } from '@/libs/mcp';
import { SafeOutboundHttpClient } from '@/server/enterprise/security/outboundHttp';
import { createEgressSafeOutboundTransport } from '@/server/enterprise/services/networkProxy/egress/safeOutboundTransport';
import {
  type EnterpriseLookupProvider,
  QCC_CATEGORIES,
  type QccCategory,
} from '@/types/platform/enterpriseLookup';

import {
  ENTERPRISE_LOOKUP_INVALID_ARGUMENTS,
  type EnterpriseLookupProbeReason,
  EnterpriseLookupServiceError,
} from './errors';

export { QCC_CATEGORIES };

export const QCC_MCP_BASE_URL = 'https://agent.qcc.com/mcp';
export const TIANYANCHA_MCP_URL = 'https://mcp.tianyancha.com/v1';
export const TIANYANCHA_CATEGORY = 'default';
export const QCC_PROBE_CATEGORY: QccCategory = 'company';
/** Tianyancha authenticates on tools/call, not initialize / tools/list. */
export const TIANYANCHA_PROBE_TOOL = 'search_companies';
/** Unique empty query: Tianyancha does not bill error or no-result calls. */
export const TIANYANCHA_PROBE_ARGUMENTS: Record<string, unknown> = {
  query: 'aihub-connection-probe-7f3a9c',
  page: 1,
  page_size: 1,
};

export const ENTERPRISE_LOOKUP_PROBE_TIMEOUT_MS = 10_000;
export const ENTERPRISE_LOOKUP_CALL_TIMEOUT_MS = 60_000;
/** tools/list cache TTL. Capped at 10 minutes so a rotated API key is observed without a restart. */
export const ENTERPRISE_LOOKUP_TOOLS_CACHE_TTL_MS = 10 * 60 * 1000;

export interface EnterpriseLookupToolDescriptor {
  description: string;
  inputSchema: unknown;
  name: string;
}

export interface EnterpriseLookupProbeResult {
  ok: boolean;
  reason?: EnterpriseLookupProbeReason;
  toolCount?: number;
}

export interface EnterpriseLookupToolCallResult {
  content: unknown;
  isError?: boolean;
}

export interface EnterpriseLookupMcpSession {
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<EnterpriseLookupToolCallResult>;
  disconnect?: () => Promise<void>;
  listTools: () => Promise<McpTool[]>;
}

export type OpenEnterpriseLookupMcpSession = (input: {
  apiKey: string;
  category: string;
  provider: EnterpriseLookupProvider;
  signal?: AbortSignal;
  timeoutMs?: number;
}) => Promise<EnterpriseLookupMcpSession>;

const toolsCache = new Map<
  string,
  { expiresAt: number; tools: EnterpriseLookupToolDescriptor[] }
>();

let openSession: OpenEnterpriseLookupMcpSession = openProductionSession;

let safeOutbound: SafeOutboundHttpClient | undefined;

const getSafeOutbound = (): SafeOutboundHttpClient => {
  safeOutbound ??= new SafeOutboundHttpClient({
    maxResponseBytes: 5 * 1024 * 1024,
    timeoutMs: ENTERPRISE_LOOKUP_CALL_TIMEOUT_MS,
    ...createEgressSafeOutboundTransport('feature:mcp'),
  });
  return safeOutbound;
};

const safeMcpFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : undefined;
  const headers = Object.fromEntries(new Headers(init?.headers ?? request?.headers).entries());
  return getSafeOutbound().streamFetch(request?.url ?? String(input), {
    body: init?.body as string | Uint8Array | undefined,
    headers,
    method: init?.method ?? request?.method,
    secretBearing: Object.keys(headers).length > 0 || init?.body !== undefined,
    signal: init?.signal,
    timeoutMs: ENTERPRISE_LOOKUP_CALL_TIMEOUT_MS,
  });
};

export const isEnterpriseLookupMcpCategory = (
  provider: EnterpriseLookupProvider,
  category: string,
): boolean => {
  if (provider === 'tianyancha') return category === TIANYANCHA_CATEGORY;
  return (QCC_CATEGORIES as readonly string[]).includes(category);
};

export const assertEnterpriseLookupMcpCategory = (
  provider: EnterpriseLookupProvider,
  category: string,
): void => {
  if (!isEnterpriseLookupMcpCategory(provider, category)) {
    throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
  }
};

export const buildEnterpriseLookupMcpUrl = (
  provider: EnterpriseLookupProvider,
  category: string,
): string => {
  assertEnterpriseLookupMcpCategory(provider, category);
  if (provider === 'tianyancha') return TIANYANCHA_MCP_URL;
  return `${QCC_MCP_BASE_URL}/${encodeURIComponent(category)}/stream`;
};

export const buildEnterpriseLookupAuthHeaders = (
  provider: EnterpriseLookupProvider,
  apiKey: string,
): Record<string, string> => ({
  Authorization: provider === 'qcc' ? `Bearer ${apiKey}` : apiKey,
});

export const buildEnterpriseLookupMcpParams = (
  provider: EnterpriseLookupProvider,
  category: string,
  apiKey: string,
): MCPClientParams => ({
  headers: buildEnterpriseLookupAuthHeaders(provider, apiKey),
  name: `enterprise-lookup-${provider}-${category}`,
  type: 'http',
  url: buildEnterpriseLookupMcpUrl(provider, category),
});

const toDescriptor = (tool: McpTool): EnterpriseLookupToolDescriptor => ({
  description: tool.description ?? '',
  inputSchema: tool.inputSchema,
  name: tool.name,
});

const collectErrorText = (error: unknown): { message: string; name: string; type?: string } => {
  if (typeof error === 'string') return { message: error, name: '' };

  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const data =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : undefined;
  const parts: string[] = [];
  const baseMessage =
    error instanceof Error
      ? error.message
      : typeof record.message === 'string'
        ? record.message
        : '';
  if (baseMessage) parts.push(baseMessage);
  if (typeof record.error === 'string') parts.push(record.error);
  if (typeof record.error_description === 'string') parts.push(record.error_description);
  // StreamableHTTPError stores the HTTP status on `code` (e.g. 401), not in the message.
  for (const key of ['code', 'status', 'statusCode'] as const) {
    const value = record[key];
    if (typeof value === 'number' || typeof value === 'string') parts.push(String(value));
  }
  if (typeof record.content === 'string') {
    parts.push(record.content);
  } else if (record.content != null && typeof record.content === 'object') {
    try {
      parts.push(JSON.stringify(record.content));
    } catch {
      // ignore unserializable MCP payloads
    }
  }
  const name =
    error instanceof Error ? error.name : typeof record.name === 'string' ? record.name : '';
  const type = typeof data?.type === 'string' ? data.type : undefined;
  return { message: parts.join(' '), name, type };
};

/**
 * Map upstream/transport failures to stable probe reasons.
 * Never returns raw upstream text — callers must not forward `error.message`.
 */
export const classifyEnterpriseLookupProviderError = (
  error: unknown,
): EnterpriseLookupProbeReason | 'internal' => {
  const { message, name, type } = collectErrorText(error);
  const lower = message.toLowerCase();

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    type === 'INITIALIZATION_TIMEOUT' ||
    /\btimeout\b|\btimed out\b|\baborted\b/.test(lower)
  ) {
    return 'timeout';
  }

  if (
    type === 'AUTHORIZATION_ERROR' ||
    name === 'UnauthorizedError' ||
    /\b401\b|\b403\b|unauthorized|forbidden|invalid.?token|invalid.?key|invalid.?api|account_error|tyc error 3000/.test(
      lower,
    )
  ) {
    return 'unauthorized';
  }

  if (/\b429\b|quota|rate.?limit|too many requests/.test(lower)) {
    return 'quota_exceeded';
  }

  if (
    type === 'CONNECTION_FAILED' ||
    /\b50\d\b|\bbad gateway\b|\bservice unavailable\b|\binternal server error\b|econnrefused|enotfound|econnreset|enetunreach|ehostunreach|network|fetch failed|unreachable|socket|ssrf/.test(
      lower,
    )
  ) {
    return 'unreachable';
  }

  return 'internal';
};

const remainingMs = (deadlineAt: number): number => Math.max(0, deadlineAt - Date.now());

const withTimeout = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
  if (timeoutMs <= 0) {
    void Promise.resolve(task).catch(() => undefined);
    const error = new Error('timeout');
    error.name = 'TimeoutError';
    throw error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('timeout');
          error.name = 'TimeoutError';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const disconnectQuietly = async (session?: EnterpriseLookupMcpSession): Promise<void> => {
  await Promise.resolve(session?.disconnect?.()).catch(() => undefined);
};

type McpSdkListToolsClient = {
  listTools: () => Promise<{ tools?: McpTool[] }>;
};

/**
 * MCPClient.listTools swallows almost every transport error and returns `[]`.
 * Call the SDK `listTools` request so 5xx / timeout / auth failures propagate.
 */
const listToolsWithoutSwallowing = async (client: MCPClient): Promise<McpTool[]> => {
  const sdk = Reflect.get(client, 'mcp') as McpSdkListToolsClient | undefined;
  if (!sdk || typeof sdk.listTools !== 'function') {
    const error = new Error('MCP listTools is unavailable');
    error.name = 'ConnectionError';
    throw error;
  }
  const result = await sdk.listTools();
  if (!Array.isArray(result.tools)) {
    throw new Error('MCP listTools returned an invalid payload');
  }
  return result.tools;
};

const fingerprintApiKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 16);

async function openProductionSession(input: {
  apiKey: string;
  category: string;
  provider: EnterpriseLookupProvider;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<EnterpriseLookupMcpSession> {
  assertEnterpriseLookupMcpCategory(input.provider, input.category);
  const params = buildEnterpriseLookupMcpParams(input.provider, input.category, input.apiKey);
  const client = new MCPClient(params, { httpFetch: safeMcpFetch });
  await withTimeout(client.initialize(), input.timeoutMs ?? ENTERPRISE_LOOKUP_CALL_TIMEOUT_MS);
  return {
    callTool: async (name, args) =>
      client.callTool(name, args) as Promise<EnterpriseLookupToolCallResult>,
    disconnect: () => client.disconnect(),
    listTools: () => listToolsWithoutSwallowing(client),
  };
}

const toolsCacheKey = (
  provider: EnterpriseLookupProvider,
  category: string,
  apiKeyFingerprint: string,
) => `${provider}:${category}:${apiKeyFingerprint}`;

export const invalidateEnterpriseLookupToolsCache = (
  provider?: EnterpriseLookupProvider,
  category?: string,
): void => {
  if (!provider) {
    toolsCache.clear();
    return;
  }
  const prefix = category ? `${provider}:${category}:` : `${provider}:`;
  for (const key of toolsCache.keys()) {
    if (key.startsWith(prefix)) toolsCache.delete(key);
  }
};

const mapProbeReason = (error: unknown): EnterpriseLookupProbeReason => {
  const classified = classifyEnterpriseLookupProviderError(error);
  return classified === 'internal' ? 'unreachable' : classified;
};

const classifyTianyanchaProbeResult = (
  result: EnterpriseLookupToolCallResult,
): 'unauthorized' | 'quota_exceeded' | undefined => {
  if (!result.isError) return undefined;
  const classified = classifyEnterpriseLookupProviderError(result);
  if (classified === 'unauthorized' || classified === 'quota_exceeded') return classified;
  // isError that is not auth/quota still means the key was accepted.
  return undefined;
};

export const probeProvider = async (
  provider: EnterpriseLookupProvider,
  apiKey: string,
): Promise<EnterpriseLookupProbeResult> => {
  if (!apiKey) return { ok: false, reason: 'not_configured' };

  const category = provider === 'qcc' ? QCC_PROBE_CATEGORY : TIANYANCHA_CATEGORY;
  // One budget for initialize + tools/list + the optional Tianyancha auth call.
  const deadlineAt = Date.now() + ENTERPRISE_LOOKUP_PROBE_TIMEOUT_MS;
  let session: EnterpriseLookupMcpSession | undefined;
  try {
    session = await openSession({
      apiKey,
      category,
      provider,
      timeoutMs: remainingMs(deadlineAt),
    });
    const tools = await withTimeout(session.listTools(), remainingMs(deadlineAt));
    if (tools.length === 0) {
      // Empty list after initialize is how MCPClient.listTools reports a
      // swallowed transport error. Treat it as unreachable, not success.
      return { ok: false, reason: 'unreachable', toolCount: 0 };
    }
    // Tianyancha answers initialize + tools/list even with an invalid key;
    // only tools/call checks the account. Skip when the tool is not listed.
    if (provider === 'tianyancha' && tools.some((tool) => tool.name === TIANYANCHA_PROBE_TOOL)) {
      try {
        const result = await withTimeout(
          session.callTool(TIANYANCHA_PROBE_TOOL, { ...TIANYANCHA_PROBE_ARGUMENTS }),
          remainingMs(deadlineAt),
        );
        const reason = classifyTianyanchaProbeResult(result);
        if (reason) return { ok: false, reason };
      } catch (error) {
        return { ok: false, reason: mapProbeReason(error) };
      }
    }
    return { ok: true, toolCount: tools.length };
  } catch (error) {
    return { ok: false, reason: mapProbeReason(error) };
  } finally {
    await disconnectQuietly(session);
  }
};

export const listProviderTools = async (
  provider: EnterpriseLookupProvider,
  category: string,
  apiKey: string,
): Promise<EnterpriseLookupToolDescriptor[]> => {
  assertEnterpriseLookupMcpCategory(provider, category);
  const cacheKey = toolsCacheKey(provider, category, fingerprintApiKey(apiKey));
  const cached = toolsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;

  const session = await openSession({ apiKey, category, provider });
  try {
    const tools = (await session.listTools()).map(toDescriptor);
    // Empty lists are indistinguishable from MCPClient.listTools swallowing a
    // transport error. Never cache them — the next call must hit upstream.
    if (tools.length > 0) {
      toolsCache.set(cacheKey, {
        expiresAt: Date.now() + ENTERPRISE_LOOKUP_TOOLS_CACHE_TTL_MS,
        tools,
      });
    }
    return tools;
  } finally {
    await disconnectQuietly(session);
  }
};

export const callProviderTool = async (
  provider: EnterpriseLookupProvider,
  category: string,
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<EnterpriseLookupToolCallResult> => {
  assertEnterpriseLookupMcpCategory(provider, category);
  const session = await openSession({ apiKey, category, provider });
  try {
    return await session.callTool(name, args);
  } finally {
    await disconnectQuietly(session);
  }
};

export const setEnterpriseLookupMcpSessionFactoryForTest = (
  factory: OpenEnterpriseLookupMcpSession | undefined,
): void => {
  openSession = factory ?? openProductionSession;
};

export const resetEnterpriseLookupMcpClientForTest = (): void => {
  openSession = openProductionSession;
  toolsCache.clear();
};
