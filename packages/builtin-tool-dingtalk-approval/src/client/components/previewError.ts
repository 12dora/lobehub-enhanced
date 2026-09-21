/**
 * Stable DingTalk workspace error codes (shared contract §3.4). The UI only
 * ever shows the short message mapped from one of these codes — upstream
 * messages are never rendered.
 */
export const DINGTALK_ERROR_CODES = [
  'DINGTALK_NOT_CONFIGURED',
  'DINGTALK_FEATURE_DISABLED',
  'DINGTALK_FORBIDDEN',
  'DINGTALK_PREMIUM_REQUIRED',
  'DINGTALK_NOT_FOUND',
  'DINGTALK_INVALID',
  'DINGTALK_RATE_LIMITED',
  'DINGTALK_UNAVAILABLE',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_NOT_TASK_OWNER',
  'DINGTALK_NOT_ORIGINATOR',
  'DINGTALK_NOT_APPROVAL_ADMIN',
  'DINGTALK_AUTOMATION_OFF',
  'DINGTALK_RULE_LIMIT',
  'DINGTALK_AMBIGUOUS',
] as const;

export type DingtalkErrorCode = (typeof DINGTALK_ERROR_CODES)[number];

const KNOWN_CODES = new Set<string>(DINGTALK_ERROR_CODES);

const CODE_PATTERN = /DINGTALK_[A-Z_]+/g;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

/**
 * Pull the stable code out of whatever the preview call rejected with: the
 * transport (TRPC / tool error payload) may surface it as `type`, `code`,
 * `body.code` or inside the message, so we scan the serialized error once and
 * keep the first known code.
 */
export const resolveDingtalkErrorCode = (error: unknown): DingtalkErrorCode | undefined => {
  if (!error) return undefined;

  const haystack =
    typeof error === 'string'
      ? error
      : `${(error as { message?: unknown }).message ?? ''} ${safeStringify(error)}`;

  for (const match of haystack.matchAll(CODE_PATTERN)) {
    // Trailing underscores can survive interpolation like `DINGTALK_INVALID_`.
    const code = match[0].replace(/_+$/, '');
    if (KNOWN_CODES.has(code)) return code as DingtalkErrorCode;
  }

  return undefined;
};
