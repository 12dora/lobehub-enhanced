import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { DingtalkPersonalAuthorizationModel } from '@/database/models/dingtalkPersonalAuthorization';
import type { LobeChatDatabase } from '@/database/type';

import { appendDingtalkPersonalAudit } from './audit';
import {
  type BrokerLoginCancelResult,
  type BrokerLoginJob,
  cancelDingtalkPersonalLogin,
  deleteDingtalkPersonalProfile,
  type DingtalkPersonalLoginView,
  downloadDingtalkPersonalFile,
  execDingtalkPersonal,
  getDingtalkPersonalLoginJob,
  getDingtalkPersonalProfileStatus,
  startDingtalkPersonalLogin,
  toDingtalkPersonalLoginView,
} from './brokerClient';
import {
  captureDingtalkPersonalCacheGeneration,
  invalidateDingtalkPersonalCache,
  readDingtalkPersonalCache,
  writeDingtalkPersonalCache,
} from './cache';
import {
  DINGTALK_PERSONAL_OP_FEATURE,
  DINGTALK_PERSONAL_WRITE_OPS,
  type DingtalkPersonalConfig,
  type DingtalkPersonalFeature,
  type DingtalkPersonalOp,
  getDingtalkPersonalConfig,
} from './config';
import { DingtalkPersonalError } from './errors';
import {
  type DingtalkPersonalSubject,
  requireDingtalkPersonalSubject,
  resolveDingtalkPersonalSubject,
  splitDingtalkPersonalProfile,
} from './identity';
import {
  claimDingtalkPersonalFinalize,
  clearDingtalkPersonalLoginCancelled,
  deleteStoredDingtalkPersonalLogin,
  getDingtalkPersonalLoginForUser,
  getStoredDingtalkPersonalLogin,
  isDingtalkPersonalJobId,
  markDingtalkPersonalLoginCancelled,
  putStoredDingtalkPersonalLogin,
  readPendingDingtalkPersonalLogin,
  releaseDingtalkPersonalFinalize,
  type StoredDingtalkPersonalLogin,
  updateStoredDingtalkPersonalLogin,
} from './loginStore';
import { stopDingtalkPersonalLoginWatch, watchDingtalkPersonalLogin } from './loginWatcher';
import { withDingtalkPersonalProfileLock } from './profileLock';
import { assertDingtalkPersonalRateLimit } from './rateLimit';

const log = debug('lobe-server:dingtalk-personal');

export type { DingtalkPersonalLoginView } from './brokerClient';

type ReadySubject = Extract<DingtalkPersonalSubject, { ok: true }>;

export type DingtalkPersonalStatus =
  | { state: 'disabled' }
  | {
      code:
        | 'DINGTALK_IDENTITY_UNBOUND'
        | 'DINGTALK_IDENTITY_UNVERIFIED'
        | 'DINGTALK_IDENTITY_INACTIVE'
        | 'DINGTALK_PERSONAL_CORP_ID_MISSING';
      state: 'identity_required';
    }
  | { pendingLogin?: DingtalkPersonalLoginView; state: 'unauthorized' }
  | { dingtalkUserName?: string; lastErrorCode?: string; state: 'expired' }
  | {
      authorizedAt: string;
      corpName: string;
      dingtalkUserName: string;
      features: Record<DingtalkPersonalFeature, boolean>;
      lastCheckedAt?: string;
      state: 'authorized';
    };

const WRITE_OPS = new Set<DingtalkPersonalOp>(DINGTALK_PERSONAL_WRITE_OPS);
const BLOCKED_ARG_KEYS = new Set(['actor', 'expectedProfile', 'profile', 'requestId']);

const invalidateWorkspaceTodoListCache = async (userId: string): Promise<void> => {
  try {
    const { invalidateDingtalkTodoListCache } =
      await import('@/server/enterprise/services/dingtalkWorkspace/todo');
    invalidateDingtalkTodoListCache(userId);
  } catch {
    // The merged list expires on its own.
  }
};

const iso = (value: Date | string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

/** Drop caller-supplied profile/actor fields. The broker profile is set by the server. */
const forwardArgs = (args: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (BLOCKED_ARG_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
};

export interface InterpretedDingtalkPersonalLogin {
  reject: boolean;
  userName?: string;
  view: DingtalkPersonalLoginView;
}

/**
 * A broker `succeeded` job is stored only when its identity equals the profile
 * this server asked for. Anything else is a failed login and is not upserted.
 */
export const interpretDingtalkPersonalLoginJob = (
  meta: StoredDingtalkPersonalLogin,
  job: BrokerLoginJob,
): InterpretedDingtalkPersonalLogin => {
  const view = toDingtalkPersonalLoginView(job);
  const userName = job.identity?.userName;
  if (job.status !== 'succeeded') return { reject: false, userName, view };
  if (!job.identity) {
    return {
      reject: true,
      userName,
      view: { ...view, errorCode: 'LOGIN_FAILED', status: 'failed' },
    };
  }
  const got = `${job.identity.corpId}:${job.identity.userId}`;
  if (got !== meta.expectedProfile) {
    return {
      reject: true,
      userName,
      view: {
        ...view,
        errorCode: 'IDENTITY_MISMATCH',
        mismatchUserName: job.identity.userName,
        status: 'failed',
      },
    };
  }
  return { reject: false, userName, view };
};

export const finalizeDingtalkPersonalLogin = async (
  db: LobeChatDatabase,
  meta: StoredDingtalkPersonalLogin,
  job: BrokerLoginJob,
): Promise<boolean> => {
  const interpreted = interpretDingtalkPersonalLoginJob(meta, job);
  const identity = job.identity;
  if (interpreted.reject || job.status !== 'succeeded' || !identity) return false;
  const started = new Date(meta.createdAt);
  if (Number.isNaN(started.getTime())) return false;

  return withDingtalkPersonalProfileLock(meta.expectedProfile, async () => {
    const claimedProfile = await new DingtalkPersonalAuthorizationModel(
      db,
      meta.userId,
    ).claimActiveProfile(
      {
        corpId: identity.corpId,
        corpName: identity.corpName,
        dingtalkUserName: identity.userName,
        profile: meta.expectedProfile,
        staffId: identity.userId,
      },
      { loginStartedAt: started },
    );
    const row = claimedProfile.row;
    if (!row || row.status !== 'active') return false;

    for (const displaced of claimedProfile.displaced) {
      await invalidateDingtalkPersonalCache(displaced.userId).catch(() => undefined);
      await invalidateWorkspaceTodoListCache(displaced.userId);
      const parts = splitDingtalkPersonalProfile(displaced.profile);
      try {
        await appendDingtalkPersonalAudit(db, displaced.userId, 'revoke', {
          afterDiff: parts
            ? { corpId: parts.corpId, staffId: parts.staffId }
            : { superseded: true },
          targetId: displaced.id,
        });
      } catch (error) {
        log(
          'displaced profile revoke audit failed: %s',
          error instanceof Error ? error.name : 'UnknownError',
        );
      }
    }

    const claimed = await claimDingtalkPersonalFinalize(job.jobId);
    if (!claimed) return false;
    try {
      await appendDingtalkPersonalAudit(db, meta.userId, 'authorize', {
        afterDiff: { corpId: identity.corpId, staffId: identity.userId },
        targetId: job.jobId,
      });
      return true;
    } catch (error) {
      await releaseDingtalkPersonalFinalize(job.jobId);
      throw error;
    }
  });
};

const viewFromStored = (record: StoredDingtalkPersonalLogin): DingtalkPersonalLoginView => ({
  expiresAt: record.expiresAt,
  jobId: record.jobId,
  status: record.status,
  userCode: record.userCode,
  verificationUrl: record.verificationUrl,
  ...(record.errorCode ? { errorCode: record.errorCode } : {}),
  ...(record.mismatchUserName ? { mismatchUserName: record.mismatchUserName } : {}),
});

export interface DingtalkPersonalExecOptions {
  /** Batch caller invalidates read caches once around the whole loop. */
  skipCacheInvalidation?: boolean;
  /** Batch caller already consumed the per-user rate-limit token. */
  skipRateLimit?: boolean;
}

export class DingtalkPersonalService {
  private readonly authz: DingtalkPersonalAuthorizationModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {
    this.authz = new DingtalkPersonalAuthorizationModel(db, userId);
  }

  getStaffId = async (): Promise<string> => {
    const subject = await requireDingtalkPersonalSubject(this.db, this.userId);
    return subject.staffId;
  };

  getStatus = async (): Promise<DingtalkPersonalStatus> => {
    const ready = await this.prepareSubject();
    if (ready.kind === 'status') return ready.status;
    const row = await this.authz.findMine();
    return this.statusFromRow(row, ready.subject, ready.config);
  };

  checkStatus = async (): Promise<DingtalkPersonalStatus> => {
    const ready = await this.prepareSubject();
    if (ready.kind === 'status') return ready.status;
    const row = await this.authz.findMine();
    if (!row || row.status === 'revoked' || row.profile !== ready.subject.profile) {
      return this.unauthorizedStatus();
    }

    const remote = await getDingtalkPersonalProfileStatus(ready.subject.profile);
    const authed = remote.authenticated === true && remote.tokenValid !== false;
    if (!authed) {
      const code = remote.authenticated ? 'TOKEN_INVALID' : 'NOT_AUTHORIZED';
      await this.authz.markExpired(code);
      await this.authz.touchChecked();
      const current = await this.authz.findMine();
      if (!current || current.status === 'revoked' || current.profile !== ready.subject.profile) {
        return this.unauthorizedStatus();
      }
      return {
        lastErrorCode: code,
        state: 'expired',
        ...(current.dingtalkUserName ? { dingtalkUserName: current.dingtalkUserName } : {}),
      };
    }

    const saved = await this.authz.upsertActive(
      {
        corpId: ready.subject.corpId,
        corpName: remote.corpName || row.corpName || '',
        dingtalkUserName: remote.userName || row.dingtalkUserName || '',
        profile: ready.subject.profile,
        staffId: ready.subject.staffId,
      },
      { onlyIfNotRevoked: true },
    );
    await this.authz.touchChecked();
    if (!saved) {
      const current = await this.authz.findMine();
      return this.statusFromRow(current, ready.subject, ready.config);
    }
    const fresh = (await this.authz.findMine()) ?? saved;
    return this.authorizedStatus(fresh, ready.config);
  };

  startLogin = async (opts?: {
    origin?: 'web' | 'dingtalk';
  }): Promise<DingtalkPersonalLoginView> => {
    const config = await getDingtalkPersonalConfig();
    if (!config.enabled) throw new DingtalkPersonalError('DINGTALK_PERSONAL_DISABLED');
    const subject = await requireDingtalkPersonalSubject(this.db, this.userId);
    const origin = opts?.origin === 'dingtalk' ? 'dingtalk' : 'web';
    const existing = await getDingtalkPersonalLoginForUser(this.userId);

    if (existing && existing.status === 'pending' && existing.expectedProfile !== subject.profile) {
      await this.dropLogin(existing.jobId);
    } else if (existing && existing.expectedProfile === subject.profile) {
      const reused = await this.reuseLogin(existing);
      if (reused) return reused;
    }

    const job = await startDingtalkPersonalLogin({
      actor: this.userId,
      expectedProfile: subject.profile,
    });
    if (!isDingtalkPersonalJobId(job.jobId)) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
    }
    const view = toDingtalkPersonalLoginView(job);
    await putStoredDingtalkPersonalLogin({
      createdAt: new Date().toISOString(),
      expectedProfile: subject.profile,
      expiresAt: view.expiresAt,
      jobId: view.jobId,
      origin,
      status: view.status,
      userCode: view.userCode,
      userId: this.userId,
      verificationUrl: view.verificationUrl,
      ...(view.errorCode ? { errorCode: view.errorCode } : {}),
      ...(view.mismatchUserName ? { mismatchUserName: view.mismatchUserName } : {}),
    });
    watchDingtalkPersonalLogin(view.jobId);
    return view;
  };

  getLoginJob = async (jobId: string): Promise<DingtalkPersonalLoginView> => {
    const record = await this.ownedLogin(jobId);
    const job = await getDingtalkPersonalLoginJob(jobId);
    return this.persistLoginJob(record, job);
  };

  cancelLogin = async (jobId: string): Promise<void> => {
    const record = await this.ownedLogin(jobId);
    let job: BrokerLoginJob;
    try {
      job = await getDingtalkPersonalLoginJob(jobId);
    } catch (error) {
      if (
        error instanceof DingtalkPersonalError &&
        error.code === 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND'
      ) {
        await this.forgetLogin(jobId);
        return;
      }
      throw error;
    }

    if (job.status === 'succeeded') {
      await this.persistLoginJob(record, job);
      return;
    }
    if (job.status !== 'pending') {
      await this.forgetLogin(jobId);
      return;
    }

    await markDingtalkPersonalLoginCancelled(jobId);
    let cancelled: BrokerLoginCancelResult;
    try {
      cancelled = await cancelDingtalkPersonalLogin(jobId);
    } catch (error) {
      if (
        error instanceof DingtalkPersonalError &&
        error.code === 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND'
      ) {
        await this.forgetLogin(jobId);
        return;
      }
      await clearDingtalkPersonalLoginCancelled(jobId);
      throw error;
    }

    if (cancelled.status === 'succeeded') {
      await clearDingtalkPersonalLoginCancelled(jobId);
      await this.persistLoginJob(record, {
        expiresAt: job.expiresAt,
        jobId: job.jobId,
        status: 'succeeded',
        userCode: job.userCode,
        verificationUrl: job.verificationUrl,
        ...(cancelled.identity ? { identity: cancelled.identity } : {}),
      });
      return;
    }
    await this.forgetLogin(jobId);
  };

  revoke = async (): Promise<void> => {
    const row = await this.authz.findMine();
    if (!row || row.status === 'revoked') return;

    const subject = await requireDingtalkPersonalSubject(this.db, this.userId);
    if (row.profile !== subject.profile) {
      log(
        'revoke refused: authorization profile does not match the server profile for %s',
        this.userId,
      );
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
    }

    await withDingtalkPersonalProfileLock(row.profile, async () => {
      const heldByOther = await this.authz.hasOtherActiveProfile(row.profile);
      if (!heldByOther) {
        const deleted = await deleteDingtalkPersonalProfile(row.profile);
        if (deleted.removed !== true && deleted.absent !== true) {
          throw new DingtalkPersonalError('DINGTALK_PERSONAL_REVOKE_FAILED');
        }
      }

      const pending = await getDingtalkPersonalLoginForUser(this.userId);
      if (pending) await this.dropLogin(pending.jobId);
      const revoked = await this.authz.markRevoked();
      if (!revoked) return;
      await invalidateDingtalkPersonalCache(this.userId).catch(() => undefined);
      await appendDingtalkPersonalAudit(this.db, this.userId, 'revoke', {
        afterDiff: { corpId: subject.corpId, staffId: subject.staffId },
        targetId: row.id,
      });
    });
  };

  /** One per-user rate-limit token. Batch preview and batch writes share this. */
  reserveRateLimit = async (): Promise<void> => {
    await assertDingtalkPersonalRateLimit(this.userId);
  };

  /**
   * One rate-limit token and one read-cache invalidation before a batch of
   * todo writes. Item calls then pass `skipRateLimit` and `skipCacheInvalidation`.
   */
  beginTodoBatch = async (): Promise<void> => {
    await this.reserveRateLimit();
    await invalidateDingtalkPersonalCache(this.userId).catch(() => undefined);
  };

  /** Workspace todo list and personal read cache, once, after a batch that wrote. */
  commitTodoBatch = async (): Promise<void> => {
    await invalidateWorkspaceTodoListCache(this.userId);
    await invalidateDingtalkPersonalCache(this.userId).catch(() => undefined);
  };

  exec = async (
    op: DingtalkPersonalOp,
    args: Record<string, unknown>,
    options?: DingtalkPersonalExecOptions,
  ): Promise<unknown> => {
    const ready = await this.authorizeOp(op);
    if (op === 'chat.downloadFile' || op === 'drive.download') {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS');
    }
    if (!options?.skipRateLimit) await assertDingtalkPersonalRateLimit(this.userId);
    const forwarded = this.argsOf(args);
    const write = WRITE_OPS.has(op);
    if (write) {
      if (!options?.skipCacheInvalidation) {
        await invalidateDingtalkPersonalCache(this.userId).catch(() => undefined);
      }
    } else {
      const cached = await readDingtalkPersonalCache(this.userId, op, forwarded);
      if (cached !== undefined) return cached;
    }
    const generation = write
      ? undefined
      : await captureDingtalkPersonalCacheGeneration(this.userId);

    try {
      const data = await execDingtalkPersonal({
        actor: this.userId,
        args: forwarded,
        op,
        profile: ready.profile,
      });
      await this.authz.touchLastUsed().catch(() => undefined);
      if (write) {
        if (!options?.skipCacheInvalidation) {
          if (op === 'todo.update' || op === 'todo.complete') {
            await invalidateWorkspaceTodoListCache(this.userId);
          }
          await invalidateDingtalkPersonalCache(this.userId).catch(() => undefined);
        }
      } else if (generation !== undefined) {
        await writeDingtalkPersonalCache(this.userId, op, forwarded, data, generation).catch(
          () => undefined,
        );
      }
      return data;
    } catch (error) {
      return this.expireIfUnauthorized(error);
    }
  };

  downloadFile = async (
    args: Record<string, unknown>,
  ): Promise<{ buffer: Buffer; name: string; sizeBytes: number }> => {
    const ready = await this.authorizeOp('chat.downloadFile');
    await assertDingtalkPersonalRateLimit(this.userId);
    const forwarded = this.argsOf(args);
    try {
      const file = await downloadDingtalkPersonalFile({
        actor: this.userId,
        args: forwarded,
        op: 'chat.downloadFile',
        profile: ready.profile,
      });
      await this.authz.touchLastUsed().catch(() => undefined);
      return file;
    } catch (error) {
      return this.expireIfUnauthorized(error);
    }
  };

  downloadOp = async (
    op: 'drive.download',
    args: Record<string, unknown>,
  ): Promise<{ buffer: Buffer; name: string; sizeBytes: number }> => {
    const ready = await this.authorizeOp(op);
    await assertDingtalkPersonalRateLimit(this.userId);
    const forwarded = this.argsOf(args);
    try {
      const file = await downloadDingtalkPersonalFile({
        actor: this.userId,
        args: forwarded,
        op,
        profile: ready.profile,
      });
      await this.authz.touchLastUsed().catch(() => undefined);
      return file;
    } catch (error) {
      return this.expireIfUnauthorized(error);
    }
  };

  private prepareSubject = async (): Promise<
    | { kind: 'status'; status: DingtalkPersonalStatus }
    | { config: DingtalkPersonalConfig; kind: 'ready'; subject: ReadySubject }
  > => {
    const config = await getDingtalkPersonalConfig();
    if (!config.enabled) return { kind: 'status', status: { state: 'disabled' } };
    const subject = await resolveDingtalkPersonalSubject(this.db, this.userId);
    if (!subject.ok) {
      if (subject.code === 'DINGTALK_PERSONAL_INTERNAL') {
        throw new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
      }
      return { kind: 'status', status: { code: subject.code, state: 'identity_required' } };
    }
    return { config, kind: 'ready', subject };
  };

  private authorizeOp = async (op: DingtalkPersonalOp): Promise<ReadySubject> => {
    const config = await getDingtalkPersonalConfig();
    if (!config.enabled) throw new DingtalkPersonalError('DINGTALK_PERSONAL_DISABLED');
    if (!Object.prototype.hasOwnProperty.call(DINGTALK_PERSONAL_OP_FEATURE, op)) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS');
    }
    const feature = DINGTALK_PERSONAL_OP_FEATURE[op];
    if (feature && !config.features[feature]) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature });
    }
    if (WRITE_OPS.has(op) && !config.features.write) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature: 'write' });
    }
    const subject = await requireDingtalkPersonalSubject(this.db, this.userId);
    const row = await this.authz.findMine();
    if (!row || row.status === 'revoked' || row.profile !== subject.profile) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED');
    }
    if (row.status === 'expired') throw new DingtalkPersonalError('DINGTALK_PERSONAL_EXPIRED');
    if (row.status !== 'active') throw new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED');
    return subject;
  };

  private argsOf = (args: Record<string, unknown>): Record<string, unknown> => {
    if (!isRecord(args)) throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS');
    return forwardArgs(args);
  };

  private expireIfUnauthorized = async (error: unknown): Promise<never> => {
    if (error instanceof DingtalkPersonalError && error.code === 'DINGTALK_PERSONAL_UNAUTHORIZED') {
      await this.authz.markExpired('NOT_AUTHORIZED').catch(() => undefined);
      await invalidateDingtalkPersonalCache(this.userId).catch(() => undefined);
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_EXPIRED');
    }
    throw error;
  };

  private statusFromRow = async (
    row: Awaited<ReturnType<DingtalkPersonalAuthorizationModel['findMine']>>,
    subject: ReadySubject,
    config: DingtalkPersonalConfig,
  ): Promise<DingtalkPersonalStatus> => {
    if (!row || row.status === 'revoked' || row.profile !== subject.profile) {
      return this.unauthorizedStatus();
    }
    if (row.status === 'expired') {
      return {
        state: 'expired',
        ...(row.dingtalkUserName ? { dingtalkUserName: row.dingtalkUserName } : {}),
        ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
      };
    }
    if (row.status !== 'active') return this.unauthorizedStatus();
    return this.authorizedStatus(row, config);
  };

  private authorizedStatus = (
    row: NonNullable<Awaited<ReturnType<DingtalkPersonalAuthorizationModel['findMine']>>>,
    config: DingtalkPersonalConfig,
  ): DingtalkPersonalStatus => {
    const authorizedAt = iso(row.authorizedAt);
    if (!authorizedAt) throw new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
    const lastCheckedAt = iso(row.lastCheckedAt);
    return {
      authorizedAt,
      corpName: row.corpName ?? '',
      dingtalkUserName: row.dingtalkUserName ?? '',
      features: config.features,
      state: 'authorized',
      ...(lastCheckedAt ? { lastCheckedAt } : {}),
    };
  };

  private unauthorizedStatus = async (): Promise<DingtalkPersonalStatus> => {
    const pendingLogin = await readPendingDingtalkPersonalLogin(this.userId);
    return pendingLogin ? { pendingLogin, state: 'unauthorized' } : { state: 'unauthorized' };
  };

  private ownedLogin = async (jobId: string): Promise<StoredDingtalkPersonalLogin> => {
    const record = await getStoredDingtalkPersonalLogin(jobId);
    if (!record || record.userId !== this.userId) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_LOGIN_NOT_FOUND');
    }
    return record;
  };

  private forgetLogin = async (jobId: string): Promise<void> => {
    stopDingtalkPersonalLoginWatch(jobId);
    await deleteStoredDingtalkPersonalLogin(jobId);
  };

  private dropLogin = async (jobId: string): Promise<void> => {
    await this.forgetLogin(jobId);
    await cancelDingtalkPersonalLogin(jobId).catch(() => undefined);
  };

  private persistLoginJob = async (
    record: StoredDingtalkPersonalLogin,
    job: BrokerLoginJob,
  ): Promise<DingtalkPersonalLoginView> => {
    const interpreted = interpretDingtalkPersonalLoginJob(record, job);
    await updateStoredDingtalkPersonalLogin(record.jobId, interpreted.view);
    if (job.status === 'succeeded' && !interpreted.reject) {
      await finalizeDingtalkPersonalLogin(this.db, record, job);
    }
    return interpreted.view;
  };

  private reuseLogin = async (
    existing: StoredDingtalkPersonalLogin,
  ): Promise<DingtalkPersonalLoginView | null> => {
    const pending = existing.status === 'pending' && Date.parse(existing.expiresAt) > Date.now();
    if (!pending && existing.status !== 'succeeded') return null;
    try {
      const job = await getDingtalkPersonalLoginJob(existing.jobId);
      const view = await this.persistLoginJob(existing, job);
      if (job.status === 'pending' && Date.parse(job.expiresAt) > Date.now()) {
        watchDingtalkPersonalLogin(existing.jobId);
        return view;
      }
      if (view.status === 'succeeded') return view;
      return null;
    } catch (error) {
      if (
        error instanceof DingtalkPersonalError &&
        error.code === 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND'
      ) {
        return null;
      }
      if (pending) {
        watchDingtalkPersonalLogin(existing.jobId);
        return viewFromStored(existing);
      }
      throw error;
    }
  };
}
