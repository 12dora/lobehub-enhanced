import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  EnterpriseLookupProvider,
  ListCapabilitiesParams,
  ListCapabilitiesResult,
  ListCapabilitiesState,
  QueryEnterpriseParams,
  QueryEnterpriseState,
} from '../types';
import { isEnterpriseLookupProvider } from '../types';

const parseProviderUnavailableSuffix = (
  message: string,
): { code: string; fallbackProvider?: EnterpriseLookupProvider } => {
  const [code, fallback] = message.split(':');
  if (code === 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE' && isEnterpriseLookupProvider(fallback)) {
    return { code, fallbackProvider: fallback };
  }
  return { code: message };
};

export const ENTERPRISE_LOOKUP_CONTENT_LIMIT = 12_000;

/** LLM-visible copy for unexpected failures. Never include raw error text. */
export const ENTERPRISE_LOOKUP_INTERNAL_TOOL_CONTENT =
  '企业查询失败（内部错误），请稍后重试。不要向用户展示技术细节。';

const KNOWN_ERROR_CODES = new Set([
  'ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN',
  'ENTERPRISE_LOOKUP_DAILY_LIMIT',
  'ENTERPRISE_LOOKUP_INTERNAL',
  'ENTERPRISE_LOOKUP_INVALID_ARGUMENTS',
  'ENTERPRISE_LOOKUP_NOT_CONFIGURED',
  'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
]);

const PROVIDER_LABEL: Record<EnterpriseLookupProvider, string> = {
  qcc: '企查查',
  tianyancha: '天眼查',
};

export interface IEnterpriseLookupService {
  listCapabilities: (params: ListCapabilitiesParams) => Promise<ListCapabilitiesResult>;
  query: (params: QueryEnterpriseParams) => Promise<unknown>;
}

interface LookupToolFailure {
  code: string;
  fallbackProvider?: EnterpriseLookupProvider;
  message: string;
}

const compactJson = (value: unknown): string => JSON.stringify(value);

const providerLabel = (provider?: string): string | undefined => {
  if (isEnterpriseLookupProvider(provider)) return PROVIDER_LABEL[provider];
  return undefined;
};

const nestedErrorRecords = (error: unknown): Record<string, unknown>[] => {
  if (!error || typeof error !== 'object') return [];
  const record = error as Record<string, unknown>;
  const records = [record];
  const pushObject = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      records.push(value as Record<string, unknown>);
    }
  };
  pushObject(record.data);
  if (record.data && typeof record.data === 'object') {
    pushObject((record.data as Record<string, unknown>).errorData);
  }
  pushObject(record.cause);
  if (record.cause && typeof record.cause === 'object') {
    pushObject((record.cause as Record<string, unknown>).data);
  }
  return records;
};

const extractErrorCode = (error: unknown): string | undefined => {
  for (const record of nestedErrorRecords(error)) {
    if (typeof record.code === 'string' && record.code.startsWith('ENTERPRISE_LOOKUP_')) {
      return record.code;
    }
    if (typeof record.message === 'string') {
      const parsed = parseProviderUnavailableSuffix(record.message);
      if (parsed.code.startsWith('ENTERPRISE_LOOKUP_')) return parsed.code;
      const match = record.message.match(/ENTERPRISE_LOOKUP_[A-Z_]+/);
      if (match) return match[0];
    }
  }
  return undefined;
};

const extractFallbackProvider = (error: unknown): EnterpriseLookupProvider | undefined => {
  for (const record of nestedErrorRecords(error)) {
    if (isEnterpriseLookupProvider(record.fallbackProvider)) return record.fallbackProvider;
    if (typeof record.message === 'string') {
      const parsed = parseProviderUnavailableSuffix(record.message);
      if (parsed.fallbackProvider) return parsed.fallbackProvider;
    }
  }
  return undefined;
};

const truncateText = (text: string): { text: string; truncated: boolean } => {
  if (text.length <= ENTERPRISE_LOOKUP_CONTENT_LIMIT) return { text, truncated: false };
  return {
    text: text.slice(0, ENTERPRISE_LOOKUP_CONTENT_LIMIT),
    truncated: true,
  };
};

const isMcpTextPart = (value: unknown): value is { text: string; type: 'text' } => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.type === 'text' && typeof record.text === 'string';
};

/** Prefer MCP text / markdown bodies; otherwise compact JSON. */
export const formatLookupBody = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isMcpTextPart)) {
      return value.map((part) => part.text).join('\n');
    }
    const texts = value.map((item) => formatLookupBody(item)).filter(Boolean);
    const allPlain = texts.every((text) => !text.startsWith('{') && !text.startsWith('['));
    if (texts.length === value.length && allPlain) {
      return texts.join('\n');
    }
    return compactJson(value);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      Array.isArray(record.content) &&
      record.content.length > 0 &&
      record.content.every(isMcpTextPart)
    ) {
      return record.content.map((part) => (part as { text: string }).text).join('\n');
    }
    const keys = Object.keys(record);
    if (typeof record.text === 'string' && keys.every((key) => key === 'text' || key === 'type')) {
      return record.text;
    }
    return compactJson(value);
  }
  return compactJson(value);
};

const unwrapQueryPayload = (
  result: unknown,
  args: QueryEnterpriseParams,
): {
  body: unknown;
  capability: string;
  category?: string;
  provider?: EnterpriseLookupProvider;
} => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      body: result,
      capability: args.capability,
      category: args.category,
      provider: args.provider,
    };
  }

  const record = result as Record<string, unknown>;
  const provider = isEnterpriseLookupProvider(record.provider) ? record.provider : args.provider;
  const capability = typeof record.capability === 'string' ? record.capability : args.capability;
  const category = typeof record.category === 'string' ? record.category : args.category;
  const body =
    record.result !== undefined
      ? record.result
      : record.data !== undefined
        ? record.data
        : record.content !== undefined
          ? record.content
          : result;

  return { body, capability, category, provider };
};

const withTruncationNote = (text: string, truncated: boolean): string =>
  truncated ? `${text}\n（结果已截断，仅保留前 ${ENTERPRISE_LOOKUP_CONTENT_LIMIT} 字符）` : text;

const friendlyErrorContent = (
  code: string,
  fallbackProvider?: EnterpriseLookupProvider,
): string => {
  switch (code) {
    case 'ENTERPRISE_LOOKUP_NOT_CONFIGURED': {
      return '企业查询未配置（ENTERPRISE_LOOKUP_NOT_CONFIGURED）。请联系管理员在系统设置中启用数据源。不要向用户展示技术细节。';
    }
    case 'ENTERPRISE_LOOKUP_DAILY_LIMIT': {
      return '今日查询次数已达上限（ENTERPRISE_LOOKUP_DAILY_LIMIT）。请明日再试，或请管理员调整每人每日上限。不要向用户展示技术细节。';
    }
    case 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE': {
      if (fallbackProvider) {
        const label = providerLabel(fallbackProvider) ?? fallbackProvider;
        return `当前数据源不可用（ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE）。请对 fallbackProvider「${label}」（${fallbackProvider}）调用一次 listCapabilities，然后用该数据源重试 queryEnterprise，仅重试一次。不要向用户展示技术细节。`;
      }
      return '当前数据源不可用（ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE）。请稍后重试。不要向用户展示技术细节。';
    }
    case 'ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN': {
      return '未知能力（ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN）。请先调用 listCapabilities 确认可用能力后再查询。不要向用户展示技术细节。';
    }
    case 'ENTERPRISE_LOOKUP_INVALID_ARGUMENTS': {
      return '查询参数无效（ENTERPRISE_LOOKUP_INVALID_ARGUMENTS）。请按 listCapabilities 返回的 inputSchema 修正参数后重试。不要向用户展示技术细节。';
    }
    default: {
      return ENTERPRISE_LOOKUP_INTERNAL_TOOL_CONTENT;
    }
  }
};

const sanitizeFailure = (error: unknown): { content: string; error: LookupToolFailure } => {
  const code = extractErrorCode(error);
  const fallbackProvider = extractFallbackProvider(error);

  if (code && KNOWN_ERROR_CODES.has(code) && code !== 'ENTERPRISE_LOOKUP_INTERNAL') {
    const content = friendlyErrorContent(code, fallbackProvider);
    return {
      content,
      error: fallbackProvider
        ? { code, fallbackProvider, message: content }
        : { code, message: content },
    };
  }

  console.error('[lobe-enterprise-lookup] failed', error);
  return {
    content: ENTERPRISE_LOOKUP_INTERNAL_TOOL_CONTENT,
    error: { code: 'ENTERPRISE_LOOKUP_INTERNAL', message: ENTERPRISE_LOOKUP_INTERNAL_TOOL_CONTENT },
  };
};

const failureResult = (error: unknown): BuiltinServerRuntimeOutput => {
  const sanitized = sanitizeFailure(error);
  return {
    content: sanitized.content,
    error: sanitized.error,
    success: false,
  };
};

/**
 * Enterprise-lookup execution runtime. Accepts EnterpriseLookupService (or a
 * test double) via constructor injection — no React, no Zustand, no `@/services`.
 */
export class EnterpriseLookupExecutionRuntime {
  constructor(private service: IEnterpriseLookupService) {}

  async listCapabilities(args: ListCapabilitiesParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.listCapabilities(args);
      const provider = isEnterpriseLookupProvider(result.provider)
        ? result.provider
        : args.provider;
      const categories = Array.isArray(result.categories) ? result.categories : [];
      const toolCount = categories.reduce((sum, item) => sum + (item.tools?.length ?? 0), 0);
      const payload = {
        categories: categories.map((item) => ({
          category: item.category,
          tools: (item.tools ?? []).map((tool) => ({
            description: tool.description,
            inputSchema: tool.inputSchema,
            name: tool.name,
          })),
        })),
        provider,
      };
      const { text, truncated } = truncateText(compactJson(payload));
      const source = providerLabel(provider);
      const instruction =
        '请按返回的 capability 名称与 inputSchema 调用 queryEnterprise。公司匹配不唯一时列出「企业名称 · 统一社会信用代码/法定代表人」请用户选择，不要猜测。';
      const header = source ? `数据来源：${source}` : undefined;
      const content = withTruncationNote(
        [header, instruction, text].filter(Boolean).join('\n'),
        truncated,
      );
      const state: ListCapabilitiesState = {
        category: args.category,
        provider,
        resultText: text,
        success: true,
        toolCount,
        truncated,
      };
      return { content, state, success: true };
    } catch (error) {
      return failureResult(error);
    }
  }

  async queryEnterprise(args: QueryEnterpriseParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.query(args);
      const unwrapped = unwrapQueryPayload(result, args);
      const bodyText = formatLookupBody(unwrapped.body);
      const { text, truncated } = truncateText(bodyText);
      const source = providerLabel(unwrapped.provider);
      const header = [
        source ? `数据来源：${source}` : undefined,
        unwrapped.capability ? `能力：${unwrapped.capability}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');
      const content = withTruncationNote([header, text].filter(Boolean).join('\n'), truncated);
      const state: QueryEnterpriseState = {
        capability: unwrapped.capability,
        category: unwrapped.category,
        provider: unwrapped.provider,
        resultText: text,
        success: true,
        truncated,
      };
      return { content, state, success: true };
    } catch (error) {
      return failureResult(error);
    }
  }
}

export const createEnterpriseLookupRuntime = (service: IEnterpriseLookupService) =>
  new EnterpriseLookupExecutionRuntime(service);
