import type {
  DingtalkPersonalIdentityCode,
  DingtalkPersonalLoginView,
} from '@/services/dingtalkPersonal';

/**
 * The router throws `DingtalkPersonalError` as a TRPCError whose message IS the code (contract
 * §3.1), so the code is read off the serialized error rather than one field.
 */
const CODE_PATTERN = /DINGTALK_[A-Z_]+/;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

export const resolveDingtalkPersonalErrorCode = (error: unknown): string | undefined => {
  if (!error) return undefined;

  const haystack =
    typeof error === 'string'
      ? error
      : `${(error as { message?: unknown }).message ?? ''} ${safeStringify(error)}`;

  return haystack.match(CODE_PATTERN)?.[0];
};

const IDENTITY_CODES = new Set<string>([
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_PERSONAL_CORP_ID_MISSING',
] satisfies DingtalkPersonalIdentityCode[]);

/** `setting` key for the identity_required state; an unknown code reads as「not bound yet」. */
export const resolveIdentityRequiredKey = (code: string | undefined): string => {
  const known = code && IDENTITY_CODES.has(code) ? code : 'DINGTALK_IDENTITY_UNBOUND';
  return `dingtalkPersonal.identity.${known}`;
};

/** `setting` key for a `startLogin` that threw. */
export const resolveStartErrorKey = (code: string | undefined): string => {
  if (code && IDENTITY_CODES.has(code)) return resolveIdentityRequiredKey(code);

  switch (code) {
    case 'DINGTALK_PERSONAL_DISABLED':
    case 'DINGTALK_PERSONAL_FEATURE_DISABLED': {
      return 'dingtalkPersonal.start.error.disabled';
    }
    case 'DINGTALK_PERSONAL_RATE_LIMITED': {
      return 'dingtalkPersonal.start.error.rateLimited';
    }
    case 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE':
    case 'DINGTALK_PERSONAL_INTERNAL':
    case 'DINGTALK_PERSONAL_TIMEOUT': {
      return 'dingtalkPersonal.start.error.unavailable';
    }
    default: {
      return 'dingtalkPersonal.start.error.failed';
    }
  }
};

/**
 * `setting` key for a `revoke` that threw. `REVOKE_FAILED` means the sidecar could not remove the
 * stored credential: the authorization is still in force, and trying again later is the remedy.
 */
export const resolveRevokeErrorKey = (code: string | undefined): string => {
  switch (code) {
    case 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE':
    case 'DINGTALK_PERSONAL_REVOKE_FAILED':
    case 'DINGTALK_PERSONAL_TIMEOUT': {
      return 'dingtalkPersonal.revoke.error.retryLater';
    }
    default: {
      return 'dingtalkPersonal.revoke.failed';
    }
  }
};

export interface LoginFailureMessage {
  key: string;
  values?: Record<string, string>;
}

/**
 * What a finished-but-unsuccessful login says. `undefined` while it is still pending or once it
 * succeeded. The error code wins over the status: a mismatch is reported as `failed`, and what the
 * member has to do about it is the part worth saying.
 */
export const resolveLoginFailure = (
  login: Pick<DingtalkPersonalLoginView, 'errorCode' | 'mismatchUserName' | 'status'>,
): LoginFailureMessage | undefined => {
  if (login.status === 'pending' || login.status === 'succeeded') return undefined;

  if (login.errorCode === 'IDENTITY_MISMATCH') {
    const name = login.mismatchUserName?.trim();
    return name
      ? { key: 'dingtalkPersonal.login.error.identityMismatch', values: { name } }
      : { key: 'dingtalkPersonal.login.error.identityMismatchUnknown' };
  }
  if (login.errorCode === 'ORG_CLI_DISABLED')
    return { key: 'dingtalkPersonal.login.error.orgCliDisabled' };
  if (login.status === 'expired' || login.errorCode === 'LOGIN_TIMEOUT')
    return { key: 'dingtalkPersonal.login.error.expired' };
  if (login.status === 'cancelled') return { key: 'dingtalkPersonal.login.error.cancelled' };

  return { key: 'dingtalkPersonal.login.error.failed' };
};
