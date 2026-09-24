import type { DingtalkPersonalLoginView } from './brokerClient';
import { getDingtalkPersonalRedis } from './cache';

export const DINGTALK_PERSONAL_LOGIN_JOB_TTL_SEC = 20 * 60;
export const DINGTALK_PERSONAL_LOGIN_USER_TTL_SEC = 16 * 60;
const FINALIZE_TTL_SEC = 30 * 60;

const JOB_ID_RE = /^[\w-]{1,64}$/;

export const isDingtalkPersonalJobId = (value: string): boolean => JOB_ID_RE.test(value);

export interface StoredDingtalkPersonalLogin {
  createdAt: string;
  errorCode?: DingtalkPersonalLoginView['errorCode'];
  expectedProfile: string;
  expiresAt: string;
  jobId: string;
  mismatchUserName?: string;
  origin: 'web' | 'dingtalk';
  status: DingtalkPersonalLoginView['status'];
  userCode: string;
  userId: string;
  verificationUrl: string;
}

const jobKey = (jobId: string) => `dingtalk-personal:login:${jobId}`;
const userKey = (userId: string) => `dingtalk-personal:login-user:${userId}`;
const claimKey = (jobId: string) => `dingtalk-personal:finalize:${jobId}`;
const cancelMarkerKey = (jobId: string) => `dingtalk-personal:login-cancelled:${jobId}`;

interface MemoryJob {
  expiresAt: number;
  record: StoredDingtalkPersonalLogin;
}

const memoryJobs = new Map<string, MemoryJob>();
const memoryUsers = new Map<string, { expiresAt: number; jobId: string }>();
const memoryClaims = new Map<string, number>();
const memoryCancels = new Map<string, number>();

export const resetDingtalkPersonalLoginStoreForTest = (): void => {
  memoryJobs.clear();
  memoryUsers.clear();
  memoryClaims.clear();
  memoryCancels.clear();
};

const STATUSES = new Set(['cancelled', 'expired', 'failed', 'pending', 'succeeded']);
const ORIGINS = new Set(['dingtalk', 'web']);

const isStored = (value: unknown): value is StoredDingtalkPersonalLogin => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredDingtalkPersonalLogin>;
  return (
    typeof record.createdAt === 'string' &&
    typeof record.expectedProfile === 'string' &&
    typeof record.expiresAt === 'string' &&
    typeof record.jobId === 'string' &&
    typeof record.status === 'string' &&
    STATUSES.has(record.status) &&
    typeof record.userCode === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.verificationUrl === 'string' &&
    typeof record.origin === 'string' &&
    ORIGINS.has(record.origin)
  );
};

const parseStored = (raw: string): StoredDingtalkPersonalLogin | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const sweepMemory = (): void => {
  const now = Date.now();
  for (const [key, value] of memoryJobs) {
    if (value.expiresAt <= now) memoryJobs.delete(key);
  }
  for (const [key, value] of memoryUsers) {
    if (value.expiresAt <= now) memoryUsers.delete(key);
  }
  for (const [key, expiresAt] of memoryClaims) {
    if (expiresAt <= now) memoryClaims.delete(key);
  }
  for (const [key, expiresAt] of memoryCancels) {
    if (expiresAt <= now) memoryCancels.delete(key);
  }
};

const readMemoryJob = (jobId: string): StoredDingtalkPersonalLogin | null => {
  const row = memoryJobs.get(jobId);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    memoryJobs.delete(jobId);
    return null;
  }
  return row.record;
};

const readMemoryUserJobId = (userId: string): string | null => {
  const row = memoryUsers.get(userId);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    memoryUsers.delete(userId);
    return null;
  }
  return row.jobId;
};

const writeMemory = (record: StoredDingtalkPersonalLogin): void => {
  sweepMemory();
  const now = Date.now();
  memoryJobs.set(record.jobId, {
    expiresAt: now + DINGTALK_PERSONAL_LOGIN_JOB_TTL_SEC * 1000,
    record,
  });
  memoryUsers.set(record.userId, {
    expiresAt: now + DINGTALK_PERSONAL_LOGIN_USER_TTL_SEC * 1000,
    jobId: record.jobId,
  });
};

const forgetMemory = (jobId: string, userId?: string): void => {
  memoryJobs.delete(jobId);
  if (!userId) return;
  const pointed = memoryUsers.get(userId);
  if (pointed?.jobId === jobId) memoryUsers.delete(userId);
};

const remainingSec = (expiresAt: number, fallback: number): number => {
  const seconds = Math.ceil((expiresAt - Date.now()) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return seconds;
};

const restoreLoginToRedis = async (
  redis: NonNullable<ReturnType<typeof getDingtalkPersonalRedis>>,
  record: StoredDingtalkPersonalLogin,
): Promise<void> => {
  const job = memoryJobs.get(record.jobId);
  const user = memoryUsers.get(record.userId);
  try {
    await redis.set(
      jobKey(record.jobId),
      JSON.stringify(record),
      'EX',
      job
        ? remainingSec(job.expiresAt, DINGTALK_PERSONAL_LOGIN_JOB_TTL_SEC)
        : DINGTALK_PERSONAL_LOGIN_JOB_TTL_SEC,
    );
    if (user?.jobId === record.jobId) {
      await redis.set(
        userKey(record.userId),
        record.jobId,
        'EX',
        remainingSec(user.expiresAt, DINGTALK_PERSONAL_LOGIN_USER_TTL_SEC),
      );
    }
  } catch {
    // The memory copy is still returned. A later read can try Redis again.
  }
};

export const getStoredDingtalkPersonalLogin = async (
  jobId: string,
): Promise<StoredDingtalkPersonalLogin | null> => {
  if (!isDingtalkPersonalJobId(jobId)) return null;
  const redis = getDingtalkPersonalRedis();
  if (!redis) return readMemoryJob(jobId);
  try {
    const raw = await redis.get(jobKey(jobId));
    if (raw) {
      const parsed = parseStored(raw);
      if (parsed) return parsed;
    }
  } catch {
    return readMemoryJob(jobId);
  }
  const remembered = readMemoryJob(jobId);
  if (!remembered) return null;
  await restoreLoginToRedis(redis, remembered);
  return remembered;
};

const resolveUserJobId = async (userId: string): Promise<string | null> => {
  const redis = getDingtalkPersonalRedis();
  if (!redis) return readMemoryUserJobId(userId);
  try {
    const stored = await redis.get(userKey(userId));
    if (stored) return stored;
  } catch {
    return readMemoryUserJobId(userId);
  }
  const remembered = readMemoryUserJobId(userId);
  if (!remembered) return null;
  const row = memoryUsers.get(userId);
  try {
    await redis.set(
      userKey(userId),
      remembered,
      'EX',
      row
        ? remainingSec(row.expiresAt, DINGTALK_PERSONAL_LOGIN_USER_TTL_SEC)
        : DINGTALK_PERSONAL_LOGIN_USER_TTL_SEC,
    );
  } catch {
    // Redis missed and the write-back failed; the memory copy is still served.
  }
  return remembered;
};

export const getDingtalkPersonalLoginForUser = async (
  userId: string,
): Promise<StoredDingtalkPersonalLogin | null> => {
  const jobId = await resolveUserJobId(userId);
  if (!jobId) return null;
  const record = await getStoredDingtalkPersonalLogin(jobId);
  if (!record || record.userId !== userId) return null;
  return record;
};

export const putStoredDingtalkPersonalLogin = async (
  record: StoredDingtalkPersonalLogin,
): Promise<void> => {
  if (!isDingtalkPersonalJobId(record.jobId)) return;
  const payload = JSON.stringify(record);
  const redis = getDingtalkPersonalRedis();
  if (redis) {
    try {
      await redis.set(jobKey(record.jobId), payload, 'EX', DINGTALK_PERSONAL_LOGIN_JOB_TTL_SEC);
      await redis.set(
        userKey(record.userId),
        record.jobId,
        'EX',
        DINGTALK_PERSONAL_LOGIN_USER_TTL_SEC,
      );
      forgetMemory(record.jobId, record.userId);
      return;
    } catch {
      // Fall through to the in-process map.
    }
  }
  writeMemory(record);
};

export const updateStoredDingtalkPersonalLogin = async (
  jobId: string,
  view: DingtalkPersonalLoginView,
): Promise<void> => {
  const current = await getStoredDingtalkPersonalLogin(jobId);
  if (!current || current.jobId !== view.jobId) return;
  const next: StoredDingtalkPersonalLogin = {
    createdAt: current.createdAt,
    expectedProfile: current.expectedProfile,
    expiresAt: view.expiresAt,
    jobId: current.jobId,
    origin: current.origin,
    status: view.status,
    userCode: view.userCode,
    userId: current.userId,
    verificationUrl: view.verificationUrl,
  };
  if (view.errorCode) next.errorCode = view.errorCode;
  if (view.mismatchUserName) next.mismatchUserName = view.mismatchUserName;
  await putStoredDingtalkPersonalLogin(next);
};

export const deleteStoredDingtalkPersonalLogin = async (jobId: string): Promise<void> => {
  const current = await getStoredDingtalkPersonalLogin(jobId);
  forgetMemory(jobId, current?.userId);
  const redis = getDingtalkPersonalRedis();
  if (!redis) return;
  try {
    await redis.del(jobKey(jobId));
    if (current) {
      const pointed = await redis.get(userKey(current.userId));
      if (pointed === jobId) await redis.del(userKey(current.userId));
    }
  } catch {
    // The memory copy is already gone.
  }
};

export const readPendingDingtalkPersonalLogin = async (
  userId: string,
): Promise<DingtalkPersonalLoginView | undefined> => {
  const record = await getDingtalkPersonalLoginForUser(userId);
  if (!record || record.status !== 'pending') return undefined;
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) return undefined;
  return {
    expiresAt: record.expiresAt,
    jobId: record.jobId,
    status: record.status,
    userCode: record.userCode,
    verificationUrl: record.verificationUrl,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.mismatchUserName ? { mismatchUserName: record.mismatchUserName } : {}),
  };
};

const claimMemory = (jobId: string): boolean => {
  const now = Date.now();
  const existing = memoryClaims.get(jobId);
  if (existing && existing > now) return false;
  memoryClaims.set(jobId, now + FINALIZE_TTL_SEC * 1000);
  return true;
};

export const claimDingtalkPersonalFinalize = async (jobId: string): Promise<boolean> => {
  const redis = getDingtalkPersonalRedis();
  if (redis) {
    try {
      const result = await redis.set(claimKey(jobId), '1', 'EX', FINALIZE_TTL_SEC, 'NX');
      return result === 'OK';
    } catch {
      return claimMemory(jobId);
    }
  }
  return claimMemory(jobId);
};

const memoryCancelLive = (jobId: string): boolean => {
  const expiresAt = memoryCancels.get(jobId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    memoryCancels.delete(jobId);
    return false;
  }
  return true;
};

/** Survives deletion of the job record so an in-flight watcher cannot finalize it. */
export const markDingtalkPersonalLoginCancelled = async (jobId: string): Promise<void> => {
  if (!isDingtalkPersonalJobId(jobId)) return;
  sweepMemory();
  memoryCancels.set(jobId, Date.now() + DINGTALK_PERSONAL_LOGIN_JOB_TTL_SEC * 1000);
  const redis = getDingtalkPersonalRedis();
  if (!redis) return;
  try {
    await redis.set(cancelMarkerKey(jobId), '1', 'EX', DINGTALK_PERSONAL_LOGIN_JOB_TTL_SEC);
  } catch {
    // This process still has the memory marker.
  }
};

export const clearDingtalkPersonalLoginCancelled = async (jobId: string): Promise<void> => {
  memoryCancels.delete(jobId);
  const redis = getDingtalkPersonalRedis();
  if (!redis) return;
  try {
    await redis.del(cancelMarkerKey(jobId));
  } catch {
    // Memory is already clear.
  }
};

export const isDingtalkPersonalLoginCancelled = async (jobId: string): Promise<boolean> => {
  if (!isDingtalkPersonalJobId(jobId)) return false;
  const redis = getDingtalkPersonalRedis();
  if (redis) {
    try {
      const raw = await redis.get(cancelMarkerKey(jobId));
      if (raw) return true;
    } catch {
      return memoryCancelLive(jobId);
    }
  }
  return memoryCancelLive(jobId);
};

export const releaseDingtalkPersonalFinalize = async (jobId: string): Promise<void> => {
  memoryClaims.delete(jobId);
  const redis = getDingtalkPersonalRedis();
  if (!redis) return;
  try {
    await redis.del(claimKey(jobId));
  } catch {
    // The next finalize attempt may no-op on the audit id.
  }
};
