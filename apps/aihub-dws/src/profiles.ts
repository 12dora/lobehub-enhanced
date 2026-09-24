import { writeAudit } from './audit.ts';
import {
  CHILD_TIMEOUT_MS,
  LOGOUT_CHILD_MS,
  LOGOUT_TOTAL_MS,
  PROFILE_CACHE_MS,
  STATUS_CHILD_MS,
  STATUS_QUEUE_MS,
} from './constants.ts';
import { BrokerError, ClientClosedError, QueueTimeoutError } from './errors.ts';
import { isValidProfile } from './ops.ts';
import type { Runner } from './runner.ts';
import { toExecResult } from './runner.ts';
import type { RunResult, StatusBody } from './types.ts';

export interface ListedProfile {
  corpId: string;
  corpName: string;
  lastLoginAt?: string;
  profile: string;
  userId: string;
  userName: string;
}

function textField(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function splitProfile(profile: string): { corpId: string; userId: string } {
  const index = profile.indexOf(':');
  if (index <= 0 || index === profile.length - 1) return { corpId: '', userId: '' };
  return { corpId: profile.slice(0, index), userId: profile.slice(index + 1) };
}

function listedFrom(profile: string, record?: Record<string, unknown>): ListedProfile {
  const split = splitProfile(profile);
  const listed: ListedProfile = {
    corpId: (record ? textField(record, ['corpId', 'corp_id']) : '') || split.corpId,
    corpName: record ? textField(record, ['corpName', 'corp_name']) : '',
    profile,
    userId: (record ? textField(record, ['userId', 'user_id']) : '') || split.userId,
    userName: record ? textField(record, ['userName', 'user_name']) : '',
  };
  const lastLoginAt = record ? textField(record, ['lastLoginAt', 'last_login_at']) : '';
  if (lastLoginAt) listed.lastLoginAt = lastLoginAt;
  return listed;
}

/** Names plus the fields cancel uses to see whether this login wrote the token. */
export function mapProfileRecords(data: unknown): ListedProfile[] {
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as { profiles?: unknown }).profiles)
  )
    return [];
  const records: ListedProfile[] = [];
  for (const item of (data as { profiles: unknown[] }).profiles) {
    if (typeof item === 'string') {
      if (item) records.push(listedFrom(item));
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const profile = textField(record, ['profile']);
    if (!profile) continue;
    records.push(listedFrom(profile, record));
  }
  return records;
}

export function mapProfileNames(data: unknown): string[] {
  return mapProfileRecords(data).map((record) => record.profile);
}

export function mapStatus(data: unknown): StatusBody | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.authenticated !== 'boolean') return undefined;
  const body: StatusBody = { authenticated: record.authenticated };
  if (typeof record.token_valid === 'boolean') body.tokenValid = record.token_valid;
  if (typeof record.refresh_token_valid === 'boolean')
    body.refreshTokenValid = record.refresh_token_valid;
  if (typeof record.refresh_expires_at === 'string')
    body.refreshExpiresAt = record.refresh_expires_at;
  if (typeof record.user_name === 'string') body.userName = record.user_name;
  if (typeof record.corp_name === 'string') body.corpName = record.corp_name;
  return body;
}

export interface ProfileListOptions {
  queueTimeoutMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LogoutResult {
  absent?: true;
  ok: true;
  removed: boolean;
}

const LOGOUT_FAILED_MESSAGE = '退出登录失败，授权可能仍在';

export interface ProfileStore {
  has: (profile: string) => Promise<boolean>;
  invalidate: () => void;
  listFresh: (options?: ProfileListOptions) => Promise<Set<string>>;
  /** Uncached `dws profile list`, including lastLoginAt when dws sends it. Does not take a profile lock. */
  listRecords: (options?: ProfileListOptions) => Promise<ListedProfile[]>;
  logout: (profile: string, actor?: string) => Promise<LogoutResult>;
  status: (
    profile: string,
    actor?: string,
    signal?: AbortSignal,
  ) => Promise<{
    body: StatusBody | { error: { code: string; message: string } };
    httpStatus: number;
  }>;
}

export function createProfiles(
  runner: Runner,
  options?: {
    cacheMs?: number;
    /** Default child cap for cached `dws profile list` (exec existence check). */
    childTimeoutMs?: number;
    logoutChildMs?: number;
    logoutTotalMs?: number;
    now?: () => number;
    statusChildMs?: number;
    statusQueueMs?: number;
  },
): ProfileStore {
  const cacheMs = options?.cacheMs ?? PROFILE_CACHE_MS;
  const childTimeoutMs = options?.childTimeoutMs ?? CHILD_TIMEOUT_MS;
  const statusChildMs = options?.statusChildMs ?? STATUS_CHILD_MS;
  const statusQueueMs = options?.statusQueueMs ?? STATUS_QUEUE_MS;
  const logoutChildMs = options?.logoutChildMs ?? LOGOUT_CHILD_MS;
  const logoutTotalMs = options?.logoutTotalMs ?? LOGOUT_TOTAL_MS;
  const now = options?.now ?? Date.now;
  let cache: { at: number; records: ListedProfile[] } | undefined;

  function invalidate(): void {
    cache = undefined;
  }

  async function load(fresh: boolean, limits?: ProfileListOptions): Promise<ListedProfile[]> {
    const at = now();
    if (!fresh && cache && at - cache.at < cacheMs) return cache.records;
    let run;
    try {
      // lockProfile stays false: cancelling a login lists profiles while that login may still hold the lock.
      run = await runner.run({
        argv: ['profile', 'list', '--format=json'],
        lockProfile: false,
        queueTimeoutMs: limits?.queueTimeoutMs,
        signal: limits?.signal,
        timeoutMs: limits?.timeoutMs ?? childTimeoutMs,
      });
    } catch (error) {
      if (error instanceof QueueTimeoutError) throw new BrokerError(502, 'TIMEOUT', error.message);
      throw error;
    }
    const mapped = toExecResult(run);
    if (!mapped.ok) throw new BrokerError(502, mapped.error.code, '无法读取身份列表');
    const records = mapProfileRecords('data' in mapped ? mapped.data : undefined);
    cache = { at, records };
    return records;
  }

  async function loadNames(fresh: boolean, limits?: ProfileListOptions): Promise<Set<string>> {
    return new Set((await load(fresh, limits)).map((record) => record.profile));
  }

  async function status(
    profile: string,
    actor?: string,
    signal?: AbortSignal,
  ): Promise<{
    body: StatusBody | { error: { code: string; message: string } };
    httpStatus: number;
  }> {
    if (!isValidProfile(profile)) throw new BrokerError(400, 'INVALID_PROFILE', '身份标识不合法');
    const started = Date.now();
    let run: RunResult;
    try {
      run = await runner.run({
        argv: ['auth', 'status', `--profile=${profile}`, '--format=json'],
        profile,
        queueTimeoutMs: statusQueueMs,
        signal,
        timeoutMs: statusChildMs,
      });
    } catch (error) {
      if (error instanceof ClientClosedError) throw error;
      if (error instanceof QueueTimeoutError) {
        writeAudit({
          actor,
          durationMs: Date.now() - started,
          errorCode: 'TIMEOUT',
          event: 'status',
          op: 'auth.status',
          profile,
        });
        throw new BrokerError(502, 'TIMEOUT', error.message);
      }
      throw error;
    }
    if (signal?.aborted) throw new ClientClosedError();
    // dws exits 2 when logged out and 3 when the profile is not listed.
    if (
      !run.timedOut &&
      !run.spawnError &&
      !run.outputTooLarge &&
      (run.exitCode === 2 || run.exitCode === 3)
    ) {
      writeAudit({
        actor,
        durationMs: run.durationMs,
        errorCode: 'NOT_AUTHORIZED',
        event: 'status',
        exitCode: run.exitCode,
        op: 'auth.status',
        profile,
        stdoutBytes: run.stdoutBytes,
      });
      return { body: { authenticated: false }, httpStatus: 200 };
    }
    const mapped = toExecResult(run);
    if (!mapped.ok && mapped.error.code === 'NOT_AUTHORIZED') {
      writeAudit({
        actor,
        durationMs: run.durationMs,
        errorCode: 'NOT_AUTHORIZED',
        event: 'status',
        exitCode: run.exitCode,
        op: 'auth.status',
        profile,
        stdoutBytes: run.stdoutBytes,
      });
      return { body: { authenticated: false }, httpStatus: 200 };
    }
    if (!mapped.ok) {
      writeAudit({
        actor,
        durationMs: run.durationMs,
        errorCode: mapped.error.code,
        event: 'status',
        exitCode: run.exitCode,
        op: 'auth.status',
        profile,
        stdoutBytes: run.stdoutBytes,
      });
      return {
        body: { error: { code: mapped.error.code, message: mapped.error.message } },
        httpStatus: 502,
      };
    }
    const body = mapStatus('data' in mapped ? mapped.data : undefined);
    if (!body) {
      writeAudit({
        actor,
        durationMs: run.durationMs,
        errorCode: 'INTERNAL',
        event: 'status',
        exitCode: run.exitCode,
        op: 'auth.status',
        profile,
        stdoutBytes: run.stdoutBytes,
      });
      return {
        body: { error: { code: 'INTERNAL', message: '无法解析认证状态' } },
        httpStatus: 502,
      };
    }
    writeAudit({
      actor,
      durationMs: run.durationMs,
      errorCode: body.authenticated ? '' : 'NOT_AUTHORIZED',
      event: 'status',
      exitCode: run.exitCode,
      op: 'auth.status',
      profile,
      stdoutBytes: run.stdoutBytes,
    });
    return { body, httpStatus: 200 };
  }

  function failLogout(
    profile: string,
    actor: string | undefined,
    started: number,
    exitCode: number | null = null,
    stdoutBytes = 0,
  ): never {
    writeAudit({
      actor,
      durationMs: Date.now() - started,
      errorCode: 'LOGOUT_FAILED',
      event: 'logout',
      exitCode,
      op: 'auth.logout',
      profile,
      stdoutBytes,
    });
    throw new BrokerError(502, 'LOGOUT_FAILED', LOGOUT_FAILED_MESSAGE);
  }

  async function logout(profile: string, actor?: string): Promise<LogoutResult> {
    if (!isValidProfile(profile)) throw new BrokerError(400, 'INVALID_PROFILE', '身份标识不合法');
    const started = Date.now();
    const deadline = started + logoutTotalMs;
    // Queue wait and this child share whatever is left. The child itself stays ≤ logoutChildMs.
    const stepLimits = (): { queueTimeoutMs: number; timeoutMs: number } => {
      const left = deadline - Date.now();
      if (left <= 0) failLogout(profile, actor, started);
      const timeoutMs = Math.min(logoutChildMs, left);
      return { queueTimeoutMs: left - timeoutMs, timeoutMs };
    };

    let present: boolean;
    try {
      present = (await loadNames(true, stepLimits())).has(profile);
    } catch (error) {
      if (error instanceof BrokerError && error.code === 'LOGOUT_FAILED') throw error;
      invalidate();
      failLogout(profile, actor, started);
    }
    if (!present) {
      writeAudit({
        actor,
        durationMs: Date.now() - started,
        errorCode: '',
        event: 'logout',
        op: 'auth.logout',
        profile,
      });
      return { absent: true, ok: true, removed: false };
    }

    const logoutLimits = stepLimits();
    let run: RunResult;
    try {
      run = await runner.run({
        argv: ['auth', 'logout', `--profile=${profile}`],
        profile,
        queueTimeoutMs: logoutLimits.queueTimeoutMs,
        timeoutMs: logoutLimits.timeoutMs,
      });
    } catch (error) {
      if (error instanceof BrokerError && error.code === 'LOGOUT_FAILED') throw error;
      invalidate();
      failLogout(profile, actor, started);
    }
    invalidate();
    const exited = run.exitCode === 0 && !run.timedOut && !run.outputTooLarge && !run.spawnError;
    if (!exited) failLogout(profile, actor, started, run.exitCode, run.stdoutBytes);

    let stillThere = true;
    try {
      stillThere = (await loadNames(true, stepLimits())).has(profile);
    } catch (error) {
      if (error instanceof BrokerError && error.code === 'LOGOUT_FAILED') throw error;
      invalidate();
      failLogout(profile, actor, started, run.exitCode, run.stdoutBytes);
    }
    if (stillThere) failLogout(profile, actor, started, run.exitCode, run.stdoutBytes);
    writeAudit({
      actor,
      durationMs: Date.now() - started,
      errorCode: '',
      event: 'logout',
      exitCode: run.exitCode,
      op: 'auth.logout',
      profile,
      stdoutBytes: run.stdoutBytes,
    });
    return { ok: true, removed: true };
  }

  return {
    has: async (profile) => (await loadNames(false)).has(profile),
    invalidate,
    listFresh: (limits) => loadNames(true, limits),
    listRecords: (limits) => load(true, limits),
    logout,
    status,
  };
}
