import { isRecord } from '@lobechat/utils/object';

import { dingtalkPersonalEnv } from '@/envs/dingtalkPersonal';

import { DingtalkPersonalError, sanitizeUpstreamMessage } from './errors';

export const DINGTALK_PERSONAL_BROKER_TIMEOUT_MS = {
  cancelLogin: 45_000,
  download: 150_000,
  exec: 75_000,
  loginJob: 10_000,
  loginStart: 30_000,
  profileStatus: 30_000,
  revoke: 45_000,
} as const;

export type DingtalkPersonalLoginStatus =
  'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

export type DingtalkPersonalLoginErrorCode =
  'IDENTITY_MISMATCH' | 'ORG_CLI_DISABLED' | 'LOGIN_TIMEOUT' | 'LOGIN_FAILED';

export interface DingtalkPersonalLoginView {
  errorCode?: DingtalkPersonalLoginErrorCode;
  expiresAt: string;
  jobId: string;
  mismatchUserName?: string;
  status: DingtalkPersonalLoginStatus;
  userCode: string;
  verificationUrl: string;
}

export interface BrokerLoginIdentity {
  corpId: string;
  corpName: string;
  userId: string;
  userName: string;
}

export interface BrokerLoginJob {
  errorCode?: DingtalkPersonalLoginErrorCode;
  expiresAt: string;
  identity?: BrokerLoginIdentity;
  jobId: string;
  status: DingtalkPersonalLoginStatus;
  userCode: string;
  verificationUrl: string;
}

export interface BrokerProfileStatus {
  authenticated: boolean;
  corpName?: string;
  tokenValid?: boolean;
  userName?: string;
}

const LOGIN_STATUSES = new Set<DingtalkPersonalLoginStatus>([
  'cancelled',
  'expired',
  'failed',
  'pending',
  'succeeded',
]);

const LOGIN_ERRORS = new Set<DingtalkPersonalLoginErrorCode>([
  'IDENTITY_MISMATCH',
  'LOGIN_FAILED',
  'LOGIN_TIMEOUT',
  'ORG_CLI_DISABLED',
]);

/**
 * Device-login links must be https on login.dingtalk.com or another
 * `*.dingtalk.com` host. Anything else is treated as a failed login start.
 */
export const isDingtalkVerificationUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/\.$/, '').toLowerCase();
    return host === 'login.dingtalk.com' || host.endsWith('.dingtalk.com');
  } catch {
    return false;
  }
};

const requireBroker = (): { token: string; url: string } => {
  const url = dingtalkPersonalEnv.DINGTALK_PERSONAL_BROKER_URL;
  const token = dingtalkPersonalEnv.DINGTALK_PERSONAL_BROKER_TOKEN;
  if (!url || !token) throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  return { token, url: url.replace(/\/$/, '') };
};

const mapHttpError = (status: number, code: string, message: unknown): DingtalkPersonalError => {
  if (status === 401 || code === 'UNAUTHORIZED') {
    return new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
  }
  switch (code) {
    case 'INVALID_ARGS': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS');
    }
    case 'INVALID_PROFILE':
    case 'UNKNOWN_OP': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
    }
    case 'LOGIN_NOT_FOUND': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_LOGIN_NOT_FOUND');
    }
    case 'LOGOUT_FAILED': {
      const text = sanitizeUpstreamMessage(message);
      return new DingtalkPersonalError(
        'DINGTALK_PERSONAL_REVOKE_FAILED',
        text ? { message: text } : undefined,
      );
    }
    case 'LOGIN_START_FAILED': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_UPSTREAM', {
        message: sanitizeUpstreamMessage(message),
      });
    }
    case 'PROFILE_NOT_FOUND': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED');
    }
    case 'TOO_MANY_LOGINS': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_RATE_LIMITED');
    }
    case 'TIMEOUT': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_TIMEOUT');
    }
    default: {
      return new DingtalkPersonalError(
        status >= 500 ? 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE' : 'DINGTALK_PERSONAL_INTERNAL',
      );
    }
  }
};

const mapExecError = (error: Record<string, unknown>): DingtalkPersonalError => {
  const code = typeof error.code === 'string' ? error.code : 'INTERNAL';
  switch (code) {
    case 'API_ERROR': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_UPSTREAM', {
        message: sanitizeUpstreamMessage(error.message),
      });
    }
    case 'FILE_TOO_LARGE': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_FILE_TOO_LARGE');
    }
    case 'NOT_AUTHORIZED': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED');
    }
    case 'ORG_POLICY_DENIED': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_ORG_POLICY_DENIED');
    }
    case 'OUTPUT_TOO_LARGE': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_OUTPUT_TOO_LARGE');
    }
    case 'PAT_REQUIRED': {
      const uri = typeof error.patUri === 'string' ? error.patUri : undefined;
      return new DingtalkPersonalError('DINGTALK_PERSONAL_PAT_REQUIRED', uri ? { uri } : undefined);
    }
    case 'RATE_LIMITED': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_RATE_LIMITED');
    }
    case 'TIMEOUT': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_TIMEOUT');
    }
    case 'VALIDATION': {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS');
    }
    default: {
      return new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
    }
  }
};

const requestJson = async (
  path: string,
  init: { body?: Record<string, unknown>; method: string; timeoutMs: number },
): Promise<unknown> => {
  const { token, url } = requireBroker();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    let response: Response;
    try {
      response = await fetch(`${url}${path}`, {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        method: init.method,
        signal: controller.signal,
      });
    } catch {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
    }

    let text: string;
    try {
      // The deadline covers the body. A slow payload must still abort.
      text = await response.text();
    } catch {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
    }

    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
      const code = error && typeof error.code === 'string' ? error.code : '';
      throw mapHttpError(response.status, code, error?.message);
    }

    if (text && payload === null) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
};

const asIdentity = (value: unknown): BrokerLoginIdentity | undefined => {
  if (!isRecord(value)) return undefined;
  const { corpId, corpName, userId, userName } = value;
  if (
    typeof corpId !== 'string' ||
    typeof corpName !== 'string' ||
    typeof userId !== 'string' ||
    typeof userName !== 'string'
  ) {
    return undefined;
  }
  return { corpId, corpName, userId, userName };
};

const asLoginJob = (value: unknown): BrokerLoginJob => {
  if (!isRecord(value)) throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  const { errorCode, expiresAt, jobId, status, userCode, verificationUrl } = value;
  if (
    typeof jobId !== 'string' ||
    typeof expiresAt !== 'string' ||
    typeof userCode !== 'string' ||
    typeof verificationUrl !== 'string' ||
    typeof status !== 'string' ||
    !LOGIN_STATUSES.has(status as DingtalkPersonalLoginStatus)
  ) {
    throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  }
  const safeVerificationUrl = verificationUrl.trim();
  if (!isDingtalkVerificationUrl(safeVerificationUrl)) {
    throw new DingtalkPersonalError('DINGTALK_PERSONAL_UPSTREAM', {
      message: '授权链接无效',
    });
  }
  const parsedError =
    typeof errorCode === 'string' && LOGIN_ERRORS.has(errorCode as DingtalkPersonalLoginErrorCode)
      ? (errorCode as DingtalkPersonalLoginErrorCode)
      : undefined;
  const identity = asIdentity(value.identity);
  return {
    expiresAt,
    jobId,
    status: status as DingtalkPersonalLoginStatus,
    userCode,
    verificationUrl: safeVerificationUrl,
    ...(parsedError ? { errorCode: parsedError } : {}),
    ...(identity ? { identity } : {}),
  };
};

export const toDingtalkPersonalLoginView = (job: BrokerLoginJob): DingtalkPersonalLoginView => ({
  expiresAt: job.expiresAt,
  jobId: job.jobId,
  status: job.status,
  userCode: job.userCode,
  verificationUrl: job.verificationUrl,
  ...(job.errorCode ? { errorCode: job.errorCode } : {}),
  ...(job.errorCode === 'IDENTITY_MISMATCH' && job.identity?.userName
    ? { mismatchUserName: job.identity.userName }
    : {}),
});

const asProfileStatus = (value: unknown): BrokerProfileStatus => {
  if (!isRecord(value) || typeof value.authenticated !== 'boolean') {
    throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  }
  return {
    authenticated: value.authenticated,
    ...(typeof value.corpName === 'string' ? { corpName: value.corpName } : {}),
    ...(typeof value.tokenValid === 'boolean' ? { tokenValid: value.tokenValid } : {}),
    ...(typeof value.userName === 'string' ? { userName: value.userName } : {}),
  };
};

type ExecPayload =
  | { data: unknown; kind: 'data' }
  | { file: { buffer: Buffer; name: string; sizeBytes: number }; kind: 'file' };

const asExec = (value: unknown): ExecPayload => {
  if (!isRecord(value) || (value.ok !== true && value.ok !== false)) {
    throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  }
  if (value.ok === false) {
    throw mapExecError(isRecord(value.error) ? value.error : {});
  }
  if (isRecord(value.file) && typeof value.file.contentBase64 === 'string') {
    const buffer = Buffer.from(value.file.contentBase64, 'base64');
    const name = typeof value.file.name === 'string' && value.file.name ? value.file.name : 'file';
    return { file: { buffer, name, sizeBytes: buffer.length }, kind: 'file' };
  }
  return { data: value.data, kind: 'data' };
};

const profilePath = (profile: string): string => `/v1/profiles/${encodeURIComponent(profile)}`;

export const startDingtalkPersonalLogin = async (input: {
  actor?: string;
  expectedProfile: string;
}): Promise<BrokerLoginJob> => {
  const body: Record<string, unknown> = { expectedProfile: input.expectedProfile };
  if (input.actor) body.actor = input.actor;
  const payload = await requestJson('/v1/login', {
    body,
    method: 'POST',
    timeoutMs: DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginStart,
  });
  return asLoginJob(payload);
};

export const getDingtalkPersonalLoginJob = async (jobId: string): Promise<BrokerLoginJob> => {
  const payload = await requestJson(`/v1/login/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    timeoutMs: DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob,
  });
  return asLoginJob(payload);
};

export interface BrokerLoginCancelResult {
  identity?: BrokerLoginIdentity;
  status: DingtalkPersonalLoginStatus;
}

const asLoginCancel = (value: unknown): BrokerLoginCancelResult => {
  if (!isRecord(value) || value.ok !== true) {
    throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  }
  if (
    typeof value.status !== 'string' ||
    !LOGIN_STATUSES.has(value.status as DingtalkPersonalLoginStatus)
  ) {
    throw new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  }
  const identity = asIdentity(value.identity);
  return {
    status: value.status as DingtalkPersonalLoginStatus,
    ...(identity ? { identity } : {}),
  };
};

export const cancelDingtalkPersonalLogin = async (
  jobId: string,
): Promise<BrokerLoginCancelResult> => {
  const payload = await requestJson(`/v1/login/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    timeoutMs: DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.cancelLogin,
  });
  return asLoginCancel(payload);
};

export const getDingtalkPersonalProfileStatus = async (
  profile: string,
): Promise<BrokerProfileStatus> => {
  const payload = await requestJson(`${profilePath(profile)}/status`, {
    method: 'GET',
    timeoutMs: DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.profileStatus,
  });
  return asProfileStatus(payload);
};

export interface DingtalkPersonalProfileDeleteResult {
  absent: boolean;
  removed: boolean;
}

const asProfileDelete = (value: unknown): DingtalkPersonalProfileDeleteResult => {
  if (!isRecord(value) || value.ok !== true) {
    throw new DingtalkPersonalError('DINGTALK_PERSONAL_REVOKE_FAILED');
  }
  return {
    absent: value.absent === true,
    removed: value.removed === true,
  };
};

export const deleteDingtalkPersonalProfile = async (
  profile: string,
): Promise<DingtalkPersonalProfileDeleteResult> => {
  const payload = await requestJson(profilePath(profile), {
    method: 'DELETE',
    timeoutMs: DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.revoke,
  });
  return asProfileDelete(payload);
};

const postExec = async (
  input: { actor?: string; args: Record<string, unknown>; op: string; profile: string },
  timeoutMs: number,
): Promise<ExecPayload> => {
  const body: Record<string, unknown> = {
    args: input.args,
    op: input.op,
    profile: input.profile,
  };
  if (input.actor) body.actor = input.actor;
  const payload = await requestJson('/v1/exec', { body, method: 'POST', timeoutMs });
  return asExec(payload);
};

export const execDingtalkPersonal = async (input: {
  actor?: string;
  args: Record<string, unknown>;
  op: string;
  profile: string;
}): Promise<unknown> => {
  const result = await postExec(input, DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.exec);
  if (result.kind === 'file') throw new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
  return result.data;
};

export const downloadDingtalkPersonalFile = async (input: {
  actor?: string;
  args: Record<string, unknown>;
  op: string;
  profile: string;
}): Promise<{ buffer: Buffer; name: string; sizeBytes: number }> => {
  const result = await postExec(input, DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.download);
  if (result.kind !== 'file') throw new DingtalkPersonalError('DINGTALK_PERSONAL_INTERNAL');
  return result.file;
};
