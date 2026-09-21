import { describe, expect, it } from 'vitest';

import { resolveDingtalkErrorCode } from './previewError';

describe('resolveDingtalkErrorCode', () => {
  it('returns undefined for empty errors', () => {
    expect(resolveDingtalkErrorCode(undefined)).toBeUndefined();
    expect(resolveDingtalkErrorCode(null)).toBeUndefined();
    expect(resolveDingtalkErrorCode('')).toBeUndefined();
  });

  it('reads a plain string code', () => {
    expect(resolveDingtalkErrorCode('DINGTALK_PREMIUM_REQUIRED')).toBe('DINGTALK_PREMIUM_REQUIRED');
  });

  it('reads the code from an error message', () => {
    expect(resolveDingtalkErrorCode(new Error('DINGTALK_NOT_TASK_OWNER: task reassigned'))).toBe(
      'DINGTALK_NOT_TASK_OWNER',
    );
  });

  it('reads the code from a nested transport payload', () => {
    const error = {
      data: { body: { code: 'DINGTALK_IDENTITY_UNVERIFIED' } },
      message: 'Internal error',
    };

    expect(resolveDingtalkErrorCode(error)).toBe('DINGTALK_IDENTITY_UNVERIFIED');
  });

  it('ignores unknown DingTalk-shaped codes', () => {
    expect(resolveDingtalkErrorCode({ message: 'DINGTALK_SOMETHING_ELSE' })).toBeUndefined();
  });

  it('keeps the first known code when several are present', () => {
    expect(
      resolveDingtalkErrorCode({
        message: 'DINGTALK_FEATURE_DISABLED',
        reason: 'DINGTALK_FORBIDDEN',
      }),
    ).toBe('DINGTALK_FEATURE_DISABLED');
  });

  it('tolerates circular error objects', () => {
    const error: Record<string, unknown> = { message: 'DINGTALK_RATE_LIMITED' };
    error.self = error;

    expect(resolveDingtalkErrorCode(error)).toBe('DINGTALK_RATE_LIMITED');
  });
});
