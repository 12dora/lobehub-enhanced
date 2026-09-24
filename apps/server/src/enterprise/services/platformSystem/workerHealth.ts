import { isPersistentEnterpriseWorkerRuntime } from '@/server/enterprise/jobs/persistentWorkerRuntime';
import { isGlobalFileOrphanGcDisabled } from '@/server/enterprise/services/globalFileOrphanGc/switch';
import { isBootModuleEnabled, isModuleEnabled } from '@/server/enterprise/services/moduleSettings';

import { readWorkerBeats, type WorkerBeat } from './workerHeartbeat';

/**
 * Expected in-process workers. Predicates match the workers' own runtime
 * guards. DingTalk stream also requires chat to be enabled, and directory
 * sync requires a complete notify app — an unconfigured connector is omitted.
 */
export const WORKER_INTERVAL_MS = {
  approval_worker: 600_000,
  directory_sync: 12 * 60 * 60 * 1000,
  dingtalk_stream: 30_000,
  document_render: 60_000,
  global_file_orphan_gc: 60 * 60 * 1000,
  reminder: 60_000,
  task_scheduler: 60_000,
  task_sweep: 60_000,
  task_watchdog: 60_000,
} as const;

export type MonitoredWorkerName = keyof typeof WORKER_INTERVAL_MS;

export type WorkerHealthStatus = 'degraded' | 'healthy' | 'unavailable';

export interface WorkerHealth {
  intervalMs: number;
  lastError?: string;
  lastTickAt: Date | null;
  name: MonitoredWorkerName;
  started: boolean;
  startedAt: Date | null;
  status: WorkerHealthStatus;
}

export interface ExpectedWorker {
  intervalMs: number;
  name: MonitoredWorkerName;
}

/**
 * DingTalk worker gates. Stream follows `getMessengerDingTalkConfig().chatEnabled`
 * (the stream worker connects only then). Directory sync follows a complete
 * notify-app triple, the same check `resolveNotifyAppConfig` uses before a tick.
 */
export interface DingtalkWorkerConfig {
  chatEnabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  notifyApp?: { agentId?: string | null; appKey?: string | null; appSecret?: string | null } | null;
}

export interface WorkerExpectationFlags {
  dingtalkStream: boolean;
  directorySync: boolean;
  documentRender: boolean;
}

const persistentCore = (env: Partial<NodeJS.ProcessEnv>): boolean =>
  Boolean(env.DATABASE_URL) &&
  env.VERCEL !== '1' &&
  !env.VERCEL_ENV &&
  env.NEXT_RUNTIME !== 'edge' &&
  !env.AWS_LAMBDA_FUNCTION_NAME;

const taskSchedulerExpected = (env: Partial<NodeJS.ProcessEnv>): boolean =>
  persistentCore(env) && env.AGENT_RUNTIME_MODE !== 'queue';

const dingtalkStreamExpected = (env: Partial<NodeJS.ProcessEnv>): boolean => {
  if (!env.DATABASE_URL || env.VERCEL_ENV) return false;
  const dev = env.NODE_ENV !== 'production';
  return !dev || env.ENABLE_BOT_IN_DEV === '1';
};

const present = (value: string | null | undefined): boolean => Boolean(value?.trim());

/** Pure config gate shared by `loadWorkerHealth`. Null or incomplete config expects neither worker. */
export const dingtalkWorkerFlagsFromConfig = (
  config: DingtalkWorkerConfig | null | undefined,
): { directorySync: boolean; dingtalkStream: boolean } => {
  if (!present(config?.clientId) || !present(config?.clientSecret)) {
    return { directorySync: false, dingtalkStream: false };
  }
  const notify = config?.notifyApp;
  const directorySync =
    present(notify?.appKey) && present(notify?.appSecret) && present(notify?.agentId);
  return { directorySync, dingtalkStream: config?.chatEnabled === true };
};

export const expectedWorkersFromEnv = (
  env: Partial<NodeJS.ProcessEnv>,
  modules: WorkerExpectationFlags,
): ExpectedWorker[] => {
  const expected: ExpectedWorker[] = [];
  const push = (name: MonitoredWorkerName) => {
    expected.push({ intervalMs: WORKER_INTERVAL_MS[name], name });
  };
  if (persistentCore(env)) {
    push('reminder');
    push('approval_worker');
    if (modules.directorySync) push('directory_sync');
  }
  if (taskSchedulerExpected(env)) {
    push('task_scheduler');
    push('task_sweep');
    push('task_watchdog');
  }
  if (dingtalkStreamExpected(env) && modules.dingtalkStream) push('dingtalk_stream');
  if (modules.documentRender && isPersistentEnterpriseWorkerRuntime(env)) push('document_render');
  // Same gate as the orphan-gc scheduler: persistent production runtime, unless
  // GLOBAL_FILE_ORPHAN_GC is 0/false/no/off. The tick is the enqueue loop.
  if (
    isPersistentEnterpriseWorkerRuntime(env) &&
    !isGlobalFileOrphanGcDisabled(env.GLOBAL_FILE_ORPHAN_GC)
  ) {
    push('global_file_orphan_gc');
  }
  return expected;
};

export const projectWorkerHealth = (
  expected: readonly ExpectedWorker[],
  beats: ReadonlyMap<string, WorkerBeat>,
  now: number,
): WorkerHealth[] =>
  expected.map((worker) => {
    const beat = beats.get(worker.name);
    const intervalMs = beat?.intervalMs || worker.intervalMs;
    const started = Boolean(beat?.startedAt);
    const lastTickAt = beat?.lastTickAt ? new Date(beat.lastTickAt) : null;
    const startedAt = beat?.startedAt ? new Date(beat.startedAt) : null;
    const base = {
      intervalMs,
      ...(beat?.lastError ? { lastError: beat.lastError } : {}),
      lastTickAt,
      name: worker.name,
      started,
      startedAt,
    };
    if (!started || beat?.failed) {
      return { ...base, status: 'unavailable' as const };
    }
    const mark = beat?.lastTickAt ?? beat?.startedAt ?? 0;
    if (now - mark > intervalMs * 2) {
      return { ...base, status: 'degraded' as const };
    }
    return { ...base, status: 'healthy' as const };
  });

const documentRenderEnabled = async (env: Partial<NodeJS.ProcessEnv>): Promise<boolean> => {
  if (!isPersistentEnterpriseWorkerRuntime(env)) return false;
  try {
    return await isModuleEnabled('documentRender');
  } catch {
    try {
      return isBootModuleEnabled('documentRender');
    } catch {
      return false;
    }
  }
};

/**
 * One config read for both DingTalk workers. A lookup failure omits them:
 * an unconfigured connector must not show up as a down worker.
 */
const resolveDingtalkWorkerFlags = async (): Promise<{
  directorySync: boolean;
  dingtalkStream: boolean;
}> => {
  try {
    const { getMessengerDingTalkConfig } = await import('@/config/messenger');
    return dingtalkWorkerFlagsFromConfig(await getMessengerDingTalkConfig());
  } catch {
    return { directorySync: false, dingtalkStream: false };
  }
};

export const loadWorkerHealth = async (params?: {
  directorySyncEnabled?: boolean;
  documentRenderEnabled?: boolean;
  dingtalkStreamEnabled?: boolean;
  env?: Partial<NodeJS.ProcessEnv>;
  now?: number;
}): Promise<WorkerHealth[]> => {
  const env = params?.env ?? process.env;
  const now = params?.now ?? Date.now();
  try {
    const documentRender = params?.documentRenderEnabled ?? (await documentRenderEnabled(env));
    const needLookup =
      params?.directorySyncEnabled === undefined || params?.dingtalkStreamEnabled === undefined;
    const resolved = needLookup ? await resolveDingtalkWorkerFlags() : undefined;
    const directorySync = params?.directorySyncEnabled ?? resolved?.directorySync ?? false;
    const dingtalkStream = params?.dingtalkStreamEnabled ?? resolved?.dingtalkStream ?? false;
    const expected = expectedWorkersFromEnv(env, {
      directorySync,
      documentRender,
      dingtalkStream,
    });
    const beats = await readWorkerBeats();
    return projectWorkerHealth(expected, beats, now);
  } catch {
    return [];
  }
};
