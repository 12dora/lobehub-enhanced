import { randomBytes } from 'node:crypto';

import { writeAudit } from './audit.ts';
import {
  LOGIN_CANCEL_LIST_MS,
  LOGIN_CANCEL_WAIT_MS,
  LOGIN_CHILD_MS,
  LOGIN_KEEP_MS,
  LOGIN_READY_MS,
  LOGIN_START_DEADLINE_MS,
  MAX_PENDING_LOGINS,
  STDERR_CAP_BYTES,
} from './constants.ts';
import { BrokerError, QueueTimeoutError } from './errors.ts';
import { isValidProfile } from './ops.ts';
import type { ListedProfile, ProfileStore } from './profiles.ts';
import type { Runner } from './runner.ts';
import type {
  LoginErrorCode,
  LoginIdentity,
  LoginJobView,
  LoginStatus,
  RunResult,
} from './types.ts';

const LOGIN_ARGV = ['auth', 'login', '--device', '--no-browser', '--format=json'];

export function parseLoginStderr(
  text: string,
): { expiresInSec: number; userCode: string; verificationUrl: string } | undefined {
  // dws localizes this prompt (English on some hosts, Chinese in the container).
  const code = text.match(/(?:authorization code|授权码)\s*[:：]\s*(\S+)/i);
  const expires =
    text.match(/expire in\s*(\d+)\s*seconds/i) ?? text.match(/将在\s*(\d+)\s*秒后过期/);
  const url = text.match(/https:\/\/login\.dingtalk\.com\/\S*user_code=\S+/);
  if (!code?.[1] || !expires?.[1] || !url?.[0]) return undefined;
  const expiresInSec = Number(expires[1]);
  if (!Number.isInteger(expiresInSec) || expiresInSec <= 0) return undefined;
  return { expiresInSec, userCode: code[1], verificationUrl: url[0] };
}

export function parseLoginIdentity(
  stdout: string,
): { identity: LoginIdentity; ok: boolean } | undefined {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  const corpId =
    record.corp_id === undefined || record.corp_id === null ? '' : String(record.corp_id);
  const userId =
    record.user_id === undefined || record.user_id === null ? '' : String(record.user_id);
  const identity: LoginIdentity = {
    corpId,
    corpName:
      record.corp_name === undefined || record.corp_name === null ? '' : String(record.corp_name),
    userId,
    userName:
      record.user_name === undefined || record.user_name === null ? '' : String(record.user_name),
  };
  if (!corpId || !userId) return { identity, ok: false };
  return { identity, ok: record.success !== false && record.ok !== false };
}

const LOGIN_CLOCK_SKEW_MS = 5_000;

function loginAt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * True when `after` was written by this login.
 * No lastLoginAt: only "present now, absent from the snapshot".
 * With lastLoginAt: that, or a timestamp newer than the snapshot (or the job start, if the snapshot had none).
 */
export function profileChangedByLogin(
  before: ListedProfile | undefined,
  after: ListedProfile | undefined,
  startedAt: number,
  snapshotKnown: boolean,
): boolean {
  if (!after) return false;
  if (!snapshotKnown) {
    const next = loginAt(after.lastLoginAt);
    return next !== undefined && next >= startedAt - LOGIN_CLOCK_SKEW_MS;
  }
  if (!before) return true;
  const next = loginAt(after.lastLoginAt);
  if (next === undefined) return false;
  const prev = loginAt(before.lastLoginAt);
  if (prev === undefined) return next >= startedAt - LOGIN_CLOCK_SKEW_MS;
  return next > prev;
}

function identityFrom(profile: string, record: ListedProfile): LoginIdentity {
  const index = profile.indexOf(':');
  return {
    corpId: index > 0 ? profile.slice(0, index) : record.corpId,
    corpName: record.corpName,
    userId: index > 0 ? profile.slice(index + 1) : record.userId,
    userName: record.userName,
  };
}

interface Job {
  actor: string;
  auditCode?: string;
  /** One in-flight DELETE (or replacement) so a second cancel waits on the same reconcile. */
  cancelInflight?: Promise<LoginCancelResult>;
  /** Set before kill. onExit must not settle; cancel reconciles after the child is gone. */
  cancelRequested: boolean;
  errorCode?: LoginErrorCode;
  /** Resolves when onExit has released the profile lock (or the child never started). */
  exited: Promise<void>;
  expectedProfile: string;
  expiresAt: string;
  expiryTimer?: NodeJS.Timeout;
  finishedAt?: number;
  identity?: LoginIdentity;
  jobId: string;
  kill: () => void;
  markExited: () => void;
  markReady?: () => void;
  profilesBefore: Map<string, ListedProfile>;
  /** Defensive: false only if a job is published without a snapshot. Never log that profile out. */
  profilesBeforeKnown: boolean;
  published: boolean;
  /** Fresh profile list failed after cancel. DELETE keeps reporting this. */
  reconcileFailed: boolean;
  release: () => void;
  settled: boolean;
  startedAt: number;
  status: LoginStatus | 'starting';
  stderr: string;
  userCode: string;
  verificationUrl: string;
}

/** Terminal view of DELETE /v1/login/:jobId. Pending is never returned. */
export interface LoginCancelResult {
  identity?: LoginIdentity;
  ok: true;
  /** Only when the post-cancel profile list could not be read. */
  reconciled?: false;
  status: 'succeeded' | 'failed' | 'expired' | 'cancelled';
}

export interface LoginService {
  cancel: (jobId: string) => Promise<LoginCancelResult | undefined>;
  get: (jobId: string) => LoginJobView | undefined;
  start: (input: { actor?: string; expectedProfile: unknown }) => Promise<LoginJobView>;
  stop: () => void;
}

function viewOf(job: Job): LoginJobView {
  const body: LoginJobView = {
    expiresAt: job.expiresAt,
    jobId: job.jobId,
    status: job.status === 'starting' ? 'pending' : job.status,
    userCode: job.userCode,
    verificationUrl: job.verificationUrl,
  };
  if (job.identity) body.identity = job.identity;
  if (job.errorCode) body.errorCode = job.errorCode;
  return body;
}

function cleanActor(actor: unknown): string {
  if (actor === undefined || actor === '') return '';
  // eslint-disable-next-line no-control-regex -- reject/strip control characters in untrusted input
  if (typeof actor !== 'string' || actor.length > 128 || /[\u0000-\u001F\u007F]/.test(actor)) {
    throw new BrokerError(400, 'INVALID_ARGS', '调用方不合法');
  }
  return actor;
}

export function createLoginService(
  runner: Runner,
  profiles: ProfileStore,
  options?: {
    cancelListMs?: number;
    cancelWaitMs?: number;
    childTimeoutMs?: number;
    keepMs?: number;
    maxPending?: number;
    readyTimeoutMs?: number;
    startDeadlineMs?: number;
  },
): LoginService {
  const readyTimeoutMs = options?.readyTimeoutMs ?? LOGIN_READY_MS;
  const childTimeoutMs = options?.childTimeoutMs ?? LOGIN_CHILD_MS;
  const keepMs = options?.keepMs ?? LOGIN_KEEP_MS;
  const maxPending = options?.maxPending ?? MAX_PENDING_LOGINS;
  const startDeadlineMs = options?.startDeadlineMs ?? LOGIN_START_DEADLINE_MS;
  const cancelWaitMs = options?.cancelWaitMs ?? LOGIN_CANCEL_WAIT_MS;
  const cancelListMs = options?.cancelListMs ?? LOGIN_CANCEL_LIST_MS;
  const jobs = new Map<string, Job>();

  const gc = setInterval(() => dropFinished(), 60_000);
  gc.unref();

  function dropFinished(): void {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (
        job.status !== 'starting' &&
        job.status !== 'pending' &&
        job.finishedAt &&
        now - job.finishedAt > keepMs
      ) {
        jobs.delete(id);
      }
    }
  }

  function liveCount(): number {
    let count = 0;
    for (const job of jobs.values()) {
      if (job.status === 'starting' || job.status === 'pending') count += 1;
    }
    return count;
  }

  function audit(job: Job, result?: RunResult): void {
    writeAudit({
      actor: job.actor,
      durationMs: result?.durationMs ?? Date.now() - job.startedAt,
      errorCode: job.auditCode ?? job.errorCode ?? (job.status === 'cancelled' ? 'cancelled' : ''),
      event: 'login',
      exitCode: result?.exitCode ?? null,
      op: 'auth.login',
      profile: job.expectedProfile,
      stdoutBytes: result?.stdoutBytes ?? 0,
    });
  }

  function settle(
    job: Job,
    status: LoginStatus,
    errorCode: LoginErrorCode | undefined,
    result?: RunResult,
    force = false,
  ): void {
    if (job.settled) return;
    // Cancel owns the outcome. Expiry and onExit must not settle a job that is being reconciled.
    if (job.cancelRequested && !force) return;
    job.settled = true;
    job.status = status;
    job.errorCode = errorCode;
    job.finishedAt = Date.now();
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    audit(job, result);
  }

  async function cleanupMismatch(job: Job, returned: string): Promise<void> {
    if (!returned || returned === job.expectedProfile || !isValidProfile(returned)) return;
    // Unreachable from POST /v1/login: a failed snapshot aborts before the child starts.
    if (!job.profilesBeforeKnown) {
      writeAudit({
        actor: job.actor,
        durationMs: Date.now() - job.startedAt,
        errorCode: 'MISMATCH_CLEANUP_SKIPPED',
        event: 'logout',
        op: 'auth.logout',
        profile: returned,
      });
      return;
    }
    if (job.profilesBefore.has(returned)) return;
    try {
      await profiles.logout(returned, job.actor);
    } catch {
      // the mismatch result stands even if logout itself fails
    }
  }

  function resultOf(job: Job): LoginCancelResult {
    if (job.status === 'succeeded') {
      return job.identity
        ? { identity: job.identity, ok: true, status: 'succeeded' }
        : { ok: true, status: 'succeeded' };
    }
    if (job.reconcileFailed) return { ok: true, reconciled: false, status: 'cancelled' };
    if (job.status === 'failed' || job.status === 'expired' || job.status === 'cancelled') {
      return { ok: true, status: job.status };
    }
    return { ok: true, status: 'cancelled' };
  }

  function waitForExit(job: Job, ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
      void job.exited.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async function reconcileCancel(job: Job): Promise<LoginCancelResult> {
    if (job.settled) return resultOf(job);
    let records: ListedProfile[];
    try {
      // Do not take the profile lock. This job holds it until onExit, and a waiter
      // queued behind the job would deadlock the list (and this DELETE) until the queue times out.
      records = await profiles.listRecords({
        queueTimeoutMs: cancelListMs,
        timeoutMs: cancelListMs,
      });
    } catch {
      profiles.invalidate();
      if (job.settled) return resultOf(job);
      job.auditCode = 'CANCEL_RECONCILE_FAILED';
      job.reconcileFailed = true;
      settle(job, 'cancelled', undefined, undefined, true);
      return resultOf(job);
    }
    if (job.settled) return resultOf(job);

    const after = records.find((record) => record.profile === job.expectedProfile);
    const changed = profileChangedByLogin(
      job.profilesBefore.get(job.expectedProfile),
      after,
      job.startedAt,
      job.profilesBeforeKnown,
    );
    const newcomers: string[] = [];
    if (job.profilesBeforeKnown) {
      for (const record of records) {
        if (record.profile !== job.expectedProfile && !job.profilesBefore.has(record.profile)) {
          newcomers.push(record.profile);
        }
      }
    }
    for (const profile of newcomers) {
      if (job.settled) return resultOf(job);
      await cleanupMismatch(job, profile);
    }
    if (job.settled) return resultOf(job);

    if (changed && after) {
      job.identity = identityFrom(job.expectedProfile, after);
      profiles.invalidate();
      settle(job, 'succeeded', undefined, undefined, true);
      return resultOf(job);
    }
    settle(job, 'cancelled', undefined, undefined, true);
    return resultOf(job);
  }

  async function doCancelPending(job: Job): Promise<LoginCancelResult> {
    if (job.settled) return resultOf(job);
    job.cancelRequested = true;
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    job.kill();
    await waitForExit(job, cancelWaitMs);
    if (job.settled) return resultOf(job);
    return reconcileCancel(job);
  }

  function cancelPending(job: Job): Promise<LoginCancelResult> {
    if (job.cancelInflight) return job.cancelInflight;
    const pending = doCancelPending(job);
    job.cancelInflight = pending;
    return pending;
  }

  async function onExit(job: Job, result: RunResult): Promise<void> {
    try {
      if (job.cancelRequested || job.settled) return;
      if (!job.published) {
        if (result.exitCode === 0 && !result.outputTooLarge && !result.spawnError) {
          const parsed = parseLoginIdentity(result.stdout);
          const returned = parsed?.ok ? `${parsed.identity.corpId}:${parsed.identity.userId}` : '';
          await cleanupMismatch(job, returned);
        }
        job.auditCode = 'LOGIN_START_FAILED';
        settle(job, 'failed', 'LOGIN_FAILED', result);
        return;
      }
      if (job.status === 'cancelled') {
        settle(job, 'cancelled', undefined, result);
        return;
      }
      if (result.timedOut) {
        const expired = Date.now() >= Date.parse(job.expiresAt);
        settle(job, expired ? 'expired' : 'failed', 'LOGIN_TIMEOUT', result);
        return;
      }
      if (result.exitCode === 0 && !result.outputTooLarge && !result.spawnError) {
        const parsed = parseLoginIdentity(result.stdout);
        if (!parsed?.ok) {
          settle(job, 'failed', 'LOGIN_FAILED', result);
          return;
        }
        job.identity = parsed.identity;
        const returned = `${parsed.identity.corpId}:${parsed.identity.userId}`;
        if (returned !== job.expectedProfile) {
          await cleanupMismatch(job, returned);
          profiles.invalidate();
          settle(job, 'failed', 'IDENTITY_MISMATCH', result);
          return;
        }
        profiles.invalidate();
        settle(job, 'succeeded', undefined, result);
        return;
      }
      const stderr = `${job.stderr}\n${result.stderr}`;
      if (stderr.includes('developerSettings') || stderr.includes('CLI 未开启')) {
        profiles.invalidate();
        settle(job, 'failed', 'ORG_CLI_DISABLED', result);
        return;
      }
      if (Number.isFinite(Date.parse(job.expiresAt)) && Date.now() >= Date.parse(job.expiresAt)) {
        settle(job, 'expired', 'LOGIN_TIMEOUT', result);
        return;
      }
      settle(job, 'failed', 'LOGIN_FAILED', result);
    } finally {
      job.release();
      job.markExited();
    }
  }

  /** Unpublished (still starting) jobs have not written a token yet. Kill and let start() abort. */
  function cancelUnpublished(job: Job): void {
    if (job.settled || job.published) return;
    if (job.status !== 'starting' && job.status !== 'pending') return;
    job.status = 'cancelled';
    job.kill();
  }

  async function start(input: { actor?: string; expectedProfile: unknown }): Promise<LoginJobView> {
    if (typeof input.expectedProfile !== 'string' || !isValidProfile(input.expectedProfile)) {
      throw new BrokerError(400, 'INVALID_ARGS', '期望身份不合法');
    }
    const actor = cleanActor(input.actor);
    const expectedProfile = input.expectedProfile;
    for (const existing of jobs.values()) {
      if (existing.expectedProfile !== expectedProfile) continue;
      if (existing.published && (existing.status === 'pending' || existing.cancelInflight)) {
        await cancelPending(existing);
      } else {
        cancelUnpublished(existing);
      }
    }
    if (liveCount() >= maxPending)
      throw new BrokerError(429, 'TOO_MANY_LOGINS', '同时进行的登录过多');

    const startedAt = Date.now();
    const deadlineAt = startedAt + startDeadlineMs;
    const remaining = (): number => Math.max(0, deadlineAt - Date.now());
    let resolveExited: (() => void) | undefined;
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });
    const job: Job = {
      actor,
      cancelRequested: false,
      exited,
      expectedProfile,
      expiresAt: '',
      jobId: randomBytes(18).toString('base64url'),
      kill: () => undefined,
      markExited: () => {
        const resolve = resolveExited;
        resolveExited = undefined;
        resolve?.();
      },
      profilesBefore: new Map(),
      profilesBeforeKnown: false,
      published: false,
      reconcileFailed: false,
      release: () => undefined,
      settled: false,
      startedAt,
      status: 'starting',
      stderr: '',
      userCode: '',
      verificationUrl: '',
    };
    // Count this job before any await so concurrent starts cannot all pass the cap.
    jobs.set(job.jobId, job);

    const abortStart = (): never => {
      job.kill();
      job.release();
      if (!job.published) jobs.delete(job.jobId);
      if (!job.settled) {
        writeAudit({
          actor,
          durationMs: Date.now() - startedAt,
          errorCode: 'LOGIN_START_FAILED',
          event: 'login',
          op: 'auth.login',
          profile: expectedProfile,
        });
        job.settled = true;
      }
      throw new BrokerError(502, 'LOGIN_START_FAILED', '登录未能开始，请稍后重试');
    };

    if (remaining() <= 0 || job.status === 'cancelled') abortStart();
    try {
      job.release = await runner.acquireProfileLock(expectedProfile, remaining());
    } catch (error) {
      if (error instanceof QueueTimeoutError || job.status === 'cancelled') abortStart();
      if (!job.published) jobs.delete(job.jobId);
      throw error;
    }
    if (job.status === 'cancelled') abortStart();

    if (remaining() <= 0) abortStart();
    const snapAbort = new AbortController();
    const snapTimer = setTimeout(() => snapAbort.abort(), remaining());
    try {
      const listed = await profiles.listRecords({
        queueTimeoutMs: remaining(),
        signal: snapAbort.signal,
        timeoutMs: remaining(),
      });
      job.profilesBefore = new Map(listed.map((record) => [record.profile, record]));
    } catch {
      abortStart();
    } finally {
      clearTimeout(snapTimer);
    }
    if (job.status === 'cancelled' || snapAbort.signal.aborted || remaining() <= 0) abortStart();
    job.profilesBeforeKnown = true;

    const codeWait = Math.min(readyTimeoutMs, remaining());
    if (codeWait <= 0) abortStart();

    let resolveReady: (() => void) | undefined;
    let rejectReady: ((reason?: unknown) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const readyTimer = setTimeout(() => rejectReady?.(new Error('ready')), codeWait);
    job.markReady = () => {
      clearTimeout(readyTimer);
      resolveReady?.();
    };

    let stderr = '';
    let handle: ReturnType<Runner['spawnChild']>;
    try {
      handle = runner.spawnChild({
        argv: LOGIN_ARGV,
        onStderr: (chunk) => {
          if (stderr.length < STDERR_CAP_BYTES)
            stderr = (stderr + chunk).slice(0, STDERR_CAP_BYTES);
          job.stderr = stderr;
          if (job.published) return;
          const parsed = parseLoginStderr(stderr);
          if (!parsed) return;
          job.userCode = parsed.userCode;
          job.verificationUrl = parsed.verificationUrl;
          job.expiresAt = new Date(Date.now() + parsed.expiresInSec * 1000).toISOString();
          job.markReady?.();
        },
        timeoutMs: childTimeoutMs,
      });
    } catch (error) {
      clearTimeout(readyTimer);
      console.error(error instanceof Error ? error.message : '登录进程启动失败');
      return abortStart();
    }
    job.kill = handle.kill;
    void handle.done.then((result) => {
      if (!job.published) {
        clearTimeout(readyTimer);
        rejectReady?.(result);
      }
      void onExit(job, result);
    });

    try {
      await ready;
      clearTimeout(readyTimer);
      if (job.status === 'cancelled' || job.settled) {
        job.kill();
        if (!job.published) jobs.delete(job.jobId);
        throw new BrokerError(502, 'LOGIN_START_FAILED', '登录未能开始，请稍后重试');
      }
      job.published = true;
      job.status = 'pending';
      job.expiryTimer = setTimeout(
        () => {
          if (job.settled || job.status !== 'pending' || job.cancelRequested) return;
          settle(job, 'expired', 'LOGIN_TIMEOUT');
          handle.kill();
        },
        Math.max(0, Date.parse(job.expiresAt) - Date.now()),
      );
      return viewOf(job);
    } catch {
      clearTimeout(readyTimer);
      job.kill();
      if (!job.published) jobs.delete(job.jobId);
      throw new BrokerError(502, 'LOGIN_START_FAILED', '登录未能开始，请稍后重试');
    }
  }

  function get(jobId: string): LoginJobView | undefined {
    dropFinished();
    const job = jobs.get(jobId);
    if (!job?.published) return undefined;
    return viewOf(job);
  }

  function cancel(jobId: string): Promise<LoginCancelResult | undefined> {
    const job = jobs.get(jobId);
    if (!job?.published) return Promise.resolve(undefined);
    if (job.cancelInflight) return job.cancelInflight;
    if (job.status === 'pending') return cancelPending(job);
    return Promise.resolve(resultOf(job));
  }

  function stop(): void {
    clearInterval(gc);
    for (const job of jobs.values()) {
      if ((job.status === 'starting' || job.status === 'pending') && !job.settled) {
        if (job.published) settle(job, 'cancelled', undefined, undefined, true);
        else job.status = 'cancelled';
        job.kill();
      }
    }
  }

  return { cancel, get, start, stop };
}
