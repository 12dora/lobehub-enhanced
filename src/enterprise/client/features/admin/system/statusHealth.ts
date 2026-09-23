import type { AdminSystemStatus } from '@/enterprise/client/services/adminSystem';

/**
 * Pure presentation logic for the 「状态监控」 page: the header summary, relative
 * times and labels for the monitoring rows (capabilities, workers, runtime errors,
 * recent events). Kept out of the components so it can be unit-tested directly.
 */

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type AdminSystemCapabilityRow = AdminSystemStatus['capabilities'][number];
export type AdminSystemWorkerRow = AdminSystemStatus['workers'][number];
export type AdminSystemRuntimeErrorRow = AdminSystemStatus['runtimeErrors'][number];
export type AdminSystemRecentEventRow = AdminSystemStatus['recentEvents'][number];

export type StatusProblemSeverity = 'error' | 'warning';
export type StatusProblemSource = 'capability' | 'dependency' | 'runtime' | 'worker';

export interface StatusProblem {
  key: string;
  severity: StatusProblemSeverity;
  source: StatusProblemSource;
}

export interface StatusSummary {
  problems: StatusProblem[];
  /** `success` only when nothing is degraded, unavailable, or erroring. */
  tone: 'error' | 'success' | 'warning';
}

export const DEPENDENCY_KEYS = [
  'database',
  'redis',
  'objectStorage',
  'mail',
  'keyManagement',
  'sandbox',
  'documentRender',
] as const;

/** A runtime-error row whose last failure is this recent is still happening, so it is red. */
export const RUNTIME_ERROR_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

const DEPENDENCY_ERROR_CATEGORIES = new Set([
  'configuration_incomplete',
  'operation_unavailable',
  'passive_check_only',
  'timeout',
]);

/**
 * Gray states (`disabled` / `unknown`, i.e. 未配置 / 已禁用) are not problems. The
 * server marks a required-but-missing capability `unavailable`, which is.
 */
const severityOf = (status: string): StatusProblemSeverity | null => {
  if (status === 'unavailable') return 'error';
  if (status === 'degraded') return 'warning';
  return null;
};

const toTime = (value: Date | string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const runtimeErrorSeverity = (
  row: Pick<AdminSystemRuntimeErrorRow, 'lastAt'>,
  now: Date,
): StatusProblemSeverity => {
  const lastAt = toTime(row.lastAt);
  const nowMs = toTime(now);
  if (lastAt === null || nowMs === null) return 'warning';
  return nowMs - lastAt <= RUNTIME_ERROR_ACTIVE_WINDOW_MS ? 'error' : 'warning';
};

export const collectStatusProblems = (status: AdminSystemStatus): StatusProblem[] => {
  const problems: StatusProblem[] = [];
  const add = (source: StatusProblemSource, key: string, value: string) => {
    const severity = severityOf(value);
    if (severity) problems.push({ key, severity, source });
  };

  for (const key of DEPENDENCY_KEYS) {
    const dependency = status.dependencies[key];
    if (dependency) add('dependency', key, dependency.status);
  }
  // Older servers (rolling deploy) may omit the monitoring arrays entirely.
  for (const capability of status.capabilities ?? []) {
    // The sandbox capability mirrors the sandbox tile — count that failure once.
    if (capability.key === 'sandbox' && status.dependencies.sandbox) continue;
    add('capability', capability.key, capability.status);
  }
  for (const worker of status.workers ?? []) add('worker', worker.name, worker.status);
  for (const row of status.runtimeErrors ?? []) {
    if (row.count24h <= 0) continue;
    problems.push({
      key: row.subsystem,
      severity: runtimeErrorSeverity(row, status.snapshotAt),
      source: 'runtime',
    });
  }
  return problems;
};

export const summarizeStatus = (status: AdminSystemStatus): StatusSummary => {
  const problems = collectStatusProblems(status);
  const tone = problems.some((problem) => problem.severity === 'error')
    ? 'error'
    : problems.length > 0
      ? 'warning'
      : 'success';
  return { problems, tone };
};

export const workerLabel = (name: string, t: Translate): string =>
  t(`system.workers.${name}`, { defaultValue: name });

export const subsystemLabel = (subsystem: string, t: Translate): string =>
  t(`system.subsystems.${subsystem}`, { defaultValue: subsystem });

export const describeProblem = (problem: StatusProblem, t: Translate): string => {
  switch (problem.source) {
    case 'dependency': {
      return t(`system.dependencies.${problem.key}`, { defaultValue: problem.key });
    }
    case 'capability': {
      return t(`system.capabilities.${problem.key}`, { defaultValue: problem.key });
    }
    case 'worker': {
      return workerLabel(problem.key, t);
    }
    case 'runtime': {
      return t('system.summary.runtimeLabel', { name: subsystemLabel(problem.key, t) });
    }
  }
};

const EVENT_SOURCE_NAMESPACE: Record<string, string> = {
  capability: 'system.capabilities',
  dependency: 'system.dependencies',
  spike: 'system.subsystems',
  worker: 'system.workers',
};

/** Events carry a runtime subsystem (`memory`) or an alert id (`dependency:sandbox`). */
export const describeEventSource = (subsystem: string, t: Translate): string => {
  const separator = subsystem.indexOf(':');
  if (separator > 0) {
    const namespace = EVENT_SOURCE_NAMESPACE[subsystem.slice(0, separator)];
    const id = subsystem.slice(separator + 1);
    if (namespace && id) return t(`${namespace}.${id}`, { defaultValue: id });
  }
  return subsystemLabel(subsystem, t);
};

/** Capability reasons are Chinese sentences, except the sandbox one, which is an error category. */
export const describeCapabilityReason = (
  reason: string | undefined,
  t: Translate,
): string | undefined => {
  if (!reason) return undefined;
  if (DEPENDENCY_ERROR_CATEGORIES.has(reason)) return t(`system.values.dependencyError.${reason}`);
  return reason;
};

/**
 * Relative to the snapshot's own clock (`snapshotAt`), so a skewed browser clock
 * cannot make a healthy worker look stale. Returns null when there is no time.
 */
export const formatRelativeTime = (
  at: Date | string | number | null | undefined,
  now: Date,
  t: Translate,
): string | null => {
  const atMs = toTime(at);
  const nowMs = toTime(now);
  if (atMs === null || nowMs === null) return null;
  const seconds = Math.floor(Math.max(0, nowMs - atMs) / 1000);
  if (seconds < 10) return t('system.relative.justNow');
  if (seconds < 60) return t('system.relative.seconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('system.relative.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('system.relative.hours', { count: hours });
  return t('system.relative.days', { count: Math.floor(hours / 24) });
};

export const formatAbsoluteTime = (at: Date | string | number | null | undefined): string => {
  const atMs = toTime(at);
  return atMs === null ? '' : new Date(atMs).toLocaleString();
};

export const formatInterval = (intervalMs: number, t: Translate): string => {
  const seconds = Math.max(1, Math.round(intervalMs / 1000));
  if (seconds < 60 || seconds % 60 !== 0) return t('system.interval.seconds', { count: seconds });
  const minutes = seconds / 60;
  if (minutes < 60 || minutes % 60 !== 0) return t('system.interval.minutes', { count: minutes });
  return t('system.interval.hours', { count: minutes / 60 });
};

/** Newest first, whatever order the server sent. */
export const sortRecentEvents = (
  events: readonly AdminSystemRecentEventRow[],
): AdminSystemRecentEventRow[] =>
  [...events].sort((a, b) => (toTime(b.at) ?? 0) - (toTime(a.at) ?? 0));
