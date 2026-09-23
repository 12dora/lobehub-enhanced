import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { PLATFORM_SYSTEM_ROLES } from '@/const/platform/roles';
import { users } from '@/database/schemas';
import { roles, userRoles } from '@/database/schemas/rbac';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { CapabilityReport } from './capabilities';
import {
  appendRuntimeEvent,
  RUNTIME_ERROR_SPIKE_COUNT,
  scrubRuntimeErrorMessage,
} from './runtimeErrors';
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
  detail?: string;
  id: string;
  label: string;
  status: string;
}

export interface AlertTransition {
  detail?: string;
  id: string;
  label: string;
  next: AlertHealth;
  previous?: AlertHealth;
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
  reminder: '提醒任务',
  task_scheduler: '定时任务',
  task_sweep: '定时扫描',
  task_watchdog: '任务看门狗',
};

const CAPABILITY_LABELS: Record<string, string> = {
  dingtalk_connector: '钉钉连接器',
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
    transitions.push({
      detail: component.detail,
      id: component.id,
      label: component.label,
      next: health,
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

export const formatStatusAlertLines = (
  transitions: readonly AlertTransition[],
): StatusAlertLine[] =>
  transitions.map((transition) => {
    if (transition.next === 'healthy') {
      return { recovered: true, text: `${transition.label}已恢复` };
    }
    const detail = scrubRuntimeErrorMessage(transition.detail ?? '');
    const head = `${transition.label}${stateWord(transition.status)}`;
    return { recovered: false, text: detail ? `${head} — ${detail}` : head };
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
): { text: string; title: string } => {
  const title = 'AIHub 状态告警';
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

export const listPlatformAdminStaffIds = async (db: LobeChatDatabase): Promise<string[]> => {
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
        inArray(roles.name, [...PLATFORM_ADMIN_ALERT_ROLES]),
        or(eq(users.banned, false), isNull(users.banned)),
        sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
      ),
    );
  const { resolveVerifiedDingtalkIdentity } = await import('../dingtalkWorkspace/identity');
  return collectVerifiedAdminStaffIds(
    rows.map((row) => row.userId),
    (userId) => resolveVerifiedDingtalkIdentity(db, userId),
  );
};

export interface StatusAlertDeps {
  acquireLock: () => Promise<'acquired' | 'held' | 'unavailable'>;
  /** `unavailable` means the shared dedup store could not be claimed; do not send. */
  claimDedup: (id: string, state: AlertHealth) => Promise<boolean | 'unavailable'>;
  enabled: () => boolean;
  link: () => string;
  listStaffIds: () => Promise<string[]>;
  loadPrevious: () => Promise<Map<string, AlertHealth>>;
  loadSnapshot: () => Promise<StatusAlertSnapshot>;
  now: () => number;
  recordEvent: (event: {
    level: 'info' | 'warning';
    message: string;
    subsystem: string;
  }) => Promise<void>;
  releaseLock: () => Promise<void>;
  saveState: (state: Map<string, AlertHealth>) => Promise<void>;
  send: (input: { staffIds: string[]; text: string; title: string }) => Promise<void>;
}

const memoryState = new Map<string, AlertHealth>();
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;
let lockToken: string | null = null;

const warnRedisUnavailable = (reason: 'dedup' | 'lock'): void => {
  const now = Date.now();
  if (now - lastRedisUnavailableWarnAt < REDIS_UNAVAILABLE_WARN_MS) return;
  lastRedisUnavailableWarnAt = now;
  console.warn('[status-alert] skip send: redis unavailable', { reason });
};

export const resetStatusAlertsForTest = (): void => {
  memoryState.clear();
  lastRedisUnavailableWarnAt = 0;
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
  const redis = redisClient();
  if (!redis) return new Map(memoryState);
  try {
    const hash = (await redis.hgetall(STATE_KEY)) ?? {};
    const next = new Map<string, AlertHealth>();
    for (const [id, raw] of Object.entries(hash)) {
      const health = parseHealth(raw);
      if (health) next.set(id, health);
    }
    return next;
  } catch {
    return new Map(memoryState);
  }
};

const defaultSaveState = async (state: Map<string, AlertHealth>): Promise<void> => {
  memoryState.clear();
  for (const [id, health] of state) memoryState.set(id, health);
  const redis = redisClient();
  if (!redis) return;
  try {
    // DEL + HSET in one MULTI so a component that disappeared loses its stale
    // hash field. A leftover `unhealthy` would page a false recovery later.
    const tx = redis.multi();
    tx.del(STATE_KEY);
    if (state.size > 0) {
      for (const [id, health] of state) tx.hset(STATE_KEY, id, health);
      tx.expire(STATE_KEY, STATE_TTL_SECONDS);
    }
    const replaced = await tx.exec();
    if (!replaced) throw new Error('status alert state replace aborted');
  } catch {
    // in-process map still dedups this replica
  }
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
      Math.ceil(STATUS_ALERT_DEDUP_MS / 1000),
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
    const snapshot = await (deps.loadSnapshot ?? loadSnapshotFromStatus)();
    const previous = await (deps.loadPrevious ?? defaultLoadPrevious)();
    const components = deriveAlertComponents(snapshot);
    const transitions = selectAlertTransitions(previous, components);
    const claim = deps.claimDedup ?? defaultClaimDedup;
    const notify: AlertTransition[] = [];
    for (const transition of transitions) {
      const claimed = await claim(transition.id, transition.next);
      if (claimed === 'unavailable') {
        // Leave saved state untouched so the transition is retried next tick.
        return { sent: false, transitions: 0 };
      }
      if (claimed === true) notify.push(transition);
    }
    const record =
      deps.recordEvent ?? ((event) => appendRuntimeEvent({ ...event, at: deps.now?.() }));
    for (const transition of notify) {
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
        const staffIds = await (deps.listStaffIds ?? listStaffFromDb)();
        if (staffIds.length > 0) {
          const message = formatStatusAlertMessage(notify, (deps.link ?? statusAlertLink)());
          await (deps.send ?? sendWorkNoticeToAdmins)({
            staffIds,
            text: message.text,
            title: message.title,
          });
          sent = true;
        }
      } catch (error) {
        // One attempt per transition. Retrying every minute would bill DingTalk.
        console.error('[status-alert] send failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
    await (deps.saveState ?? defaultSaveState)(nextAlertState(previous, components));
    return { sent, transitions: notify.length };
  } finally {
    await release();
  }
};

const listStaffFromDb = async (): Promise<string[]> => {
  const { getServerDB } = await import('@/database/core/db-adaptor');
  return listPlatformAdminStaffIds(await getServerDB());
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
