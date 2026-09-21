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

const OTHER_PROVIDER: Record<EnterpriseLookupProvider, EnterpriseLookupProvider> = {
  qcc: 'tianyancha',
  tianyancha: 'qcc',
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
