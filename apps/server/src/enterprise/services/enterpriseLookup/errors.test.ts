// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ENTERPRISE_LOOKUP_INTERNAL,
  ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
  EnterpriseLookupServiceError,
  formatEnterpriseLookupClientError,
  isEnterpriseLookupErrorCode,
  parseEnterpriseLookupClientError,
} from './errors';

describe('EnterpriseLookupServiceError', () => {
  it('formats PROVIDER_UNAVAILABLE with a fallback provider for the model', () => {
    const error = new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE, {
      fallbackProvider: 'tianyancha',
    });
    expect(formatEnterpriseLookupClientError(error)).toBe(
      `${ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE}:tianyancha`,
    );
    expect(parseEnterpriseLookupClientError(formatEnterpriseLookupClientError(error))).toEqual({
      code: ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE,
      fallbackProvider: 'tianyancha',
    });
  });

  it('does not embed upstream text in the client payload', () => {
    const error = new EnterpriseLookupServiceError(ENTERPRISE_LOOKUP_INTERNAL);
    error.cause = new Error('Authorization: Bearer sk-secret');
    expect(formatEnterpriseLookupClientError(error)).toBe(ENTERPRISE_LOOKUP_INTERNAL);
    expect(error.message).toBe(ENTERPRISE_LOOKUP_INTERNAL);
  });

  it('recognizes stable error codes only', () => {
    expect(isEnterpriseLookupErrorCode(ENTERPRISE_LOOKUP_INTERNAL)).toBe(true);
    expect(isEnterpriseLookupErrorCode('ECONNREFUSED')).toBe(false);
  });
});
