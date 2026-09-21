import { EnterpriseLookupUsageModel } from '@/database/models/enterpriseLookupUsage';
import type { LobeChatDatabase } from '@/database/type';
import { AUDIT_ACTION } from '@/server/enterprise/services/audit/auditActionCatalog';
import { PlatformAuditService } from '@/server/enterprise/services/platformAudit';
import type {
  EnterpriseLookupProvider,
  EnterpriseLookupRuntimeConfig,
  QccCategory,
} from '@/types/platform/enterpriseLookup';

import {
  ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN,
  ENTERPRISE_LOOKUP_DAILY_LIMIT,
  ENTERPRISE_LOOKUP_INTERNAL,
  ENTERPRISE_LOOKUP_INVALID_ARGUMENTS,
  ENTERPRISE_LOOKUP_NOT_CONFIGURED,
  ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
  EnterpriseLookupServiceError,
} from './errors';
import {
  isProviderUnhealthy,
  markProviderUnhealthy,
  noteEnterpriseLookupConfigured,
} from './health';
import {
  callProviderTool,
  classifyEnterpriseLookupProviderError,
  type EnterpriseLookupToolDescriptor,
  listProviderTools,
  TIANYANCHA_CATEGORY,
} from './mcpClient';
import { getEnterpriseLookupRuntimeConfig } from './settings';

export {
  ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN,
  ENTERPRISE_LOOKUP_DAILY_LIMIT,
  ENTERPRISE_LOOKUP_ERROR_CODES,
  ENTERPRISE_LOOKUP_INTERNAL,
  ENTERPRISE_LOOKUP_INVALID_ARGUMENTS,
  ENTERPRISE_LOOKUP_NOT_CONFIGURED,
  ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
  ENTERPRISE_LOOKUP_TOOL_IDENTIFIER,
  type EnterpriseLookupErrorCode,
  type EnterpriseLookupProbeReason,
  EnterpriseLookupServiceError,
  formatEnterpriseLookupClientError,
  isEnterpriseLookupErrorCode,
  parseEnterpriseLookupClientError,
} from './errors';
export {
  clearEnterpriseLookupUnhealthy,
  ENTERPRISE_LOOKUP_UNHEALTHY_TTL_MS,
  isProviderUnhealthy,
  markProviderUnhealthy,
  noteEnterpriseLookupConfigured,
  peekEnterpriseLookupConfigured,
  resetEnterpriseLookupHealthForTest,
} from './health';
export {
  assertEnterpriseLookupMcpCategory,
  buildEnterpriseLookupAuthHeaders,
  buildEnterpriseLookupMcpParams,
  buildEnterpriseLookupMcpUrl,
  callProviderTool,
  classifyEnterpriseLookupProviderError,
  type EnterpriseLookupProbeResult,
  type EnterpriseLookupToolDescriptor,
  invalidateEnterpriseLookupToolsCache,
  isEnterpriseLookupMcpCategory,
  listProviderTools,
  probeProvider,
  QCC_CATEGORIES,
  QCC_PROBE_CATEGORY,
  resetEnterpriseLookupMcpClientForTest,
  setEnterpriseLookupMcpSessionFactoryForTest,
  TIANYANCHA_CATEGORY,
  TIANYANCHA_MCP_URL,
} from './mcpClient';

export const ENTERPRISE_LOOKUP_USAGE_TZ = 'Asia/Shanghai';

const COMPANY_KEYWORD_KEYS = [
  'keyword',
  'companyName',
  'company_name',
  'company',
  'name',
  'searchKey',
  'search_key',
  'word',
  'query',
  'enterpriseName',
  'entName',
  'entname',
] as const;

export interface EnterpriseLookupCategoryCapabilities {
  category: string;
  tools: EnterpriseLookupToolDescriptor[];
}

export interface EnterpriseLookupCapabilities {
  categories: EnterpriseLookupCategoryCapabilities[];
  provider: EnterpriseLookupProvider;
}

export interface EnterpriseLookupQueryInput {
  arguments?: Record<string, unknown>;
  capability: string;
  category?: string;
  provider?: EnterpriseLookupProvider;
}

export interface EnterpriseLookupQueryResult {
  capability: string;
  category: string;
  content: string;
  isError?: boolean;
  provider: EnterpriseLookupProvider;
}

export interface EnterpriseLookupStatus {
  configured: boolean;
  dailyLimitPerUser?: number;
  defaultProvider?: EnterpriseLookupProvider;
  fallbackEnabled?: boolean;
  remaining?: number | null;
  usedToday?: number;
}

export interface EnterpriseLookupListCapabilitiesInput {
  category?: string;
  provider?: EnterpriseLookupProvider;
}

export const COMPANY_PROFILE_ASPECTS = ['basic', 'ipr', 'people', 'risk'] as const;

export type CompanyProfileAspect = (typeof COMPANY_PROFILE_ASPECTS)[number];

export const isCompanyProfileAspect = (value: unknown): value is CompanyProfileAspect =>
  value === 'basic' || value === 'ipr' || value === 'people' || value === 'risk';

export interface EnterpriseLookupCompanyProfileInput {
  aspects?: CompanyProfileAspect[];
  name: string;
  provider?: EnterpriseLookupProvider;
}

export interface EnterpriseLookupCompanyCandidate {
  creditCode?: string;
  legalPerson?: string;
  name: string;
  status?: string;
}

export interface EnterpriseLookupCompanyProfileResult {
  aspects: CompanyProfileAspect[];
  candidates: EnterpriseLookupCompanyCandidate[];
  match: 'ambiguous' | 'none' | 'unique';
  /** Set when a unique hit was found but 工商 was not fetched (daily quota on the second call). */
  note?: string;
  profile?: string;
  provider: EnterpriseLookupProvider;
  queriedAt: string;
  query: string;
}

const QCC_SEARCH_CAPABILITY = 'get_company_by_query';
const QCC_BASIC_CAPABILITY = 'get_company_registration_info';
const QCC_COMPANY_CATEGORY = 'company';
const TYC_SEARCH_CAPABILITY = 'search_companies';
const TYC_BASIC_CAPABILITY = 'get_company_basic_profile';

const COMPANY_NAME_KEYS = [
  'name',
  'companyname',
  'company_name',
  'entname',
  'orgname',
  'corpname',
  'enterprisename',
  '企业名称',
];
const CREDIT_CODE_KEYS = [
  'creditcode',
  'credit_code',
  'creditno',
  'unifiedsocialcreditcode',
  'unifiedcode',
  'regnumber',
  'taxno',
  '统一社会信用代码',
];
const LEGAL_PERSON_KEYS = [
  'opername',
  'legalperson',
  'legalpersonname',
  'legal_person',
  'legalrepresentative',
  'frname',
  'boss',
  '法定代表人',
  '法定代表人名称',
];
const STATUS_KEYS = [
  'status',
  'regstatus',
  'registstatus',
  'newstatus',
  'companystatus',
  '登记状态',
  '经营状态',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) return parts.join('、');
  }
  return undefined;
};

const firstNonEmptyString = (
  record: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  const lower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    lower.set(key.toLowerCase(), value);
  }
  for (const key of keys) {
    const found = asNonEmptyString(lower.get(key.toLowerCase()));
    if (found) return found;
  }
  return undefined;
};

const normalizeCompanyName = (value: string): string => value.trim().replaceAll(/\s+/g, '');

const companyCandidateDedupeKey = (
  candidate: Pick<EnterpriseLookupCompanyCandidate, 'creditCode' | 'legalPerson' | 'name'>,
): string =>
  `${normalizeCompanyName(candidate.name)}|${candidate.creditCode ?? ''}|${candidate.legalPerson ?? ''}`;

const COMPANY_PROFILE_BASIC_QUOTA_NOTE = '今日查询次数已达上限，未拉取工商基本信息。';

export const parseJsonPayload = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    if (start < 0) return null;
    const objectEnd = trimmed.lastIndexOf('}');
    const arrayEnd = trimmed.lastIndexOf(']');
    const end = Math.max(objectEnd, arrayEnd);
    if (end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

const looksLikeCompany = (
  record: Record<string, unknown>,
): EnterpriseLookupCompanyCandidate | undefined => {
  const name = firstNonEmptyString(record, COMPANY_NAME_KEYS);
  if (!name) return undefined;
  const creditCode = firstNonEmptyString(record, CREDIT_CODE_KEYS);
  const legalPerson = firstNonEmptyString(record, LEGAL_PERSON_KEYS);
  const status = firstNonEmptyString(record, STATUS_KEYS);
  if (!creditCode && !legalPerson && !status && !/[公司厂集团企业合作社]/.test(name)) {
    return undefined;
  }
  return {
    name,
    ...(creditCode ? { creditCode } : {}),
    ...(legalPerson ? { legalPerson } : {}),
    ...(status ? { status } : {}),
  };
};

const CREDIT_CODE_PATTERN = /[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/;
const COMPANY_NAME_PATTERN =
  /[\u4E00-\u9FFFA-Z0-9()（）.-]{2,40}(?:股份有限公司|有限责任公司|有限公司|集团有限公司|集团公司|公司|厂|合作社)/gi;

const parseTextCompanyCandidates = (text: string): EnterpriseLookupCompanyCandidate[] => {
  const found: EnterpriseLookupCompanyCandidate[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\n+/)) {
    COMPANY_NAME_PATTERN.lastIndex = 0;
    const name = line.match(COMPANY_NAME_PATTERN)?.[0]?.trim();
    if (!name) continue;
    const creditCode = line.match(CREDIT_CODE_PATTERN)?.[0];
    const candidate: EnterpriseLookupCompanyCandidate = {
      name,
      ...(creditCode ? { creditCode } : {}),
    };
    const key = companyCandidateDedupeKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(candidate);
    if (found.length >= 20) break;
  }
  return found;
};

export const parseEnterpriseLookupCompanyCandidates = (
  content: string,
): EnterpriseLookupCompanyCandidate[] => {
  const parsed = parseJsonPayload(content);
  const found: EnterpriseLookupCompanyCandidate[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    const candidate = looksLikeCompany(value);
    if (candidate) {
      const key = companyCandidateDedupeKey(candidate);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(candidate);
      }
      return;
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  if (parsed != null) visit(parsed);
  if (found.length > 0) return found.slice(0, 20);
  return parseTextCompanyCandidates(content);
};

export const pickUniqueCompanyCandidate = (
  candidates: EnterpriseLookupCompanyCandidate[],
  query: string,
): EnterpriseLookupCompanyCandidate | undefined => {
  const needle = normalizeCompanyName(query);
  const exact = candidates.filter((item) => normalizeCompanyName(item.name) === needle);
  return exact.length === 1 ? exact[0] : undefined;
};

const normalizeCompanyProfileAspects = (value?: unknown): CompanyProfileAspect[] => {
  if (value == null) return ['basic'];
  if (!Array.isArray(value)) {
    throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
  }
  if (value.length === 0) return ['basic'];
  const seen = new Set<CompanyProfileAspect>();
  for (const item of value) {
    if (!isCompanyProfileAspect(item)) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
    }
    seen.add(item);
  }
  return [...seen];
};

const OTHER_PROVIDER: Record<EnterpriseLookupProvider, EnterpriseLookupProvider> = {
  qcc: 'tianyancha',
  tianyancha: 'qcc',
};

export const shanghaiDateTime = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: ENTERPRISE_LOOKUP_USAGE_TZ,
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};

export const shanghaiUsageDate = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: ENTERPRISE_LOOKUP_USAGE_TZ,
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const isEnabledProvider = (
  config: EnterpriseLookupRuntimeConfig,
  provider: EnterpriseLookupProvider,
): boolean => (provider === 'qcc' ? !!config.qcc : !!config.tianyancha);

const providerApiKey = (
  config: EnterpriseLookupRuntimeConfig,
  provider: EnterpriseLookupProvider,
): string | undefined => (provider === 'qcc' ? config.qcc?.apiKey : config.tianyancha?.apiKey);

const enabledCategories = (
  config: EnterpriseLookupRuntimeConfig,
  provider: EnterpriseLookupProvider,
): string[] => {
  if (provider === 'tianyancha') {
    return isEnabledProvider(config, 'tianyancha') ? [TIANYANCHA_CATEGORY] : [];
  }
  return config.qcc?.categories ?? [];
};

const extractCompanyKeyword = (args: Record<string, unknown>): string | undefined => {
  for (const key of COMPANY_KEYWORD_KEYS) {
    const value = args[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed.slice(0, 200);
  }
  return undefined;
};

const formatToolContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    if (content == null) return '';
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const block = item as { text?: unknown; type?: unknown };
      if (block.type === 'text' && typeof block.text === 'string') return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
};

const assertPlainArguments = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
  }
  return value as Record<string, unknown>;
};

export const getRuntimeConfig = (): Promise<EnterpriseLookupRuntimeConfig | null> =>
  getEnterpriseLookupRuntimeConfig();

export const isEnterpriseLookupConfigured = async (): Promise<boolean> => {
  const config = await getEnterpriseLookupRuntimeConfig();
  const configured =
    !!config && (isEnabledProvider(config, 'qcc') || isEnabledProvider(config, 'tianyancha'));
  noteEnterpriseLookupConfigured(configured);
  return configured;
};

export const isConfigured = isEnterpriseLookupConfigured;

const requireConfig = async (): Promise<EnterpriseLookupRuntimeConfig> => {
  const config = await getEnterpriseLookupRuntimeConfig();
  const configured =
    !!config && (isEnabledProvider(config, 'qcc') || isEnabledProvider(config, 'tianyancha'));
  noteEnterpriseLookupConfigured(configured);
  if (!config || !configured) {
    throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_NOT_CONFIGURED);
  }
  return config;
};

const resolveProvider = (
  config: EnterpriseLookupRuntimeConfig,
  explicit?: EnterpriseLookupProvider,
): { fallbackProvider?: EnterpriseLookupProvider; provider: EnterpriseLookupProvider } => {
  const other = (provider: EnterpriseLookupProvider) => {
    const candidate = OTHER_PROVIDER[provider];
    return isEnabledProvider(config, candidate) ? candidate : undefined;
  };

  if (explicit) {
    if (!isEnabledProvider(config, explicit)) {
      const fallback = other(explicit);
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE, {
        fallbackProvider: config.fallbackEnabled ? fallback : undefined,
      });
    }
    return {
      fallbackProvider: config.fallbackEnabled ? other(explicit) : undefined,
      provider: explicit,
    };
  }

  const preferred = isEnabledProvider(config, config.defaultProvider)
    ? config.defaultProvider
    : isEnabledProvider(config, 'qcc')
      ? 'qcc'
      : 'tianyancha';

  if (!isProviderUnhealthy(preferred)) {
    return {
      fallbackProvider: config.fallbackEnabled ? other(preferred) : undefined,
      provider: preferred,
    };
  }

  const healthyOther = other(preferred);
  if (healthyOther && !isProviderUnhealthy(healthyOther)) {
    return {
      fallbackProvider: config.fallbackEnabled ? preferred : undefined,
      provider: healthyOther,
    };
  }

  return {
    fallbackProvider: config.fallbackEnabled ? other(preferred) : undefined,
    provider: preferred,
  };
};

const throwProviderUnavailable = (
  config: EnterpriseLookupRuntimeConfig,
  provider: EnterpriseLookupProvider,
  explicit?: EnterpriseLookupProvider,
): never => {
  const fallback = OTHER_PROVIDER[provider];
  const canFallback =
    config.fallbackEnabled && isEnabledProvider(config, fallback) && fallback !== explicit;
  throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE, {
    fallbackProvider: canFallback ? fallback : undefined,
  });
};

const handleProviderFailure = (
  error: unknown,
  config: EnterpriseLookupRuntimeConfig,
  provider: EnterpriseLookupProvider,
  explicit?: EnterpriseLookupProvider,
): never => {
  if (error instanceof EnterpriseLookupServiceError) throw error;
  const reason = classifyEnterpriseLookupProviderError(error);
  if (
    reason === 'unauthorized' ||
    reason === 'quota_exceeded' ||
    reason === 'unreachable' ||
    reason === 'timeout'
  ) {
    markProviderUnhealthy(provider);
    throwProviderUnavailable(config, provider, explicit);
  }
  throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INTERNAL);
};

export class EnterpriseLookupService {
  private readonly audit: PlatformAuditService;
  private readonly usage: EnterpriseLookupUsageModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {
    this.audit = new PlatformAuditService(db);
    this.usage = new EnterpriseLookupUsageModel(db);
  }

  status = async (): Promise<EnterpriseLookupStatus> => {
    const config = await getEnterpriseLookupRuntimeConfig();
    const configured =
      !!config && (isEnabledProvider(config, 'qcc') || isEnabledProvider(config, 'tianyancha'));
    noteEnterpriseLookupConfigured(configured);
    if (!config || !configured) return { configured: false };

    const usedToday = await this.usage.getDailyTotal(this.userId, shanghaiUsageDate());
    const limit = config.dailyLimitPerUser;
    return {
      configured: true,
      dailyLimitPerUser: limit,
      defaultProvider: config.defaultProvider,
      fallbackEnabled: config.fallbackEnabled,
      remaining: limit === 0 ? null : Math.max(0, limit - usedToday),
      usedToday,
    };
  };

  listCapabilities = async (
    input: EnterpriseLookupListCapabilitiesInput = {},
  ): Promise<EnterpriseLookupCapabilities> => {
    const config = await requireConfig();
    const { provider } = resolveProvider(config, input.provider);
    const apiKey = providerApiKey(config, provider);
    if (!apiKey) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_NOT_CONFIGURED);
    }

    const categories = enabledCategories(config, provider);
    if (input.category && !categories.includes(input.category)) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
    }
    const selected = input.category ? [input.category] : categories;

    try {
      const listed: EnterpriseLookupCategoryCapabilities[] = [];
      for (const category of selected) {
        const tools = await listProviderTools(provider, category, apiKey);
        listed.push({ category, tools });
      }
      return { categories: listed, provider };
    } catch (error) {
      return handleProviderFailure(error, config, provider, input.provider);
    }
  };

  query = async (input: EnterpriseLookupQueryInput): Promise<EnterpriseLookupQueryResult> => {
    const capability = input.capability?.trim();
    if (!capability) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
    }
    const args = assertPlainArguments(input.arguments ?? {});

    const config = await requireConfig();
    const { provider } = resolveProvider(config, input.provider);
    const apiKey = providerApiKey(config, provider);
    if (!apiKey) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_NOT_CONFIGURED);
    }

    const categories = enabledCategories(config, provider);
    if (input.category && !categories.includes(input.category)) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
    }

    let category: string | undefined = input.category;
    try {
      if (!category) {
        category = await this.findCategoryForCapability(provider, apiKey, categories, capability);
      } else {
        const tools = await listProviderTools(provider, category, apiKey);
        if (!tools.some((tool) => tool.name === capability)) {
          throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN);
        }
      }
    } catch (error) {
      return handleProviderFailure(error, config, provider, input.provider);
    }

    if (!category) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN);
    }

    // Capture the Shanghai day once so release cannot land on the next row if
    // the vendor call straddles midnight.
    const usageDate = shanghaiUsageDate();
    let reserved = false;
    try {
      reserved = await this.usage.reserve(
        this.userId,
        usageDate,
        provider,
        config.dailyLimitPerUser,
      );
      if (!reserved) {
        throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_DAILY_LIMIT);
      }

      let upstream: { content: unknown; isError?: boolean };
      try {
        upstream = await callProviderTool(provider, category, apiKey, capability, args);
      } catch (error) {
        return handleProviderFailure(error, config, provider, input.provider);
      }
      if (upstream.isError) {
        throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INTERNAL);
      }

      reserved = false;
      await this.writeQueryAudit(provider, capability, args);

      return {
        capability,
        category,
        content: formatToolContent(upstream.content),
        provider,
      };
    } finally {
      // Residual crash window: if this process dies after reserve commits and
      // before this finally (SIGKILL / OOM during the vendor MCP call), the
      // increment stays until the next Asia/Shanghai day. No lease/sweeper.
      if (reserved) {
        await this.releaseReservation(provider, usageDate);
      }
    }
  };

  companyProfile = async (
    input: EnterpriseLookupCompanyProfileInput,
  ): Promise<EnterpriseLookupCompanyProfileResult> => {
    const name = input.name?.trim();
    if (!name) {
      throw new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INVALID_ARGUMENTS);
    }
    const aspects = normalizeCompanyProfileAspects(input.aspects);
    const queriedAt = shanghaiDateTime();

    const config = await requireConfig();
    const { provider } = resolveProvider(config, input.provider);

    const search = await this.query(
      provider === 'qcc'
        ? {
            arguments: { searchKey: name },
            capability: QCC_SEARCH_CAPABILITY,
            category: QCC_COMPANY_CATEGORY,
            provider,
          }
        : {
            arguments: { page: 1, page_size: 5, query: name },
            capability: TYC_SEARCH_CAPABILITY,
            category: TIANYANCHA_CATEGORY,
            provider,
          },
    );

    const candidates = parseEnterpriseLookupCompanyCandidates(search.content);
    const unique = pickUniqueCompanyCandidate(candidates, name);
    if (!unique) {
      return {
        aspects,
        candidates,
        match: candidates.length === 0 ? 'none' : 'ambiguous',
        provider: search.provider,
        queriedAt,
        query: name,
      };
    }

    const searchKey = unique.creditCode || unique.name;
    let basic: EnterpriseLookupQueryResult;
    try {
      basic = await this.query(
        search.provider === 'qcc'
          ? {
              arguments: { searchKey },
              capability: QCC_BASIC_CAPABILITY,
              category: QCC_COMPANY_CATEGORY,
              provider: search.provider,
            }
          : {
              arguments: { company_name: unique.name },
              capability: TYC_BASIC_CAPABILITY,
              category: TIANYANCHA_CATEGORY,
              provider: search.provider,
            },
      );
    } catch (error) {
      if (
        error instanceof EnterpriseLookupServiceError &&
        error.code === ENTERPRISE_LOOKUP_DAILY_LIMIT
      ) {
        return {
          aspects,
          candidates: [unique],
          match: 'unique',
          note: COMPANY_PROFILE_BASIC_QUOTA_NOTE,
          provider: search.provider,
          queriedAt,
          query: name,
        };
      }
      throw error;
    }

    return {
      aspects,
      candidates: [unique],
      match: 'unique',
      profile: basic.content,
      provider: basic.provider,
      queriedAt,
      query: name,
    };
  };

  private findCategoryForCapability = async (
    provider: EnterpriseLookupProvider,
    apiKey: string,
    categories: string[],
    capability: string,
  ): Promise<string | undefined> => {
    for (const category of categories) {
      const tools = await listProviderTools(provider, category, apiKey);
      if (tools.some((tool) => tool.name === capability)) return category;
    }
    return undefined;
  };

  private releaseReservation = async (
    provider: EnterpriseLookupProvider,
    usageDate: string,
  ): Promise<void> => {
    const attempt = () => this.usage.release(this.userId, usageDate, provider);
    try {
      await attempt();
    } catch {
      try {
        await attempt();
      } catch (error) {
        console.error('[enterprise-lookup] usage release failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
  };

  private writeQueryAudit = async (
    provider: EnterpriseLookupProvider,
    capability: string,
    args: Record<string, unknown>,
  ): Promise<void> => {
    const companyKeyword = extractCompanyKeyword(args);
    try {
      await this.audit.append({
        action: AUDIT_ACTION.ENTERPRISE_LOOKUP_QUERY,
        actorUserId: this.userId,
        afterDiff: {
          capability,
          ...(companyKeyword ? { companyKeyword } : {}),
          provider,
        },
        result: 'success',
        targetId: `${provider}/${capability}`,
        targetType: 'system',
      });
    } catch (error) {
      console.error('[enterprise-lookup] audit append failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  };
}

export type { QccCategory };
