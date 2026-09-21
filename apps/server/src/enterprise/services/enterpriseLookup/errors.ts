export const ENTERPRISE_LOOKUP_TOOL_IDENTIFIER = 'lobe-enterprise-lookup';

export const ENTERPRISE_LOOKUP_NOT_CONFIGURED = 'ENTERPRISE_LOOKUP_NOT_CONFIGURED';
export const ENTERPRISE_LOOKUP_DAILY_LIMIT = 'ENTERPRISE_LOOKUP_DAILY_LIMIT';
export const ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE = 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE';
export const ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN = 'ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN';
export const ENTERPRISE_LOOKUP_INVALID_ARGUMENTS = 'ENTERPRISE_LOOKUP_INVALID_ARGUMENTS';
export const ENTERPRISE_LOOKUP_INTERNAL = 'ENTERPRISE_LOOKUP_INTERNAL';

export type EnterpriseLookupErrorCode =
  | typeof ENTERPRISE_LOOKUP_NOT_CONFIGURED
  | typeof ENTERPRISE_LOOKUP_DAILY_LIMIT
  | typeof ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE
  | typeof ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN
  | typeof ENTERPRISE_LOOKUP_INVALID_ARGUMENTS
  | typeof ENTERPRISE_LOOKUP_INTERNAL;

export const ENTERPRISE_LOOKUP_ERROR_CODES: ReadonlySet<string> = new Set([
  ENTERPRISE_LOOKUP_NOT_CONFIGURED,
  ENTERPRISE_LOOKUP_DAILY_LIMIT,
  ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
  ENTERPRISE_LOOKUP_CAPABILITY_UNKNOWN,
  ENTERPRISE_LOOKUP_INVALID_ARGUMENTS,
  ENTERPRISE_LOOKUP_INTERNAL,
]);

export type EnterpriseLookupProbeReason =
  'not_configured' | 'unauthorized' | 'unreachable' | 'timeout' | 'quota_exceeded';

export class EnterpriseLookupServiceError extends Error {
  readonly code: EnterpriseLookupErrorCode;
  readonly fallbackProvider?: 'qcc' | 'tianyancha';

  constructor(
    code: EnterpriseLookupErrorCode,
    options?: { fallbackProvider?: 'qcc' | 'tianyancha' },
  ) {
    super(code);
    this.name = 'EnterpriseLookupServiceError';
    this.code = code;
    this.fallbackProvider = options?.fallbackProvider;
  }
}

/** Stable client/model-facing payload. Never includes upstream text or credentials. */
export const formatEnterpriseLookupClientError = (error: EnterpriseLookupServiceError): string => {
  if (error.code === ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE && error.fallbackProvider) {
    return `${error.code}:${error.fallbackProvider}`;
  }
  return error.code;
};

export const parseEnterpriseLookupClientError = (
  message: string,
): { code: string; fallbackProvider?: 'qcc' | 'tianyancha' } => {
  const [code, fallback] = message.split(':');
  if (
    code === ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE &&
    (fallback === 'qcc' || fallback === 'tianyancha')
  ) {
    return { code, fallbackProvider: fallback };
  }
  return { code: message };
};

export const isEnterpriseLookupErrorCode = (value: unknown): value is EnterpriseLookupErrorCode =>
  typeof value === 'string' && ENTERPRISE_LOOKUP_ERROR_CODES.has(value);
