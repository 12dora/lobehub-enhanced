/**
 * Stable error codes of the personal-data service (contract §3). The UI only
 * ever shows the short message mapped from one of these codes — upstream
 * messages are never rendered.
 */
export const DINGTALK_PERSONAL_ERROR_CODES = [
  'DINGTALK_PERSONAL_DISABLED',
  'DINGTALK_PERSONAL_FEATURE_DISABLED',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_PERSONAL_CORP_ID_MISSING',
  'DINGTALK_PERSONAL_UNAUTHORIZED',
  'DINGTALK_PERSONAL_EXPIRED',
  'DINGTALK_PERSONAL_PAT_REQUIRED',
  'DINGTALK_PERSONAL_ORG_POLICY_DENIED',
  'DINGTALK_PERSONAL_RATE_LIMITED',
  'DINGTALK_PERSONAL_INVALID_ARGS',
  'DINGTALK_PERSONAL_UPSTREAM',
  'DINGTALK_PERSONAL_TIMEOUT',
  'DINGTALK_PERSONAL_OUTPUT_TOO_LARGE',
  'DINGTALK_PERSONAL_FILE_TOO_LARGE',
  'DINGTALK_PERSONAL_BROKER_UNAVAILABLE',
  'DINGTALK_PERSONAL_LOGIN_NOT_FOUND',
  'DINGTALK_PERSONAL_REVOKE_FAILED',
  'DINGTALK_PERSONAL_INTERNAL',
] as const;

export type DingtalkPersonalErrorCode = (typeof DINGTALK_PERSONAL_ERROR_CODES)[number];

const KNOWN_CODES = new Set<string>(DINGTALK_PERSONAL_ERROR_CODES);

const CODE_PATTERN = /DINGTALK_[A-Z_]+/g;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

/**
 * Pull the stable code out of whatever failed: the transport (TRPC / tool error
 * payload) may surface it as `code`, `cause.data.code` or inside the message, so
 * the serialized error is scanned once and the first known code wins.
 */
export const resolveDingtalkPersonalErrorCode = (
  error: unknown,
): DingtalkPersonalErrorCode | undefined => {
  if (!error) return undefined;

  const haystack =
    typeof error === 'string'
      ? error
      : `${(error as { message?: unknown }).message ?? ''} ${safeStringify(error)}`;

  for (const match of haystack.matchAll(CODE_PATTERN)) {
    const code = match[0].replace(/_+$/, '');
    if (KNOWN_CODES.has(code)) return code as DingtalkPersonalErrorCode;
  }

  return undefined;
};
