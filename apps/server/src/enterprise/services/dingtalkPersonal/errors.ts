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

const CODE_SET = new Set<string>(DINGTALK_PERSONAL_ERROR_CODES);

export const isDingtalkPersonalErrorCode = (value: unknown): value is DingtalkPersonalErrorCode =>
  typeof value === 'string' && CODE_SET.has(value);

const SECRET_KEY = /token|authorization|secret|password/i;

/** Strip broker tokens and bearer material from anything that might leave the process. */
export const redactSecrets = (value: string): string => {
  let out = value;
  const token = process.env.DINGTALK_PERSONAL_BROKER_TOKEN;
  if (token && token.length >= 8) out = out.split(token).join('[redacted]');
  out = out.replaceAll(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  out = out.replaceAll(
    /(access_token|refresh_token|authorization|token)\s*[:=]\s*\S+/gi,
    '$1=[redacted]',
  );
  return out;
};

export const sanitizeUpstreamMessage = (value: unknown, max = 200): string => {
  const raw = typeof value === 'string' ? value : '';
  return redactSecrets(raw).replaceAll(/\s+/g, ' ').trim().slice(0, max);
};

const sanitizeDetails = (details: Record<string, unknown>): Record<string, unknown> | undefined => {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) continue;
    clean[key] = typeof value === 'string' ? redactSecrets(value).slice(0, 500) : value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
};

export class DingtalkPersonalError extends Error {
  readonly code: DingtalkPersonalErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DingtalkPersonalErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'DingtalkPersonalError';
    this.code = code;
    if (details) this.details = sanitizeDetails(details);
  }
}
