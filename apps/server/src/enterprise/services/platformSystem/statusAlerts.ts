import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { PLATFORM_SYSTEM_ROLES } from '@/const/platform/roles';
import { users } from '@/database/schemas';
import { roles, userRoles } from '@/database/schemas/rbac';
import type { LobeChatDatabase } from '@/database/type';
import {
  getDingtalkApiCallTotal,
  topDingtalkApiCallEndpoints,
} from '@/server/enterprise/services/dingtalkWorkspace/apiCallStats';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import {
  DEFAULT_STATUS_ALERT_SETTINGS,
  type StatusAlertSettings,
} from '@/types/platform/statusAlerts';

import type { CapabilityReport } from './capabilities';
import {
  appendRuntimeEvent,
  RUNTIME_ERROR_SPIKE_COUNT,
  scrubRuntimeErrorMessage,
} from './runtimeErrors';
import {
  deliverStatusAlertChannels,
  postDingtalkRobotMarkdown,
  sendStatusAlertEmail,
} from './statusAlertChannels';
import {
  emptyStatusAlertRuntime,
  invalidateStatusAlertSettingsCache,
  isStatusAlertMailConfigured,
  isStatusAlertNotifyAppConfigured,
  loadStatusAlertRuntime,
  readCachedStatusAlertRuntime,
  resolveDingtalkApiAlertThreshold,
  type StatusAlertRuntime,
} from './statusAlertSettings';
import type { WorkerHealth } from './workerHealth';

/** Global admin roles. `platform_user` is every signed-in member and is not alerted. */
export const PLATFORM_ADMIN_ALERT_ROLES = [
  PLATFORM_SYSTEM_ROLES.SUPER_ADMIN,
  PLATFORM_SYSTEM_ROLES.USER_ADMIN,
  PLATFORM_SYSTEM_ROLES.AI_ADMIN,
  PLATFORM_SYSTEM_ROLES.IDENTITY_ADMIN,
  PLATFORM_SYSTEM_ROLES.AUDITOR,
] as const;

export const STATUS_ALERT_INTERVAL_MS = 60_000;
export const STATUS_ALERT_DEDUP_MS = 6 * 60 * 60 * 1000;
/**
 * Recent-events ring cap. A flapping component records at most one row per health
 * (unhealthy or recovered) inside this window. The alert state map still updates
 * on every tick, so the next real change is not lost. Send dedupe is separate
 * and uses `repeatIntervalHours`.
 */
export const STATUS_ALERT_RECORD_WINDOW_MS = 10 * 60 * 1000;
export const DINGTALK_API_BUDGET_ALERT_ID = 'budget:dingtalk_api';
export const DINGTALK_API_BUDGET_ALERT_LABEL = '钉钉 API 今日调用量';
/** Stored next to the budget tile so a midnight counter reset is not a recovery. */
const BUDGET_ALERT_DAY_FIELD = `${DINGTALK_API_BUDGET_ALERT_ID}:day`;
const RECORD_KEY_PREFIX = 'platform:status-alert:record:';
const STATUS_ALERT_RECORD_TTL_SECONDS = STATUS_ALERT_RECORD_WINDOW_MS / 1000;
const LOCK_KEY = 'platform:status-alert:lock';
const LOCK_TTL_SECONDS = 50;
const STATE_KEY = 'platform:status-alert:state';
const STATE_TTL_SECONDS = 7 * 24 * 60 * 60;
const STATUS_ALERT_TEXT_MAX = 1500;
const STATUS_ALERT_LINE_MAX = 12;
/** One warn per outage window, not one per 60s tick. */
export const REDIS_UNAVAILABLE_WARN_MS = 10 * 60 * 1000;
let lastRedisUnavailableWarnAt = 0;

const RELEASE_LOCK =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type AlertHealth = 'healthy' | 'unhealthy';

export interface AlertComponent {
  /** Shanghai calendar day this reading belongs to. Set on the API budget tile. */
  day?: string;
  detail?: string;
  id: string;
  label: string;
  status: string;
}

export interface AlertTransition {
  /** Day of this reading. Compared with {@link previousDay} for the API budget tile. */
  day?: string;
  detail?: string;
  id: string;
  label: string;
  next: AlertHealth;
  previous?: AlertHealth;
  /** Day stored with the previous budget tile. A different day is a counter reset, not a drop. */
  previousDay?: string;
  status: string;
}

export interface StatusAlertSnapshot {
  capabilities: readonly CapabilityReport[];
  dependencies: Record<string, { detail?: string; lastError?: string; status: string } | undefined>;
  spikes: readonly { errors10m: number; lastError?: string; subsystem: string }[];
  workers: readonly WorkerHealth[];
}

const DEPENDENCY_LABELS: Record<string, string> = {
  database: '数据库',
  documentRender: '文档渲染',
  keyManagement: '密钥管理',
  objectStorage: '对象存储',
  redis: 'Redis',
  sandbox: '沙箱',
};

const WORKER_LABELS: Record<string, string> = {
  approval_worker: '钉钉自动审批',
  directory_sync: '钉钉通讯录同步',
  dingtalk_stream: '钉钉 Stream',
  document_render: '文档渲染任务',
  global_file_orphan_gc: '孤儿文件清理',
  reminder: '提醒任务',
  task_scheduler: '定时任务',
  task_sweep: '定时扫描',
  task_watchdog: '任务看门狗',
};

const CAPABILITY_LABELS: Record<string, string> = {
  dingtalk_connector: '钉钉连接器',
  dingtalk_personal: '钉钉个人数据',
  memory_embedding: '记忆向量',
  sandbox: '沙箱',
  system_agent_models: '系统助手模型',
};

const SPIKE_LABELS: Record<string, string> = {
  approval_worker: '自动审批错误',
  dingtalk_api: '钉钉接口错误',
  dingtalk_stream: '钉钉 Stream 错误',
  document_export: '文件导出错误',
  document_render: '文档渲染错误',
  local_system: '本机工具错误',
  market: '技能市场错误',
  memory: '记忆错误',
  reminder_worker: '提醒错误',
  sandbox: '沙箱错误',
  system_agent: '系统助手错误',
  task_scheduler: '定时任务错误',
};

/** Spike is redundant when the same area is already an unhealthy tile. */
const SPIKE_COVERED_BY: Record<string, readonly string[]> = {
  approval_worker: ['worker:approval_worker'],
  dingtalk_api: ['capability:dingtalk_connector'],
  dingtalk_stream: ['worker:dingtalk_stream'],
  document_render: ['dependency:documentRender', 'worker:document_render'],
  memory: ['capability:memory_embedding'],
  reminder_worker: ['worker:reminder'],
  sandbox: ['dependency:sandbox', 'capability:sandbox'],
  system_agent: ['capability:system_agent_models'],
  task_scheduler: ['worker:task_scheduler', 'worker:task_sweep', 'worker:task_watchdog'],
};

const UNHEALTHY = new Set(['dead', 'degraded', 'failed', 'unavailable']);

const toHealth = (status: string): AlertHealth | null => {
  if (status === 'healthy') return 'healthy';
  if (UNHEALTHY.has(status)) return 'unhealthy';
  return null;
};

const stateWord = (status: string): string => (status === 'degraded' ? '降级' : '不可用');

export const statusAlertsEnabled = (env: Partial<NodeJS.ProcessEnv> = process.env): boolean =>
  env.AIHUB_STATUS_ALERTS !== '0';

export const statusAlertLink = (env: Partial<NodeJS.ProcessEnv> = process.env): string => {
  const base = (env.APP_URL ?? '').trim().replace(/\/$/, '');
  return base ? `${base}/admin/system/status` : '/admin/system/status';
};

const LATIN_BRAND_KEYS = new Set(['aihub', 'lobehub', 'lobechat']);

/** Used when the published site title is empty or a built-in Latin product name. */
export const STATUS_ALERT_SITE_TITLE_FALLBACK = 'AI 平台';

export const resolveStatusAlertSiteTitle = (name: string | null | undefined): string => {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return STATUS_ALERT_SITE_TITLE_FALLBACK;
  const key = trimmed.replaceAll(/\s+/g, '').toLowerCase();
  if (LATIN_BRAND_KEYS.has(key)) return STATUS_ALERT_SITE_TITLE_FALLBACK;
  return trimmed;
};

const CJK_TITLE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

/** CJK titles sit against 状态告警; a Latin title keeps a separating space. */
export const statusAlertTitleFor = (siteTitle: string): string =>
  CJK_TITLE.test(siteTitle) ? `${siteTitle}状态告警` : `${siteTitle} 状态告警`;

export const alertRuleEnabledForComponent = (
  id: string,
  rules: StatusAlertSettings['rules'],
): boolean => {
  if (id === DINGTALK_API_BUDGET_ALERT_ID || id.startsWith('budget:')) {
    return rules.dingtalkApiBudget;
  }
  if (id.startsWith('dependency:')) return rules.dependencies;
  if (id.startsWith('worker:')) return rules.workers;
  if (id.startsWith('capability:')) return rules.capabilities;
  if (id.startsWith('spike:')) return rules.runtimeErrors;
  return true;
};

export const deriveAlertComponents = (snapshot: StatusAlertSnapshot): AlertComponent[] => {
  const components: AlertComponent[] = [];
  for (const [key, label] of Object.entries(DEPENDENCY_LABELS)) {
    const health = snapshot.dependencies[key];
    if (!health) continue;
    const state = toHealth(health.status);
    if (!state) continue;
    components.push({
      detail: health.lastError || health.detail,
      id: `dependency:${key}`,
      label,
      status: health.status,
    });
  }
  for (const worker of snapshot.workers) {
    const state = toHealth(worker.status);
    if (!state) continue;
    components.push({
      detail: worker.lastError,
      id: `worker:${worker.name}`,
      label: WORKER_LABELS[worker.name] ?? worker.name,
      status: worker.status,
    });
  }
  for (const capability of snapshot.capabilities) {
    const state = toHealth(capability.status);
    if (!state) continue;
    components.push({
      detail: capability.detail || capability.reason,
      id: `capability:${capability.key}`,
      label: CAPABILITY_LABELS[capability.key] ?? capability.key,
      status: capability.status,
    });
  }
  const unhealthyIds = new Set(
    components.filter((item) => toHealth(item.status) === 'unhealthy').map((item) => item.id),
  );
  for (const spike of snapshot.spikes) {
    if (spike.errors10m < RUNTIME_ERROR_SPIKE_COUNT) continue;
    const covered = SPIKE_COVERED_BY[spike.subsystem] ?? [];
    if (covered.some((id) => unhealthyIds.has(id))) continue;
    components.push({
      detail: spike.lastError || `近 10 分钟 ${spike.errors10m} 次错误`,
      id: `spike:${spike.subsystem}`,
      label: SPIKE_LABELS[spike.subsystem] ?? spike.subsystem,
      status: 'unavailable',
    });
  }
  return components;
};

const labelForId = (id: string): string => {
  const [kind, name] = id.split(':');
  if (kind === 'dependency') return DEPENDENCY_LABELS[name ?? ''] ?? name ?? id;
  if (kind === 'worker') return WORKER_LABELS[name ?? ''] ?? name ?? id;
  if (kind === 'capability') return CAPABILITY_LABELS[name ?? ''] ?? name ?? id;
  if (kind === 'spike') return SPIKE_LABELS[name ?? ''] ?? name ?? id;
  return id;
};

const presentComponents = (components: readonly AlertComponent[]): Map<string, AlertComponent> => {
  const next = new Map<string, AlertComponent>();
  for (const component of components) {
    const health = toHealth(component.status);
    if (!health) continue;
    if (health === 'healthy' && component.id.startsWith('spike:')) continue;
    next.set(component.id, component);
  }
  return next;
};

export const selectAlertTransitions = (
  previous: ReadonlyMap<string, AlertHealth>,
  components: readonly AlertComponent[],
  options?: { previousBudgetDay?: string },
): AlertTransition[] => {
  const next = presentComponents(components);
  const transitions: AlertTransition[] = [];
  for (const [id, was] of previous) {
    // A tile that disappeared (module turned off) is not a recovery. A spike
    // that falls back under the threshold is.
    if (next.has(id) || was !== 'unhealthy' || !id.startsWith('spike:')) continue;
    transitions.push({
      id,
      label: labelForId(id),
      next: 'healthy',
      previous: 'unhealthy',
      status: 'healthy',
    });
  }
  for (const component of next.values()) {
    const health = toHealth(component.status);
    if (!health) continue;
    const was = previous.get(component.id);
    if (was === health) continue;
    if (!was && health === 'healthy') continue;
    const day = component.day;
    const previousDay =
      component.id === DINGTALK_API_BUDGET_ALERT_ID ? options?.previousBudgetDay : undefined;
    transitions.push({
      ...(day ? { day } : {}),
      detail: component.detail,
      id: component.id,
      label: component.label,
      next: health,
      ...(previousDay ? { previousDay } : {}),
      ...(was ? { previous: was } : {}),
      status: component.status,
    });
  }
  return transitions;
};

/** State to store after a tick. Disappeared non-spike tiles are dropped. */
export const nextAlertState = (
  previous: ReadonlyMap<string, AlertHealth>,
  components: readonly AlertComponent[],
): Map<string, AlertHealth> => {
  const present = presentComponents(components);
  const next = new Map<string, AlertHealth>();
  for (const [id, component] of present) {
    const health = toHealth(component.status);
    if (health) next.set(id, health);
  }
  for (const [id, was] of previous) {
    if (present.has(id)) continue;
    if (id.startsWith('spike:') && was === 'unhealthy') next.set(id, 'healthy');
  }
  return next;
};

export interface StatusAlertLine {
  recovered: boolean;
  text: string;
}

/** Midnight replaces today's counter. That healthy flip is not a same-day drop. */
const budgetRecoveryIsCounterReset = (transition: AlertTransition): boolean =>
  transition.id === DINGTALK_API_BUDGET_ALERT_ID &&
  transition.next === 'healthy' &&
  Boolean(transition.day) &&
  Boolean(transition.previousDay) &&
  transition.day !== transition.previousDay;

export const formatStatusAlertLines = (
  transitions: readonly AlertTransition[],
): StatusAlertLine[] =>
  transitions.flatMap((transition): StatusAlertLine[] => {
    if (budgetRecoveryIsCounterReset(transition)) return [];
    const budget = transition.id === DINGTALK_API_BUDGET_ALERT_ID;
    if (transition.next === 'healthy') {
      return [
        {
          recovered: true,
          text: budget ? `${transition.label}已回落到告警阈值以下` : `${transition.label}已恢复`,
        },
      ];
    }
    const detail = scrubRuntimeErrorMessage(transition.detail ?? '');
    const head = budget
      ? `${transition.label}超出告警阈值`
      : `${transition.label}${stateWord(transition.status)}`;
    return [{ recovered: false, text: detail ? `${head} — ${detail}` : head }];
  });

const statusAlertOverflow = (hidden: number): string => `另有 ${hidden} 项异常/恢复，详见状态页`;

const renderStatusAlertText = (
  title: string,
  lines: readonly string[],
  hidden: number,
  link: string,
): string => {
  const overflow = hidden > 0 ? statusAlertOverflow(hidden) : '';
  const tail = [overflow, link].filter((part) => part.length > 0).join('\n');
  if (lines.length === 0) return tail ? `${title}：\n${tail}` : `${title}：`;
  if (lines.length === 1 && hidden === 0) return `${title}：${lines[0]}\n${tail}`;
  return `${title}：\n${lines.join('\n')}\n${tail}`;
};

/**
 * Keep every transition accounted for and always keep the status-page link.
 * More than 12 lines, or a body that would push the link past 1500 characters,
 * collapses the tail into 「另有 N 项异常/恢复，详见状态页」.
 */
export const formatStatusAlertMessage = (
  transitions: readonly AlertTransition[],
  link: string,
  siteTitle: string = STATUS_ALERT_SITE_TITLE_FALLBACK,
): { text: string; title: string } => {
  const title = statusAlertTitleFor(siteTitle);
  const all = formatStatusAlertLines(transitions).map((line) => line.text);
  let shown = Math.min(STATUS_ALERT_LINE_MAX, all.length);
  let text = renderStatusAlertText(title, all.slice(0, shown), all.length - shown, link);
  while (shown > 0 && text.length > STATUS_ALERT_TEXT_MAX) {
    shown -= 1;
    text = renderStatusAlertText(title, all.slice(0, shown), all.length - shown, link);
  }
  if (text.length > STATUS_ALERT_TEXT_MAX && shown === 0 && all.length > 0) {
    const clipped = renderStatusAlertText(title, [], all.length, link);
    text =
      clipped.length <= STATUS_ALERT_TEXT_MAX
        ? clipped
        : `${statusAlertOverflow(all.length)}\n${link}`;
  }
  if (text.length > STATUS_ALERT_TEXT_MAX && link && text.includes(link)) {
    const withoutLink = text.slice(0, text.lastIndexOf(link)).replace(/\s+$/, '');
    const budget = STATUS_ALERT_TEXT_MAX - link.length - 1;
    const head = budget > 0 ? withoutLink.slice(0, budget) : '';
    text = head ? `${head}\n${link}` : link;
  }
  return { text, title };
};

/** Result of `resolveVerifiedDingtalkIdentity`. Email inference is not a staff id. */
export type VerifiedStaffLookup = { error: string } | { staffId: string };

/**
 * Staff ids from the identity service's verified mapping only.
 * `DINGTALK_IDENTITY_UNVERIFIED` (manual bind, identity-email local-part) is skipped.
 */
export const collectVerifiedAdminStaffIds = async (
  userIds: readonly string[],
  resolveIdentity: (userId: string) => Promise<VerifiedStaffLookup>,
): Promise<string[]> => {
  const ids = new Set<string>();
  const seenUsers = new Set<string>();
  for (const userId of userIds) {
    const trimmed = userId.trim();
    if (!trimmed || seenUsers.has(trimmed)) continue;
    seenUsers.add(trimmed);
    try {
      const identity = await resolveIdentity(trimmed);
      if (!identity || 'error' in identity) continue;
      const staffId = identity.staffId.trim();
      if (staffId) ids.add(staffId);
    } catch {
      // One admin's lookup must not invent a recipient from their email.
    }
    if (ids.size >= 100) break;
  }
  return [...ids];
};

export const listStatusAlertStaffIds = async (
  db: LobeChatDatabase,
  settings: Pick<StatusAlertSettings, 'channels'>,
): Promise<string[]> => {
  const channel = settings.channels.workNotice;
  const { resolveVerifiedDingtalkIdentity } = await import('../dingtalkWorkspace/identity');
  const resolve = (userId: string) => resolveVerifiedDingtalkIdentity(db, userId);
  if (channel.recipientMode === 'users') {
    if (channel.userIds.length === 0) return [];
    const rows = await db
      .select({ userId: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, [...channel.userIds]),
          or(eq(users.banned, false), isNull(users.banned)),
        ),
      );
    return collectVerifiedAdminStaffIds(
      rows.map((row) => row.userId),
      resolve,
    );
  }
  if (channel.roles.length === 0) return [];
  const rows = await db
    .select({ userId: users.id })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(
      and(
        isNull(userRoles.workspaceId),
        isNull(roles.workspaceId),
        eq(roles.isActive, true),
        inArray(roles.name, [...channel.roles]),
        or(eq(users.banned, false), isNull(users.banned)),
        sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
      ),
    );
  return collectVerifiedAdminStaffIds(
    rows.map((row) => row.userId),
    resolve,
  );
};

export const listPlatformAdminStaffIds = async (db: LobeChatDatabase): Promise<string[]> =>
  listStatusAlertStaffIds(db, { channels: DEFAULT_STATUS_ALERT_SETTINGS.channels });

export interface StatusAlertDeps {
  acquireLock: () => Promise<'acquired' | 'held' | 'unavailable'>;
  /** `unavailable` means the shared dedup store could not be claimed; do not send. */
  claimDedup: (id: string, state: AlertHealth) => Promise<boolean | 'unavailable'>;
  /**
   * False when this component and health were already written to recent events
   * inside {@link STATUS_ALERT_RECORD_WINDOW_MS}.
   */
  claimRecord?: (id: string, state: AlertHealth, now: number) => Promise<boolean>;
  enabled: () => boolean;
  /** Injected by tests. Production uses global fetch. */
  fetchImpl?: typeof fetch;
  link: () => string;
  listStaffIds: () => Promise<string[]>;
  loadApiBudget?: () => Promise<AlertComponent | null>;
  loadPrevious: () => Promise<Map<string, AlertHealth>>;
  loadSettings?: () => Promise<StatusAlertRuntime>;
  loadSnapshot: () => Promise<StatusAlertSnapshot>;
  mailConfigured?: () => Promise<boolean>;
  now: () => number;
  recordEvent: (event: {
    level: 'info' | 'warning';
    message: string;
    subsystem: string;
  }) => Promise<void>;
  releaseLock: () => Promise<void>;
  resolveSiteTitle?: () => Promise<string>;
  saveState: (state: Map<string, AlertHealth>) => Promise<void>;
  send: (input: { staffIds: string[]; text: string; title: string }) => Promise<void>;
  sendEmail?: (payload: { subject: string; text: string; to: string[] }) => Promise<void>;
}

const memoryState = new Map<string, AlertHealth>();
/** First time each component became unhealthy, keyed by alert id (`dependency:database`). */
const memorySince = new Map<string, string>();
/** Last time a component+health was written to recent events, for the in-process window. */
const memoryRecordedAt = new Map<string, number>();
const SINCE_FIELD_SUFFIX = ':since';
/** Day loaded with the previous budget tile. Set only by the default state reader. */
let loadedBudgetDay: string | undefined;
/** In-process copy of that day, used when Redis cannot be read. */
let memoryBudgetDay: string | undefined;
/** Day to persist with the next default state write. */
let budgetDayToSave: string | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;
let lockToken: string | null = null;
let activeDedupTtlSeconds = Math.ceil(STATUS_ALERT_DEDUP_MS / 1000);

const warnRedisUnavailable = (reason: 'dedup' | 'lock'): void => {
  const now = Date.now();
  if (now - lastRedisUnavailableWarnAt < REDIS_UNAVAILABLE_WARN_MS) return;
  lastRedisUnavailableWarnAt = now;
  console.warn('[status-alert] skip send: redis unavailable', { reason });
};

export const resetStatusAlertsForTest = (): void => {
  memoryState.clear();
  memorySince.clear();
  memoryRecordedAt.clear();
  loadedBudgetDay = undefined;
  memoryBudgetDay = undefined;
  budgetDayToSave = undefined;
  lastRedisUnavailableWarnAt = 0;
  activeDedupTtlSeconds = Math.ceil(STATUS_ALERT_DEDUP_MS / 1000);
  invalidateStatusAlertSettingsCache();
  if (timer) clearInterval(timer);
  timer = undefined;
  started = false;
  lockToken = null;
};

const redisClient = () => {
  try {
    return getAgentRuntimeRedisClient();
  } catch {
    return null;
  }
};

const defaultAcquireLock = async (): Promise<'acquired' | 'held' | 'unavailable'> => {
  const redis = redisClient();
  if (!redis) return 'unavailable';
  const token = `${process.pid}:${Date.now()}`;
  try {
    const result = await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (result !== 'OK') return 'held';
    lockToken = token;
    return 'acquired';
  } catch {
    return 'unavailable';
  }
};

const defaultReleaseLock = async (): Promise<void> => {
  const token = lockToken;
  lockToken = null;
  if (!token) return;
  const redis = redisClient();
  if (!redis) return;
  try {
    await redis.eval(RELEASE_LOCK, 1, LOCK_KEY, token);
  } catch {
    // lock expires on its own
  }
};

const parseHealth = (value: string | undefined): AlertHealth | null =>
  value === 'healthy' || value === 'unhealthy' ? value : null;

const defaultLoadPrevious = async (): Promise<Map<string, AlertHealth>> => {
  loadedBudgetDay = memoryBudgetDay;
  const redis = redisClient();
  if (!redis) return new Map(memoryState);
  try {
    const hash = (await redis.hgetall(STATE_KEY)) ?? {};
    loadedBudgetDay = undefined;
    const next = new Map<string, AlertHealth>();
    memorySince.clear();
    for (const [id, raw] of Object.entries(hash)) {
      if (id === BUDGET_ALERT_DAY_FIELD) {
        if (raw) loadedBudgetDay = raw;
        continue;
      }
      if (id.endsWith(SINCE_FIELD_SUFFIX)) {
        const alertId = id.slice(0, -SINCE_FIELD_SUFFIX.length);
        if (alertId && raw && Number.isFinite(Date.parse(raw))) memorySince.set(alertId, raw);
        continue;
      }
      const health = parseHealth(raw);
      if (health) next.set(id, health);
    }
    memoryState.clear();
    for (const [id, health] of next) memoryState.set(id, health);
    return next;
  } catch {
    loadedBudgetDay = memoryBudgetDay;
    return new Map(memoryState);
  }
};

const nextUnhealthySince = (state: ReadonlyMap<string, AlertHealth>, nowIso: string) => {
  const since = new Map<string, string>();
  for (const [id, health] of state) {
    if (health !== 'unhealthy') continue;
    const kept = memoryState.get(id) === 'unhealthy' ? memorySince.get(id) : undefined;
    since.set(id, kept ?? nowIso);
  }
  return since;
};

const defaultSaveState = async (state: Map<string, AlertHealth>): Promise<void> => {
  memoryBudgetDay = budgetDayToSave;
  const since = nextUnhealthySince(state, new Date().toISOString());
  memoryState.clear();
  memorySince.clear();
  for (const [id, health] of state) memoryState.set(id, health);
  for (const [id, at] of since) memorySince.set(id, at);
  const redis = redisClient();
  if (!redis) return;
  try {
    // DEL + HSET in one MULTI so a component that disappeared loses its stale
    // hash field. A leftover `unhealthy` would page a false recovery later.
    const tx = redis.multi();
    tx.del(STATE_KEY);
    if (state.size > 0 || since.size > 0) {
      for (const [id, health] of state) tx.hset(STATE_KEY, id, health);
      for (const [id, at] of since) tx.hset(STATE_KEY, `${id}${SINCE_FIELD_SUFFIX}`, at);
      if (budgetDayToSave) tx.hset(STATE_KEY, BUDGET_ALERT_DAY_FIELD, budgetDayToSave);
      tx.expire(STATE_KEY, STATE_TTL_SECONDS);
    }
    const replaced = await tx.exec();
    if (!replaced) throw new Error('status alert state replace aborted');
  } catch {
    // in-process map still dedups this replica
  }
};

/** Summary component id (`dependency.database`) → alert-state id (`dependency:database`). */
export const statusAlertIdForComponent = (componentId: string): string | null => {
  const dot = componentId.indexOf('.');
  if (dot <= 0) return null;
  const group = componentId.slice(0, dot);
  const name = componentId.slice(dot + 1);
  if (!name) return null;
  if (group === 'runtime') return `spike:${name}`;
  if (
    group === 'dependency' ||
    group === 'capability' ||
    group === 'worker' ||
    group === 'budget'
  ) {
    return `${group}:${name}`;
  }
  return null;
};

/** When each unhealthy component first flipped. Missing or unreadable store → empty. */
export const readStatusAlertUnhealthySince = async (): Promise<Map<string, string>> => {
  const redis = redisClient();
  if (!redis) return new Map(memorySince);
  try {
    const hash = (await redis.hgetall(STATE_KEY)) ?? {};
    const since = new Map<string, string>();
    for (const [id, raw] of Object.entries(hash)) {
      if (!id.endsWith(SINCE_FIELD_SUFFIX) || !raw || !Number.isFinite(Date.parse(raw))) continue;
      since.set(id.slice(0, -SINCE_FIELD_SUFFIX.length), new Date(raw).toISOString());
    }
    return since;
  } catch {
    return new Map(memorySince);
  }
};

export const formatDingtalkApiBudgetDetail = (
  total: number,
  threshold: number,
  endpoints: readonly { api: string; count: number }[],
): string => {
  const top = topDingtalkApiCallEndpoints(endpoints)
    .map((row) => `${row.api} ${row.count} 次`)
    .join('、');
  const head = `今日 API 调用 ${total} 次，超过告警阈值 ${threshold}`;
  return top ? `${head}。最多：${top}` : head;
};

const loadDingtalkApiBudget = async (threshold: number): Promise<AlertComponent | null> => {
  if (threshold <= 0) return null;
  const day = await getDingtalkApiCallTotal();
  if (!day) return null;
  const over = day.total >= threshold;
  return {
    day: day.date,
    id: DINGTALK_API_BUDGET_ALERT_ID,
    label: DINGTALK_API_BUDGET_ALERT_LABEL,
    status: over ? 'unavailable' : 'healthy',
    ...(over ? { detail: formatDingtalkApiBudgetDetail(day.total, threshold, day.byApi) } : {}),
  };
};

const recordWindowKey = (id: string, state: AlertHealth) => `${id}:${state}`;

/**
 * One recent-event row per component and health per 10 minutes.
 * Redis is shared across the lock holder; the in-process map covers a Redis miss
 * so a flap cannot fill the 50-slot ring.
 */
const defaultClaimRecord = async (
  id: string,
  state: AlertHealth,
  now: number,
): Promise<boolean> => {
  const key = recordWindowKey(id, state);
  const previous = memoryRecordedAt.get(key);
  if (previous != null && now - previous < STATUS_ALERT_RECORD_WINDOW_MS) return false;
  const redis = redisClient();
  if (redis) {
    try {
      const result = await redis.set(
        `${RECORD_KEY_PREFIX}${key}`,
        '1',
        'EX',
        STATUS_ALERT_RECORD_TTL_SECONDS,
        'NX',
      );
      if (result !== 'OK') {
        memoryRecordedAt.set(key, now);
        return false;
      }
    } catch {
      // Fall through and use the in-process window.
    }
  }
  memoryRecordedAt.set(key, now);
  return true;
};

const defaultClaimDedup = async (
  id: string,
  state: AlertHealth,
): Promise<boolean | 'unavailable'> => {
  const redis = redisClient();
  if (!redis) {
    warnRedisUnavailable('dedup');
    return 'unavailable';
  }
  try {
    const result = await redis.set(
      `platform:status-alert:dedup:${id}:${state}`,
      '1',
      'EX',
      activeDedupTtlSeconds,
      'NX',
    );
    return result === 'OK';
  } catch {
    warnRedisUnavailable('dedup');
    return 'unavailable';
  }
};

export const runStatusAlertEvaluation = async (
  deps: Partial<StatusAlertDeps> = {},
): Promise<{ sent: boolean; transitions: number }> => {
  if (deps.enabled ? !deps.enabled() : !statusAlertsEnabled()) {
    return { sent: false, transitions: 0 };
  }
  const acquire = deps.acquireLock ?? defaultAcquireLock;
  const release = deps.releaseLock ?? defaultReleaseLock;
  const lock = await acquire();
  // Held: another replica owns this tick. Unavailable: fail closed, do not send.
  if (lock !== 'acquired') {
    if (lock !== 'held') warnRedisUnavailable('lock');
    return { sent: false, transitions: 0 };
  }
  try {
    const runtime = await loadAlertRuntime(deps);
    const snapshot = await (deps.loadSnapshot ?? loadSnapshotFromStatus)();
    loadedBudgetDay = undefined;
    const previous = await (deps.loadPrevious ?? defaultLoadPrevious)();
    const previousBudgetDay = loadedBudgetDay;
    const components = deriveAlertComponents(snapshot);
    const threshold = resolveDingtalkApiAlertThreshold(runtime.settings);
    try {
      const budget = await (deps.loadApiBudget ?? (() => loadDingtalkApiBudget(threshold)))();
      if (budget) components.push(budget);
    } catch (error) {
      console.warn('[status-alert] dingtalk api budget read failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    const transitions = selectAlertTransitions(previous, components, {
      previousBudgetDay,
    }).filter((transition) => formatStatusAlertLines([transition]).length > 0);
    const candidates = transitions.filter((transition) => {
      if (!alertRuleEnabledForComponent(transition.id, runtime.settings.rules)) return false;
      if (transition.next === 'healthy' && !runtime.settings.notifyOnRecovery) return false;
      return true;
    });
    const notify: AlertTransition[] = [];
    if (runtime.settings.enabled) {
      activeDedupTtlSeconds = runtime.settings.repeatIntervalHours * 60 * 60;
      const claim = deps.claimDedup ?? defaultClaimDedup;
      for (const transition of candidates) {
        const claimed = await claim(transition.id, transition.next);
        if (claimed === 'unavailable') {
          // Leave saved state untouched so the transition is retried next tick.
          return { sent: false, transitions: 0 };
        }
        if (claimed === true) notify.push(transition);
      }
    }
    const record =
      deps.recordEvent ?? ((event) => appendRuntimeEvent({ ...event, at: deps.now?.() }));
    const claimRecord = deps.claimRecord ?? defaultClaimRecord;
    const recordedAt = deps.now?.() ?? Date.now();
    // Recent events keep recording when sending is off or send-dedup suppresses a repeat.
    // A flap still updates alert state below, but the ring keeps at most one row per
    // component and health inside STATUS_ALERT_RECORD_WINDOW_MS.
    for (const transition of candidates) {
      if (!(await claimRecord(transition.id, transition.next, recordedAt))) continue;
      const line = formatStatusAlertLines([transition])[0];
      await record({
        level: transition.next === 'healthy' ? 'info' : 'warning',
        message: line?.text ?? transition.label,
        subsystem: transition.id.slice(0, 64),
      });
    }
    let sent = false;
    if (notify.length > 0) {
      try {
        sent = await deliverAlertChannels(deps, runtime, notify);
      } catch (error) {
        // One attempt per transition. Retrying every minute would bill DingTalk.
        console.error('[status-alert] send failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
    budgetDayToSave = components.find((item) => item.id === DINGTALK_API_BUDGET_ALERT_ID)?.day;
    await (deps.saveState ?? defaultSaveState)(nextAlertState(previous, components));
    return { sent, transitions: notify.length };
  } finally {
    budgetDayToSave = undefined;
    loadedBudgetDay = undefined;
    await release();
  }
};

const loadAlertRuntime = async (deps: Partial<StatusAlertDeps>): Promise<StatusAlertRuntime> => {
  if (deps.loadSettings) return deps.loadSettings();
  try {
    return await readCachedStatusAlertRuntime();
  } catch (error) {
    console.warn('[status-alert] settings read failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return emptyStatusAlertRuntime();
  }
};

const resolveAlertSiteTitle = async (override?: () => Promise<string>): Promise<string> => {
  if (override) return override();
  try {
    const { resolveServerRuntimeBranding } =
      await import('@/server/enterprise/services/branding/runtimeBranding');
    const branding = await resolveServerRuntimeBranding();
    return resolveStatusAlertSiteTitle(branding.name);
  } catch {
    return STATUS_ALERT_SITE_TITLE_FALLBACK;
  }
};

const listStaffFromDb = async (settings: StatusAlertSettings): Promise<string[]> => {
  const { getServerDB } = await import('@/database/core/db-adaptor');
  return listStatusAlertStaffIds(await getServerDB(), settings);
};

const deliverAlertChannels = async (
  deps: Partial<StatusAlertDeps>,
  runtime: StatusAlertRuntime,
  notify: readonly AlertTransition[],
): Promise<boolean> => {
  const siteTitle = await resolveAlertSiteTitle(deps.resolveSiteTitle);
  const message = formatStatusAlertMessage(notify, (deps.link ?? statusAlertLink)(), siteTitle);
  const workNotice = runtime.settings.channels.workNotice;
  const staffIds = workNotice.enabled
    ? await (deps.listStaffIds ?? (() => listStaffFromDb(runtime.settings)))()
    : [];
  const mailConfigured = deps.mailConfigured
    ? await deps.mailConfigured()
    : await isStatusAlertMailConfigured();
  const counts = await deliverStatusAlertChannels({
    fetchImpl: deps.fetchImpl,
    mailConfigured,
    message,
    now: deps.now?.(),
    sendEmail: deps.sendEmail,
    sendWorkNotice: (payload) => (deps.send ?? sendWorkNoticeToAdmins)(payload),
    target: {
      email: runtime.settings.channels.email,
      robot: {
        enabled: runtime.settings.channels.dingtalkRobot.enabled,
        keyword: runtime.settings.channels.dingtalkRobot.keyword,
        secret: runtime.robotSecret,
        webhookUrl: runtime.robotWebhook ?? runtime.settings.channels.dingtalkRobot.webhookUrl,
      },
      workNotice: { enabled: workNotice.enabled, staffIds },
    },
  });
  return counts.workNotice + counts.robot + counts.email > 0;
};

const sendWorkNoticeToAdmins = async (input: {
  staffIds: string[];
  text: string;
  title: string;
}): Promise<void> => {
  const { sendWorkNotice } =
    await import('@/server/services/messenger/platforms/dingtalk/notifyApp');
  await sendWorkNotice({
    markdown: { text: input.text, title: input.title },
    staffIds: input.staffIds,
  });
};

export const STATUS_ALERT_TEST_BODY = '这是一条测试消息，请忽略。';

const isNotifyAppMissing = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'notify_app_not_configured',
  );

const logTestFailure = (channel: string, error: unknown): void => {
  console.error('[status-alert] test send failed', {
    channel,
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
};

/** Sends one short test using the stored settings. Never includes secrets in the result. */
export const sendStoredStatusAlertTest = async (
  db: LobeChatDatabase,
  channel: 'dingtalkRobot' | 'email' | 'workNotice',
): Promise<{ delivered: number; error: string | null; ok: boolean }> => {
  const runtime = await loadStatusAlertRuntime(db);
  const siteTitle = await resolveAlertSiteTitle();
  const title = statusAlertTitleFor(siteTitle);
  const text = `${STATUS_ALERT_TEST_BODY}\n${statusAlertLink()}`;
  const settings = runtime.settings;

  if (channel === 'workNotice') {
    if (!settings.channels.workNotice.enabled) {
      return { delivered: 0, error: '工作通知未启用', ok: false };
    }
    if (!(await isStatusAlertNotifyAppConfigured())) {
      return { delivered: 0, error: '钉钉通知应用未配置', ok: false };
    }
    const staffIds = await listStatusAlertStaffIds(db, settings);
    if (staffIds.length === 0) {
      return { delivered: 0, error: '没有已验证的钉钉接收人', ok: false };
    }
    try {
      await sendWorkNoticeToAdmins({ staffIds, text, title });
      return { delivered: staffIds.length, error: null, ok: true };
    } catch (error) {
      logTestFailure(channel, error);
      return {
        delivered: 0,
        error: isNotifyAppMissing(error) ? '钉钉通知应用未配置' : '工作通知发送失败',
        ok: false,
      };
    }
  }

  if (channel === 'dingtalkRobot') {
    const robot = settings.channels.dingtalkRobot;
    const webhookUrl = runtime.robotWebhook ?? robot.webhookUrl;
    if (!robot.enabled) return { delivered: 0, error: '群机器人未启用', ok: false };
    if (!webhookUrl) return { delivered: 0, error: '未配置群机器人 Webhook', ok: false };
    try {
      await postDingtalkRobotMarkdown({
        keyword: robot.keyword,
        secret: runtime.robotSecret,
        text,
        title,
        webhookUrl,
      });
      return { delivered: 1, error: null, ok: true };
    } catch (error) {
      logTestFailure(channel, error);
      return { delivered: 0, error: '群机器人发送失败', ok: false };
    }
  }

  if (!settings.channels.email.enabled) {
    return { delivered: 0, error: '邮件通知未启用', ok: false };
  }
  if (settings.channels.email.recipients.length === 0) {
    return { delivered: 0, error: '未配置收件人', ok: false };
  }
  if (!(await isStatusAlertMailConfigured())) {
    return { delivered: 0, error: '邮件服务未配置', ok: false };
  }
  try {
    await sendStatusAlertEmail({
      recipients: settings.channels.email.recipients,
      text,
      title,
    });
    return { delivered: settings.channels.email.recipients.length, error: null, ok: true };
  } catch (error) {
    logTestFailure(channel, error);
    return { delivered: 0, error: '邮件发送失败', ok: false };
  }
};

const loadSnapshotFromStatus = async (): Promise<StatusAlertSnapshot> => {
  const { getServerDB } = await import('@/database/core/db-adaptor');
  const { PlatformSystemAdminService } = await import('./adminService');
  const { readRuntimeErrorSummary } = await import('./runtimeErrors');
  const status = await new PlatformSystemAdminService(await getServerDB()).getStatus();
  const summary = await readRuntimeErrorSummary();
  const dependencies = status.dependencies as StatusAlertSnapshot['dependencies'];
  return {
    capabilities: status.capabilities,
    dependencies,
    spikes: summary.subsystems.map((item) => ({
      errors10m: item.errors10m,
      ...(item.lastError ? { lastError: item.lastError } : {}),
      subsystem: item.subsystem,
    })),
    workers: status.workers,
  };
};

const alertRuntime = (env: Partial<NodeJS.ProcessEnv>): boolean =>
  Boolean(env.DATABASE_URL) &&
  env.VERCEL !== '1' &&
  !env.VERCEL_ENV &&
  env.NEXT_RUNTIME !== 'edge' &&
  !env.AWS_LAMBDA_FUNCTION_NAME;

export const ensureStatusAlertWorkerStarted = (): void => {
  if (started) return;
  if (!statusAlertsEnabled() || !alertRuntime(process.env)) return;
  started = true;
  const tick = () => {
    void runStatusAlertEvaluation().catch((error) => {
      console.error('[status-alert] evaluation failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  };
  timer = setInterval(tick, STATUS_ALERT_INTERVAL_MS);
  timer.unref?.();
};

export const stopStatusAlertWorker = (): void => {
  started = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
};
