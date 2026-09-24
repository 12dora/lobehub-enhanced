import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { CURRENT_VERSION } from '@lobechat/const';

import { PlatformStatusSettingsModel } from '@/database/models/platform/statusSettings';
import { PlatformInstanceRepository } from '@/database/repositories/platformInstance';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { appEnv } from '@/envs/app';
import type { AdminSystemGetStatusOutput } from '@/server/enterprise/contracts/adminSystem';
import type { AdminSystemStatusApiView } from '@/server/enterprise/contracts/adminSystem/statusApi';
import {
  getDingtalkApiCallTotal,
  readDingtalkApiDailyAlertThreshold,
} from '@/server/enterprise/services/dingtalkWorkspace/apiCallStats';

import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../audit/auditActionCatalog';
import { resolveServerRuntimeBranding } from '../branding/runtimeBranding';
import { PlatformAuditService } from '../platformAudit';
import { getPlatformInstanceId } from '../platformInstance/heartbeatRuntime';
import { PlatformSystemAdminService } from './adminService';
import { scrubRuntimeErrorMessage } from './runtimeErrors';
import { readStatusAlertUnhealthySince, statusAlertIdForComponent } from './statusAlerts';
import {
  readCachedStatusAlertRuntime,
  resolveDingtalkApiAlertThreshold,
} from './statusAlertSettings';
import { mutationFailureCategory } from './statusProjection';

export const STATUS_API_SCHEMA_VERSION = 1;
export const STATUS_API_TOKEN_PREFIX = 'sk-status-';
export const STATUS_API_TOKEN_BODY_LENGTH = 32;
export const STATUS_API_SUMMARY_CACHE_MS = 15_000;
/** Successful token-hash reads are reused for this long. A failed read keeps the last copy. */
export const STATUS_API_TOKEN_CACHE_MS = 60_000;
/** Same active window the status page treats as a current runtime error. */
export const STATUS_API_RUNTIME_SPIKE_MS = 60 * 60 * 1000;
const TOKEN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };
const DUMMY_DIGEST = Buffer.alloc(32);

export type StatusApiComponentStatus =
  'degraded' | 'disabled' | 'healthy' | 'unavailable' | 'unknown';

export type StatusApiOverallStatus = 'degraded' | 'operational' | 'outage' | 'unknown';

export interface StatusApiComponent {
  group: 'budget' | 'capability' | 'dependency' | 'runtime' | 'worker';
  id: string;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  message: string | null;
  name: string;
  status: StatusApiComponentStatus;
}

export interface StatusApiSummary {
  checkedAt: string;
  components: StatusApiComponent[];
  incidents: {
    componentId: string;
    level: 'error' | 'warning';
    message: string | null;
    since: string | null;
  }[];
  metrics: {
    dingtalkApiCallsToday: number | null;
    dingtalkApiDailyThreshold: number | null;
    instances: { live: number; offline: number };
    jobs: { active: number; failed: number };
    runtimeErrors24h: number;
  };
  schemaVersion: typeof STATUS_API_SCHEMA_VERSION;
  service: {
    gitSha: string | null;
    id: 'aihub';
    instanceId: string;
    name: string;
    url: string;
    version: string;
  };
  status: StatusApiOverallStatus;
}

export interface StatusApiEvent {
  at: string;
  componentId: string;
  id: string;
  level: 'error' | 'info' | 'warning';
  message: string;
}

export type StatusApiAuthDecision =
  | { ok: true }
  | { error: 'not_configured' | 'unauthorized' | 'unavailable'; ok: false; status: 401 | 503 };

const denyStatusApi = (
  error: 'not_configured' | 'unauthorized' | 'unavailable',
  status: 401 | 503,
): StatusApiAuthDecision => ({ error, ok: false, status });

const COMPONENT_STATUSES = new Set<StatusApiComponentStatus>([
  'degraded',
  'disabled',
  'healthy',
  'unavailable',
  'unknown',
]);

const DEPENDENCY_ORDER = [
  'database',
  'redis',
  'objectStorage',
  'mail',
  'keyManagement',
  'sandbox',
  'documentRender',
] as const;

const DEPENDENCY_NAMES: Record<(typeof DEPENDENCY_ORDER)[number], string> = {
  database: '数据库',
  documentRender: '文档渲染',
  keyManagement: '密钥管理',
  mail: '邮件服务',
  objectStorage: '对象存储',
  redis: 'Redis',
  sandbox: '沙箱',
};

const DEPENDENCY_ERROR_TEXT: Record<string, string> = {
  configuration_incomplete: '配置不完整',
  operation_unavailable: '无法连接',
  passive_check_only: '仅检查了配置，未实际连接',
  timeout: '健康检查超时',
};

const CAPABILITY_NAMES: Record<string, string> = {
  dingtalk_connector: '钉钉连接器',
  dingtalk_personal: '钉钉个人数据',
  memory_embedding: '记忆向量',
  sandbox: '沙箱',
  system_agent_models: '系统助手模型',
};

const WORKER_NAMES: Record<string, string> = {
  approval_worker: '钉钉自动审批',
  directory_sync: '钉钉通讯录同步',
  dingtalk_stream: '钉钉 Stream',
  document_render: '文档渲染',
  global_file_orphan_gc: '孤儿文件清理',
  reminder: '提醒',
  task_scheduler: '定时任务',
  task_sweep: '定时扫描',
  task_watchdog: '任务看门狗',
};

const RUNTIME_NAMES: Record<string, string> = {
  approval_worker: '钉钉自动审批',
  dingtalk_api: '钉钉接口',
  dingtalk_stream: '钉钉 Stream',
  document_export: '文件导出',
  document_render: '文档渲染',
  local_system: '本机系统工具',
  market: '技能市场',
  memory: '记忆',
  reminder_worker: '提醒',
  sandbox: '沙箱',
  system_agent: '系统助手',
  task_scheduler: '定时任务',
};

let summaryCache: { at: number; body: StatusApiSummary } | null = null;
let summaryInflight: Promise<StatusApiSummary> | null = null;
let tokenHashCache: { at: number; hash: string | null } | undefined;

export const resetStatusApiSummaryCacheForTest = (): void => {
  summaryCache = null;
  summaryInflight = null;
};

export const resetStatusApiTokenCacheForTest = (): void => {
  tokenHashCache = undefined;
};

/** Pure cache step so a database outage can still authenticate with the last good hash. */
export const resolveCachedTokenHash = (
  cache: { at: number; hash: string | null } | undefined,
  now: number,
  read: { hash: string | null; ok: true } | { ok: false },
  ttlMs: number = STATUS_API_TOKEN_CACHE_MS,
): {
  cache: { at: number; hash: string | null } | undefined;
  hash: string | null;
  settingsUnreadable: boolean;
} => {
  if (cache && now - cache.at < ttlMs) {
    return { cache, hash: cache.hash, settingsUnreadable: false };
  }
  if (!read.ok) {
    if (cache) return { cache, hash: cache.hash, settingsUnreadable: false };
    return { cache: undefined, hash: null, settingsUnreadable: true };
  }
  const next = { at: now, hash: read.hash };
  return { cache: next, hash: read.hash, settingsUnreadable: false };
};

export const rememberStatusApiTokenHash = (hash: string | null, now: number = Date.now()): void => {
  tokenHashCache = { at: now, hash };
};

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { headers: NO_STORE, status });

const errorClassOf = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

const iso = (value: Date | null | undefined): string | null => {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
};

const coerceDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const asStatus = (value: string): StatusApiComponentStatus =>
  COMPONENT_STATUSES.has(value as StatusApiComponentStatus)
    ? (value as StatusApiComponentStatus)
    : 'unknown';

const publicMessage = (...candidates: (string | null | undefined)[]): string | null => {
  for (const candidate of candidates) {
    const text = candidate?.trim();
    if (!text) continue;
    const scrubbed = scrubRuntimeErrorMessage(text);
    if (scrubbed) return scrubbed;
  }
  return null;
};

export const appUrlBase = (): string =>
  (process.env.APP_URL ?? appEnv.APP_URL ?? '').trim().replace(/\/$/, '');

export const statusApiEndpoints = (base = appUrlBase()) => {
  const path = (suffix: string) => (base ? `${base}${suffix}` : suffix);
  return {
    events: path('/api/status/v1/events'),
    health: path('/api/status/v1/health'),
    summary: path('/api/status/v1/summary'),
  };
};

const envToken = (): string | null => {
  const value = process.env.STATUS_API_TOKEN?.trim();
  return value ? value : null;
};

export const hashStatusApiToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const digestOf = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

const digestsEqual = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

/** Compare sha256 digests. A missing or malformed hash still runs a dummy compare. */
const hashMatches = (presented: Buffer, hex: string | null): boolean => {
  const valid = Boolean(hex && SHA256_HEX.test(hex));
  const expected = valid ? Buffer.from(hex!, 'hex') : DUMMY_DIGEST;
  const equal = digestsEqual(presented, expected);
  return valid && equal;
};

export const createStatusApiToken = (): { hash: string; hint: string; token: string } => {
  const chars: string[] = [];
  while (chars.length < STATUS_API_TOKEN_BODY_LENGTH) {
    const bytes = randomBytes(STATUS_API_TOKEN_BODY_LENGTH);
    for (const byte of bytes) {
      // 256 is not divisible by 62; drop the tail so the alphabet stays uniform.
      if (byte >= 248) continue;
      chars.push(TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]!);
      if (chars.length === STATUS_API_TOKEN_BODY_LENGTH) break;
    }
  }
  const token = `${STATUS_API_TOKEN_PREFIX}${chars.join('')}`;
  return {
    hash: hashStatusApiToken(token),
    hint: `${STATUS_API_TOKEN_PREFIX}…${token.slice(-4)}`,
    token,
  };
};

const bearerToken = (authorization: string | null): string | null => {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  const token = match?.[1];
  if (!token || token.length > 512) return null;
  return token;
};

export const authorizeStatusApiBearer = (params: {
  authorization: string | null;
  dbTokenHash: string | null;
  envToken: string | null;
  settingsUnreadable?: boolean;
}): StatusApiAuthDecision => {
  const configuredEnv = params.envToken?.trim() || null;
  const dbHash = params.dbTokenHash?.trim() || null;
  if (params.settingsUnreadable && !dbHash && !configuredEnv) {
    return denyStatusApi('unavailable', 503);
  }
  if (!dbHash && !configuredEnv) {
    return denyStatusApi('not_configured', 503);
  }
  const token = bearerToken(params.authorization);
  if (!token) return denyStatusApi('unauthorized', 401);
  const presented = digestOf(token);
  const dbOk = hashMatches(presented, dbHash);
  const envOk = hashMatches(presented, configuredEnv ? hashStatusApiToken(configuredEnv) : null);
  return dbOk || envOk ? { ok: true } : denyStatusApi('unauthorized', 401);
};

const dependencyMessage = (health: {
  detail?: string;
  errorCategory?: string | null;
  lastError?: string;
  status: string;
}): string | null => {
  if (health.status === 'healthy' || health.status === 'disabled' || health.status === 'unknown') {
    return publicMessage(health.detail);
  }
  return publicMessage(
    health.lastError,
    health.errorCategory ? DEPENDENCY_ERROR_TEXT[health.errorCategory] : undefined,
    health.detail,
  );
};

const workerMessage = (worker: {
  lastError?: string;
  started: boolean;
  status: string;
}): string | null => {
  if (worker.lastError) return publicMessage(worker.lastError);
  if (worker.status === 'unavailable' && !worker.started) return '未启动';
  if (worker.status === 'degraded') return '长时间无心跳';
  return null;
};

export const buildStatusApiComponents = (
  snapshot: Pick<
    AdminSystemGetStatusOutput,
    'capabilities' | 'dependencies' | 'runtimeErrors' | 'snapshotAt' | 'workers'
  >,
  budget: { callsToday: number | null; threshold: number | null },
): StatusApiComponent[] => {
  const components: StatusApiComponent[] = [];
  for (const key of DEPENDENCY_ORDER) {
    const health = snapshot.dependencies[key];
    if (!health) continue;
    components.push({
      group: 'dependency',
      id: `dependency.${key}`,
      lastCheckedAt: iso(health.lastCheckedAt),
      latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : null,
      message: dependencyMessage({
        detail: health.detail,
        errorCategory: health.errorCategory,
        lastError:
          'lastError' in health && typeof health.lastError === 'string'
            ? health.lastError
            : undefined,
        status: health.status,
      }),
      name: DEPENDENCY_NAMES[key],
      status: asStatus(health.status),
    });
  }
  const sandboxDependency = Boolean(snapshot.dependencies.sandbox);
  for (const capability of snapshot.capabilities) {
    if (capability.key === 'sandbox' && sandboxDependency) continue;
    components.push({
      group: 'capability',
      id: `capability.${capability.key}`,
      lastCheckedAt: null,
      latencyMs: null,
      message: publicMessage(capability.reason, capability.detail),
      name: CAPABILITY_NAMES[capability.key] ?? '能力',
      status: asStatus(capability.status),
    });
  }
  for (const worker of snapshot.workers) {
    components.push({
      group: 'worker',
      id: `worker.${worker.name}`,
      lastCheckedAt: iso(worker.lastTickAt),
      latencyMs: null,
      message: workerMessage(worker),
      name: WORKER_NAMES[worker.name] ?? '后台任务',
      status: asStatus(worker.status),
    });
  }
  for (const error of snapshot.runtimeErrors) {
    const lastAt = error.lastAt.getTime();
    if (!Number.isFinite(lastAt)) continue;
    if (snapshot.snapshotAt.getTime() - lastAt > STATUS_API_RUNTIME_SPIKE_MS) continue;
    components.push({
      group: 'runtime',
      id: `runtime.${error.subsystem}`,
      lastCheckedAt: iso(error.lastAt),
      latencyMs: null,
      message: publicMessage(error.lastError),
      name: RUNTIME_NAMES[error.subsystem] ?? '运行时错误',
      status: 'unavailable',
    });
  }
  let budgetStatus: StatusApiComponentStatus = 'disabled';
  let budgetMessage: string | null = null;
  if (budget.threshold != null && budget.threshold > 0) {
    if (budget.callsToday == null) {
      budgetStatus = 'unknown';
    } else if (budget.callsToday >= budget.threshold) {
      budgetStatus = 'degraded';
      budgetMessage = `今日调用 ${budget.callsToday} 次，已达到阈值 ${budget.threshold}`;
    } else {
      budgetStatus = 'healthy';
      budgetMessage = `今日调用 ${budget.callsToday} 次`;
    }
  }
  components.push({
    group: 'budget',
    id: 'budget.dingtalk_api',
    lastCheckedAt: iso(snapshot.snapshotAt),
    latencyMs: null,
    message: budgetMessage,
    name: '钉钉接口今日调用量',
    status: budgetStatus,
  });
  return components;
};

export const deriveStatusApiOverall = (
  components: readonly StatusApiComponent[],
): StatusApiOverallStatus => {
  const database = components.find((item) => item.id === 'dependency.database');
  const redis = components.find((item) => item.id === 'dependency.redis');
  if (database?.status === 'unavailable' || redis?.status === 'unavailable') return 'outage';
  const incident = components.some(
    (item) => item.status === 'degraded' || item.status === 'unavailable',
  );
  return incident ? 'degraded' : 'operational';
};

const incidentsOf = (
  components: readonly StatusApiComponent[],
  sinceByAlertId?: ReadonlyMap<string, string>,
): StatusApiSummary['incidents'] =>
  components
    .filter((item) => item.status === 'degraded' || item.status === 'unavailable')
    .map((item) => {
      const alertId = statusAlertIdForComponent(item.id);
      const since = alertId ? (sinceByAlertId?.get(alertId) ?? null) : null;
      return {
        componentId: item.id,
        level: item.status === 'unavailable' ? ('error' as const) : ('warning' as const),
        message: item.message,
        since,
      };
    });

export const buildStatusApiSummary = (
  snapshot: Pick<
    AdminSystemGetStatusOutput,
    'build' | 'capabilities' | 'dependencies' | 'jobs' | 'runtimeErrors' | 'snapshotAt' | 'workers'
  >,
  extras: {
    callsToday: number | null;
    incidentSince?: ReadonlyMap<string, string>;
    instanceId: string;
    instances: { live: number; offline: number };
    siteName: string;
    threshold: number | null;
    url: string;
  },
): StatusApiSummary => {
  const components = buildStatusApiComponents(snapshot, {
    callsToday: extras.callsToday,
    threshold: extras.threshold,
  });
  return {
    checkedAt: snapshot.snapshotAt.toISOString(),
    components,
    incidents: incidentsOf(components, extras.incidentSince),
    metrics: {
      dingtalkApiCallsToday: extras.callsToday,
      dingtalkApiDailyThreshold: extras.threshold,
      instances: extras.instances,
      jobs: { active: snapshot.jobs.active, failed: snapshot.jobs.failed },
      runtimeErrors24h: snapshot.runtimeErrors.reduce((sum, item) => sum + item.count24h, 0),
    },
    schemaVersion: STATUS_API_SCHEMA_VERSION,
    service: {
      gitSha: snapshot.build.gitSha,
      id: 'aihub',
      instanceId: extras.instanceId,
      name: extras.siteName,
      url: extras.url,
      version: snapshot.build.version,
    },
    status: deriveStatusApiOverall(components),
  };
};

export const buildUnknownStatusApiSummary = (params: {
  checkedAt: Date;
  instanceId: string;
  siteName: string;
  url: string;
}): StatusApiSummary => ({
  checkedAt: params.checkedAt.toISOString(),
  components: [],
  incidents: [],
  metrics: {
    dingtalkApiCallsToday: null,
    dingtalkApiDailyThreshold: null,
    instances: { live: 0, offline: 0 },
    jobs: { active: 0, failed: 0 },
    runtimeErrors24h: 0,
  },
  schemaVersion: STATUS_API_SCHEMA_VERSION,
  service: {
    gitSha: null,
    id: 'aihub',
    instanceId: params.instanceId,
    name: params.siteName,
    url: params.url,
    version: CURRENT_VERSION,
  },
  status: 'unknown',
});

/** Alert ids (`dependency:database`, `spike:market`) use the same ids as summary components. */
export const statusEventComponentId = (subsystem: string): string => {
  const raw = subsystem.trim();
  const colon = raw.indexOf(':');
  if (colon === -1) return `runtime.${raw}`;
  const kind = raw.slice(0, colon);
  const name = raw.slice(colon + 1);
  if (kind === 'spike') return `runtime.${name}`;
  if (kind === 'dependency' || kind === 'worker' || kind === 'capability' || kind === 'budget') {
    return `${kind}.${name}`;
  }
  return `runtime.${name || raw}`;
};

export const buildStatusApiEvents = (
  events: readonly {
    at: number;
    level: StatusApiEvent['level'];
    message: string;
    subsystem: string;
  }[],
  query: { limit: number; since: number | null },
): { events: StatusApiEvent[] } => {
  const visible = events
    .filter((event) => query.since == null || event.at > query.since)
    .slice(0, query.limit);
  return {
    events: visible.map((event) => ({
      at: new Date(event.at).toISOString(),
      componentId: statusEventComponentId(event.subsystem),
      id: `evt_${createHash('sha256')
        .update(`${event.at}|${event.level}|${event.subsystem}|${event.message}`)
        .digest('hex')
        .slice(0, 16)}`,
      level: event.level,
      message: publicMessage(event.message) ?? '',
    })),
  };
};

export const parseStatusEventsQuery = (
  searchParams: URLSearchParams,
): { error: 'invalid_request' } | { limit: number; since: number | null } => {
  const limitRaw = searchParams.get('limit');
  let limit = 50;
  if (limitRaw != null) {
    if (!/^\d{1,3}$/.test(limitRaw)) return { error: 'invalid_request' };
    limit = Number(limitRaw);
    if (limit < 1 || limit > 200) return { error: 'invalid_request' };
  }
  const sinceRaw = searchParams.get('since');
  if (sinceRaw == null || sinceRaw.trim() === '') return { limit, since: null };
  const since = Date.parse(sinceRaw);
  if (!Number.isFinite(since)) return { error: 'invalid_request' };
  return { limit, since };
};

export const buildStatusApiHealth = (now: Date = new Date()) => ({
  service: 'aihub' as const,
  status: 'ok' as const,
  time: now.toISOString(),
  version: CURRENT_VERSION,
});

export const buildStatusApiView = (params: {
  createdAt: Date | null;
  envTokenConfigured: boolean;
  tokenHint: string | null;
  tokenSet: boolean;
}): AdminSystemStatusApiView => ({
  createdAt: iso(params.createdAt),
  endpoints: statusApiEndpoints(),
  envTokenConfigured: params.envTokenConfigured,
  tokenHint: params.tokenHint,
  tokenSet: params.tokenSet,
});

const settingsModel = (db: LobeChatDatabase | Transaction) => new PlatformStatusSettingsModel(db);

export const getStatusApiView = async (db: LobeChatDatabase): Promise<AdminSystemStatusApiView> => {
  const row = await settingsModel(db).get();
  return buildStatusApiView({
    createdAt: coerceDate(row?.apiTokenCreatedAt),
    envTokenConfigured: Boolean(envToken()),
    tokenHint: row?.apiTokenHint ?? null,
    tokenSet: Boolean(row?.apiTokenHash),
  });
};

const appendStatusApiAudit = async (
  db: LobeChatDatabase | Transaction,
  params: {
    action:
      typeof AUDIT_ACTION.SYSTEM_STATUS_API_ROTATE | typeof AUDIT_ACTION.SYSTEM_STATUS_API_REVOKE;
    actorUserId: string;
    afterDiff: Record<string, unknown>;
    reason?: string | null;
    result: 'failure' | 'success';
  },
) => {
  await new PlatformAuditService(db).append({
    action: params.action,
    actorUserId: params.actorUserId,
    afterDiff: params.afterDiff,
    reason: params.reason ?? null,
    result: params.result,
    targetId: 'status_api',
    targetType: AUDIT_TARGET_TYPE.SYSTEM,
  });
};

export const rotateStatusApiToken = async (
  db: LobeChatDatabase,
  actorUserId: string,
  reason?: string | null,
) => {
  const created = createStatusApiToken();
  const createdAt = new Date();
  try {
    const view = await db.transaction(async (tx) => {
      await settingsModel(tx).setApiToken({
        createdAt,
        hash: created.hash,
        hint: created.hint,
        updatedBy: actorUserId,
      });
      await appendStatusApiAudit(tx, {
        action: AUDIT_ACTION.SYSTEM_STATUS_API_ROTATE,
        actorUserId,
        afterDiff: { hint: created.hint },
        reason,
        result: 'success',
      });
      return buildStatusApiView({
        createdAt,
        envTokenConfigured: Boolean(envToken()),
        tokenHint: created.hint,
        tokenSet: true,
      });
    });
    rememberStatusApiTokenHash(created.hash);
    return { token: created.token, view };
  } catch (error) {
    try {
      await appendStatusApiAudit(db, {
        action: AUDIT_ACTION.SYSTEM_STATUS_API_ROTATE,
        actorUserId,
        afterDiff: { error: mutationFailureCategory(error) },
        reason,
        result: 'failure',
      });
    } catch (auditError) {
      console.error('[status-api] rotate failure audit unavailable', {
        errorClass: errorClassOf(auditError),
      });
    }
    throw error;
  }
};

export const revokeStatusApiToken = async (
  db: LobeChatDatabase,
  actorUserId: string,
  reason?: string | null,
): Promise<AdminSystemStatusApiView> => {
  try {
    const view = await db.transaction(async (tx) => {
      await settingsModel(tx).setApiToken({ clear: true, updatedBy: actorUserId });
      await appendStatusApiAudit(tx, {
        action: AUDIT_ACTION.SYSTEM_STATUS_API_REVOKE,
        actorUserId,
        afterDiff: { revoked: true },
        reason,
        result: 'success',
      });
      return buildStatusApiView({
        createdAt: null,
        envTokenConfigured: Boolean(envToken()),
        tokenHint: null,
        tokenSet: false,
      });
    });
    rememberStatusApiTokenHash(null);
    return view;
  } catch (error) {
    try {
      await appendStatusApiAudit(db, {
        action: AUDIT_ACTION.SYSTEM_STATUS_API_REVOKE,
        actorUserId,
        afterDiff: { error: mutationFailureCategory(error) },
        reason,
        result: 'failure',
      });
    } catch (auditError) {
      console.error('[status-api] revoke failure audit unavailable', {
        errorClass: errorClassOf(auditError),
      });
    }
    throw error;
  }
};

const loadAuthMaterial = async (
  db: LobeChatDatabase,
): Promise<{ dbTokenHash: string | null; settingsUnreadable: boolean }> => {
  const now = Date.now();
  if (tokenHashCache && now - tokenHashCache.at < STATUS_API_TOKEN_CACHE_MS) {
    return { dbTokenHash: tokenHashCache.hash, settingsUnreadable: false };
  }
  try {
    const row = await settingsModel(db).get();
    const resolved = resolveCachedTokenHash(tokenHashCache, now, {
      hash: row?.apiTokenHash?.trim() || null,
      ok: true,
    });
    tokenHashCache = resolved.cache;
    return { dbTokenHash: resolved.hash, settingsUnreadable: false };
  } catch (error) {
    console.error('[status-api] token lookup failed', { errorClass: errorClassOf(error) });
    const resolved = resolveCachedTokenHash(tokenHashCache, now, { ok: false });
    return { dbTokenHash: resolved.hash, settingsUnreadable: resolved.settingsUnreadable };
  }
};

const authorizeRequest = async (
  request: Request,
  db: LobeChatDatabase,
): Promise<Response | null> => {
  const material = await loadAuthMaterial(db);
  const decision = authorizeStatusApiBearer({
    authorization: request.headers.get('authorization'),
    dbTokenHash: material.dbTokenHash,
    envToken: envToken(),
    settingsUnreadable: material.settingsUnreadable,
  });
  if (decision.ok) return null;
  return json({ error: decision.error }, decision.status);
};

const siteName = async (): Promise<string> => {
  try {
    const branding = await resolveServerRuntimeBranding();
    const name = branding.name?.trim();
    if (name) return name;
  } catch (error) {
    console.error('[status-api] site title unavailable', { errorClass: errorClassOf(error) });
  }
  return '平台';
};

const loadBudget = async (): Promise<{ callsToday: number | null; threshold: number | null }> => {
  let rawThreshold = readDingtalkApiDailyAlertThreshold();
  try {
    const runtime = await readCachedStatusAlertRuntime();
    rawThreshold = resolveDingtalkApiAlertThreshold(runtime.settings);
  } catch (error) {
    console.error('[status-api] alert threshold unavailable', { errorClass: errorClassOf(error) });
  }
  const threshold = rawThreshold > 0 ? rawThreshold : null;
  try {
    const day = await getDingtalkApiCallTotal();
    return { callsToday: day ? day.total : null, threshold };
  } catch (error) {
    console.error('[status-api] api budget unavailable', { errorClass: errorClassOf(error) });
    return { callsToday: null, threshold };
  }
};

const loadInstances = async (
  db: LobeChatDatabase,
  snapshotAt: Date,
): Promise<{ live: number; offline: number }> => {
  try {
    return await new PlatformInstanceRepository(db).countInstancesByFreshness(snapshotAt);
  } catch (error) {
    console.error('[status-api] instance counts unavailable', { errorClass: errorClassOf(error) });
    return { live: 0, offline: 0 };
  }
};

export const loadStatusApiSummary = async (
  db: LobeChatDatabase,
  now: number = Date.now(),
): Promise<StatusApiSummary> => {
  if (summaryCache && now - summaryCache.at < STATUS_API_SUMMARY_CACHE_MS) {
    return summaryCache.body;
  }
  if (summaryInflight) return summaryInflight;
  const pending = (async (): Promise<StatusApiSummary> => {
    try {
      const snapshot = await new PlatformSystemAdminService(db).getStatus();
      const [name, budget, instances, incidentSince] = await Promise.all([
        siteName(),
        loadBudget(),
        loadInstances(db, snapshot.snapshotAt),
        readStatusAlertUnhealthySince().catch(() => new Map<string, string>()),
      ]);
      let instanceId = 'unknown';
      try {
        instanceId = getPlatformInstanceId();
      } catch {
        instanceId = 'unknown';
      }
      const body = buildStatusApiSummary(snapshot, {
        callsToday: budget.callsToday,
        incidentSince,
        instanceId,
        instances,
        siteName: name,
        threshold: budget.threshold,
        url: appUrlBase(),
      });
      summaryCache = { at: now, body };
      return body;
    } catch (error) {
      console.error('[status-api] summary unavailable', { errorClass: errorClassOf(error) });
      return buildUnknownStatusApiSummary({
        checkedAt: new Date(now),
        instanceId: 'unknown',
        siteName: '平台',
        url: appUrlBase(),
      });
    }
  })();
  summaryInflight = pending;
  try {
    return await pending;
  } finally {
    if (summaryInflight === pending) summaryInflight = null;
  }
};

const database = async (): Promise<LobeChatDatabase> => {
  const { serverDB } = await import('@/database/server');
  return serverDB;
};

export const serveStatusHealth = async (): Promise<Response> => json(buildStatusApiHealth());

export const serveStatusSummary = async (request: Request): Promise<Response> => {
  const db = await database();
  const denied = await authorizeRequest(request, db);
  if (denied) return denied;
  return json(await loadStatusApiSummary(db));
};

export const serveStatusEvents = async (request: Request): Promise<Response> => {
  const db = await database();
  const denied = await authorizeRequest(request, db);
  if (denied) return denied;
  const parsed = parseStatusEventsQuery(new URL(request.url).searchParams);
  if ('error' in parsed) return json({ error: parsed.error }, 400);
  const { readRuntimeErrorSummary } = await import('./runtimeErrors');
  const summary = await readRuntimeErrorSummary();
  return json(buildStatusApiEvents(summary.events, parsed));
};
