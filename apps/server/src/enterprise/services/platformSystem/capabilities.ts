import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';

import { PlatformSettingsModel } from '@/database/models/platform/settings';
import { platformAiModels, platformAiProviders } from '@/database/schemas/platform';
import type { LobeChatDatabase } from '@/database/type';
import type { AdminSystemSandboxHealth } from '@/server/enterprise/contracts/adminSystem';
import { parseEnterpriseFeatureFlags } from '@/server/enterprise/featureFlags';
import { isModuleEnabled } from '@/server/enterprise/services/moduleSettings';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';

import type { RuntimeErrorSummaryItem } from './runtimeErrors';

export const CAPABILITY_KEYS = [
  'dingtalk_connector',
  'dingtalk_personal',
  'memory_embedding',
  'sandbox',
  'system_agent_models',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type CapabilityStatus = 'degraded' | 'disabled' | 'healthy' | 'unavailable' | 'unknown';

export interface CapabilityReport {
  detail?: string;
  key: CapabilityKey;
  reason?: string;
  status: CapabilityStatus;
}

const DETAIL_MAX = 300;

const SYSTEM_AGENT_SLOTS = [
  'agentMeta',
  'followUpAction',
  'generationTopic',
  'historyCompress',
  'inputCompletion',
  'promptRewrite',
  'thread',
  'topic',
  'translation',
] as const;

const clip = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > DETAIL_MAX ? trimmed.slice(0, DETAIL_MAX) : trimmed;
};

const report = (
  key: CapabilityKey,
  status: CapabilityStatus,
  extra?: { detail?: string; reason?: string },
): CapabilityReport => {
  const detail = clip(extra?.detail);
  const reason = clip(extra?.reason);
  return {
    key,
    status,
    ...(detail ? { detail } : {}),
    ...(reason ? { reason } : {}),
  };
};

export const projectSandboxCapability = (
  health: AdminSystemSandboxHealth | null | undefined,
): CapabilityReport => {
  if (!health) {
    return report('sandbox', 'disabled', { reason: '沙箱未启用或不是本地 Docker 提供方' });
  }
  if (health.status === 'healthy') {
    return report('sandbox', 'healthy', { detail: health.detail });
  }
  if (health.status === 'degraded' || health.status === 'unavailable') {
    return report('sandbox', health.status, {
      detail: health.lastError,
      reason: health.errorCategory ?? undefined,
    });
  }
  return report('sandbox', health.status, {
    detail: health.lastError,
    reason: health.errorCategory ?? undefined,
  });
};

export interface SystemAgentSlotConfig {
  enabled?: boolean;
  model: string;
  name: string;
  provider: string;
}

export interface CatalogProviderRow {
  enabled: boolean;
  id: string;
  providerKey: string;
  status: string;
}

export interface CatalogModelRow {
  enabled: boolean;
  modelKey: string;
  providerId: string;
  status: string;
}

const publishedEnabled = (row: { enabled: boolean; status: string }): boolean =>
  row.enabled === true && row.status === 'published';

/** Config-only: each enabled slot's provider and model must be published and enabled. */
export const findSystemAgentProblems = (
  slots: readonly SystemAgentSlotConfig[],
  providers: readonly CatalogProviderRow[],
  models: readonly CatalogModelRow[],
): { checked: number; problems: string[] } => {
  const problems: string[] = [];
  let checked = 0;
  for (const slot of slots) {
    if (slot.enabled === false) continue;
    checked += 1;
    const provider = slot.provider.trim();
    const model = slot.model.trim();
    if (!provider || !model) {
      problems.push(`${slot.name}: 未配置模型`);
      continue;
    }
    const match = providers.find((row) => row.providerKey === provider && publishedEnabled(row));
    if (!match) {
      const known = providers.some((row) => row.providerKey === provider);
      problems.push(
        known
          ? `${slot.name}: 提供方 ${provider} 未启用`
          : `${slot.name}: 提供方 ${provider} 不存在`,
      );
      continue;
    }
    const modelRow = models.find(
      (row) => row.providerId === match.id && row.modelKey === model && publishedEnabled(row),
    );
    if (!modelRow) {
      const known = models.some((row) => row.providerId === match.id && row.modelKey === model);
      problems.push(
        known ? `${slot.name}: 模型 ${model} 未启用` : `${slot.name}: 模型 ${model} 不存在`,
      );
    }
  }
  return { checked, problems };
};

export const projectSystemAgentCapability = (input: {
  checked: number;
  managed: boolean;
  problems: string[];
}): CapabilityReport => {
  if (!input.managed) {
    return report('system_agent_models', 'disabled', { reason: '平台托管模型未开启' });
  }
  if (input.checked === 0) {
    return report('system_agent_models', 'unknown', { reason: '没有启用的系统助手槽位' });
  }
  if (input.problems.length === 0) {
    return report('system_agent_models', 'healthy', { detail: `已核对 ${input.checked} 个槽位` });
  }
  const detail = input.problems.join('；');
  if (input.problems.length >= input.checked) {
    return report('system_agent_models', 'unavailable', { detail, reason: '系统助手模型未就绪' });
  }
  return report('system_agent_models', 'degraded', { detail, reason: '部分系统助手槽位未就绪' });
};

export interface MemoryAvailabilityShape {
  available?: boolean;
  detail?: string;
  model?: string;
  provider?: string;
  reason?: string;
  status?: string;
}

const STATUSES = new Set<CapabilityStatus>([
  'degraded',
  'disabled',
  'healthy',
  'unavailable',
  'unknown',
]);

export const projectMemoryCapability = (input: {
  availability?: unknown;
  missing?: boolean;
}): CapabilityReport => {
  if (input.missing || input.availability == null) {
    return report('memory_embedding', 'unknown', {
      reason: '记忆向量可用性探针尚未接入',
    });
  }
  const value = input.availability;
  if (typeof value !== 'object') {
    return report('memory_embedding', 'unknown', { reason: '记忆向量探针返回无法识别' });
  }
  const record = value as MemoryAvailabilityShape;
  if (typeof record.status === 'string' && STATUSES.has(record.status as CapabilityStatus)) {
    return report('memory_embedding', record.status as CapabilityStatus, {
      detail: typeof record.detail === 'string' ? record.detail : undefined,
      reason: typeof record.reason === 'string' ? record.reason : undefined,
    });
  }
  const provider = typeof record.provider === 'string' ? record.provider : undefined;
  const model = typeof record.model === 'string' ? record.model : undefined;
  const pair = [provider, model].filter(Boolean).join(' / ');
  const detail = (typeof record.detail === 'string' && record.detail) || pair || undefined;
  if (record.available === true) {
    return report('memory_embedding', 'healthy', { detail });
  }
  if (record.available === false) {
    const reasonCode = typeof record.reason === 'string' ? record.reason : '';
    if (reasonCode === 'not_configured') {
      return report('memory_embedding', 'disabled', {
        detail,
        reason: '未配置记忆向量模型',
      });
    }
    const reason =
      reasonCode === 'missing_credentials'
        ? '记忆向量缺少可用密钥'
        : reasonCode || '记忆向量不可用';
    return report('memory_embedding', 'unavailable', { detail, reason });
  }
  return report('memory_embedding', 'unknown', { reason: '记忆向量探针返回无法识别' });
};

export const projectDingtalkCapability = (input: {
  callsToday: number;
  configured: boolean;
  errors10m: number;
  lastError?: string;
  readFailed?: boolean;
}): CapabilityReport => {
  if (input.readFailed) {
    return report('dingtalk_connector', 'unknown', { reason: '无法读取钉钉连接器配置' });
  }
  if (!input.configured) {
    return report('dingtalk_connector', 'disabled', { reason: '未配置钉钉连接器' });
  }
  const calls = `今日 API 调用 ${input.callsToday} 次`;
  if (input.lastError && input.errors10m >= 3) {
    return report('dingtalk_connector', 'unavailable', {
      detail: input.lastError,
      reason: `${calls}，近 10 分钟 ${input.errors10m} 次错误`,
    });
  }
  if (input.lastError) {
    return report('dingtalk_connector', 'degraded', { detail: input.lastError, reason: calls });
  }
  return report('dingtalk_connector', 'healthy', { detail: calls });
};

export const DINGTALK_PERSONAL_BROKER_HEALTH_TIMEOUT_MS = 3_000;

/**
 * Raw DingTalk connector switch `personalDataEnabled`.
 * This is not `getDingtalkPersonalConfig().enabled`, which is already false when
 * the broker env is missing.
 */
export const readDingtalkPersonalDataEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  return (settings as { personalDataEnabled?: unknown }).personalDataEnabled === true;
};

/** Reads the raw switch from the DingTalk connector row. Missing row → off. */
export const loadDingtalkPersonalDataEnabled = async (db: LobeChatDatabase): Promise<boolean> => {
  const { SystemBotProviderModel } = await import('@/database/models/systemBotProvider');
  const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
  const row = await SystemBotProviderModel.findByPlatform(db, 'dingtalk', gateKeeper);
  return readDingtalkPersonalDataEnabled(row?.settings);
};

/**
 * `disabled` when the admin switch is off, even if the broker env is missing
 * (`disabled` does not raise a status alert). Only when the switch is on:
 * broker env missing → `unavailable` (未检测到 aihub-dws 服务), `/healthz` failure
 * → `unavailable`, otherwise `healthy` with `已授权 N 人`.
 * `enabled` is the raw `personalDataEnabled` switch.
 */
export const projectDingtalkPersonalCapability = (input: {
  authorizedCount: number;
  brokerConfigured: boolean;
  enabled: boolean;
  healthOk: boolean;
  readFailed?: boolean;
}): CapabilityReport => {
  if (input.readFailed) {
    return report('dingtalk_personal', 'unknown', { reason: '无法读取钉钉个人数据配置' });
  }
  if (!input.enabled) {
    return report('dingtalk_personal', 'disabled', { reason: '未启用钉钉个人数据' });
  }
  if (!input.brokerConfigured) {
    return report('dingtalk_personal', 'unavailable', { reason: '未检测到 aihub-dws 服务' });
  }
  if (!input.healthOk) {
    return report('dingtalk_personal', 'unavailable', { reason: 'aihub-dws 健康检查失败' });
  }
  const count = Number.isFinite(input.authorizedCount)
    ? Math.max(0, Math.trunc(input.authorizedCount))
    : 0;
  return report('dingtalk_personal', 'healthy', { detail: `已授权 ${count} 人` });
};

/** Internal aihub-dws probe. No auth header. Missing URL or any failure is not healthy. */
export const probeDingtalkPersonalBroker = async (
  env: { DINGTALK_PERSONAL_BROKER_URL?: string } = {
    DINGTALK_PERSONAL_BROKER_URL: process.env.DINGTALK_PERSONAL_BROKER_URL,
  },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<'down' | 'missing' | 'ok'> => {
  const base = env.DINGTALK_PERSONAL_BROKER_URL?.trim().replace(/\/+$/, '');
  if (!base) return 'missing';
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return 'missing';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'missing';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DINGTALK_PERSONAL_BROKER_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/healthz`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return 'down';
    const body = (await response.json()) as { ok?: unknown };
    return body?.ok === true ? 'ok' : 'down';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
};

const loadDingtalkPersonalCapability = async (
  db: LobeChatDatabase,
  env: Record<string, string | undefined>,
): Promise<CapabilityReport> => {
  try {
    const personalDataEnabled = await loadDingtalkPersonalDataEnabled(db);
    if (!personalDataEnabled) {
      return projectDingtalkPersonalCapability({
        authorizedCount: 0,
        brokerConfigured: false,
        enabled: false,
        healthOk: false,
      });
    }
    const { getDingtalkPersonalConfig } =
      await import('@/server/enterprise/services/dingtalkPersonal');
    const config = await getDingtalkPersonalConfig();
    if (!config?.brokerConfigured) {
      return projectDingtalkPersonalCapability({
        authorizedCount: 0,
        brokerConfigured: false,
        enabled: true,
        healthOk: false,
      });
    }
    const health = await probeDingtalkPersonalBroker(env);
    if (health !== 'ok') {
      return projectDingtalkPersonalCapability({
        authorizedCount: 0,
        brokerConfigured: health !== 'missing',
        enabled: true,
        healthOk: false,
      });
    }
    const { DingtalkPersonalAuthorizationModel } =
      await import('@/database/models/dingtalkPersonalAuthorization');
    const authorizedCount = await DingtalkPersonalAuthorizationModel.countActive(db);
    return projectDingtalkPersonalCapability({
      authorizedCount,
      brokerConfigured: true,
      enabled: true,
      healthOk: true,
    });
  } catch {
    return projectDingtalkPersonalCapability({
      authorizedCount: 0,
      brokerConfigured: false,
      enabled: false,
      healthOk: false,
      readFailed: true,
    });
  }
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const boolValue = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const slotConfig = (
  name: (typeof SYSTEM_AGENT_SLOTS)[number],
  published: Map<string, unknown>,
  envAgent: Record<string, { enabled?: boolean; model?: string; provider?: string } | undefined>,
): SystemAgentSlotConfig => {
  const base = DEFAULT_SYSTEM_AGENT_CONFIG[name];
  const fromEnv = envAgent[name];
  const provider =
    stringValue(published.get(`systemAgent.${name}.provider`)) ??
    stringValue(fromEnv?.provider) ??
    base.provider;
  const model =
    stringValue(published.get(`systemAgent.${name}.model`)) ??
    stringValue(fromEnv?.model) ??
    base.model;
  const enabled =
    boolValue(published.get(`systemAgent.${name}.enabled`)) ?? fromEnv?.enabled ?? base.enabled;
  return { enabled, model, name, provider };
};

const dingtalkError = (
  subsystems: readonly RuntimeErrorSummaryItem[],
): { errors10m: number; lastError?: string } => {
  const row = subsystems.find((item) => item.subsystem === 'dingtalk_api');
  if (!row || row.count24h <= 0) return { errors10m: 0 };
  return { errors10m: row.errors10m, ...(row.lastError ? { lastError: row.lastError } : {}) };
};

const loadMemoryAvailability = async (
  db: LobeChatDatabase,
): Promise<{ availability?: unknown; missing?: boolean }> => {
  try {
    const mod = await import('@/server/services/memory/userMemory/embeddingAvailability');
    if (typeof mod.getMemoryEmbeddingAvailability !== 'function') return { missing: true };
    // Platform probe: no end-user session. The helper uses platform credentials
    // first and only falls through to a per-user vault when managed AI is off.
    return {
      availability: await mod.getMemoryEmbeddingAvailability({
        db,
        userId: 'platform-status',
      }),
    };
  } catch {
    return { missing: true };
  }
};

const managedAiEnabled = async (env: Record<string, string | undefined>): Promise<boolean> => {
  if (!parseEnterpriseFeatureFlags(env).ENABLE_PLATFORM_MANAGED_AI) return false;
  try {
    return await isModuleEnabled('managedAi');
  } catch {
    return true;
  }
};

export const loadCapabilities = async (params: {
  db: LobeChatDatabase;
  env?: Record<string, string | undefined>;
  runtime?: readonly RuntimeErrorSummaryItem[];
  sandbox?: AdminSystemSandboxHealth | null;
}): Promise<CapabilityReport[]> => {
  const env = params.env ?? process.env;
  const sandbox = projectSandboxCapability(params.sandbox);

  const memory = projectMemoryCapability(await loadMemoryAvailability(params.db));

  let systemAgent: CapabilityReport;
  try {
    const managed = await managedAiEnabled(env);
    if (!managed) {
      systemAgent = projectSystemAgentCapability({ checked: 0, managed: false, problems: [] });
    } else {
      let envAgent: Record<string, { enabled?: boolean; model?: string; provider?: string }> = {};
      try {
        envAgent = parseSystemAgent(env.SYSTEM_AGENT) as typeof envAgent;
      } catch {
        envAgent = {};
      }
      const policies = await new PlatformSettingsModel(params.db).listPublishedPolicies();
      const published = new Map(policies.map((row) => [row.path, row.value]));
      const slots = SYSTEM_AGENT_SLOTS.map((name) => slotConfig(name, published, envAgent));
      const providers = await params.db
        .select({
          enabled: platformAiProviders.enabled,
          id: platformAiProviders.id,
          providerKey: platformAiProviders.providerKey,
          status: platformAiProviders.status,
        })
        .from(platformAiProviders);
      const models = await params.db
        .select({
          enabled: platformAiModels.enabled,
          modelKey: platformAiModels.modelKey,
          providerId: platformAiModels.providerId,
          status: platformAiModels.status,
        })
        .from(platformAiModels);
      const found = findSystemAgentProblems(slots, providers, models);
      systemAgent = projectSystemAgentCapability({ ...found, managed: true });
    }
  } catch {
    systemAgent = report('system_agent_models', 'unknown', { reason: '无法读取系统助手模型配置' });
  }

  let dingtalk: CapabilityReport;
  try {
    const { getMessengerDingTalkConfig } = await import('@/config/messenger');
    const { getDingtalkApiCallStats } =
      await import('@/server/enterprise/services/dingtalkWorkspace/apiCallStats');
    const config = await getMessengerDingTalkConfig();
    const stats = config ? await getDingtalkApiCallStats({ days: 1 }) : { days: [], total: 0 };
    const callsToday = stats.days.reduce((sum, day) => sum + day.total, 0);
    const errors = dingtalkError(params.runtime ?? []);
    dingtalk = projectDingtalkCapability({
      callsToday,
      configured: Boolean(config),
      ...errors,
    });
  } catch {
    dingtalk = projectDingtalkCapability({
      callsToday: 0,
      configured: false,
      errors10m: 0,
      readFailed: true,
    });
  }

  const personal = await loadDingtalkPersonalCapability(params.db, env);

  // Stable order for the status page.
  return [memory, systemAgent, dingtalk, personal, sandbox];
};

/** Used when the readiness read itself throws — sandbox still reflects the probe. */
export const fallbackCapabilities = (
  sandbox: AdminSystemSandboxHealth | null | undefined,
): CapabilityReport[] => [
  projectMemoryCapability({ missing: true }),
  report('system_agent_models', 'unknown', { reason: '无法读取系统助手模型配置' }),
  projectDingtalkCapability({ callsToday: 0, configured: false, errors10m: 0, readFailed: true }),
  projectDingtalkPersonalCapability({
    authorizedCount: 0,
    brokerConfigured: false,
    enabled: false,
    healthOk: false,
    readFailed: true,
  }),
  projectSandboxCapability(sandbox),
];
