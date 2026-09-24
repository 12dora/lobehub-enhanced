import { describe, expect, it } from 'vitest';

import { resolveDingtalkPersonalErrorCode } from './errorCode';

describe('resolveDingtalkPersonalErrorCode', () => {
  it('returns undefined for empty errors', () => {
    expect(resolveDingtalkPersonalErrorCode(undefined)).toBeUndefined();
    expect(resolveDingtalkPersonalErrorCode(null)).toBeUndefined();
    expect(resolveDingtalkPersonalErrorCode('')).toBeUndefined();
  });

  it('reads a plain string code', () => {
    expect(resolveDingtalkPersonalErrorCode('DINGTALK_PERSONAL_EXPIRED')).toBe(
      'DINGTALK_PERSONAL_EXPIRED',
    );
  });

  it('keeps the longer feature code apart from the master switch code', () => {
    expect(resolveDingtalkPersonalErrorCode(new Error('DINGTALK_PERSONAL_FEATURE_DISABLED'))).toBe(
      'DINGTALK_PERSONAL_FEATURE_DISABLED',
    );
  });

  it('reads the code from a nested TRPC payload', () => {
    const error = {
      data: { cause: { data: { code: 'DINGTALK_IDENTITY_UNVERIFIED' } } },
      message: 'PRECONDITION_FAILED',
    };

    expect(resolveDingtalkPersonalErrorCode(error)).toBe('DINGTALK_IDENTITY_UNVERIFIED');
  });

  it('ignores codes of other DingTalk toolsets', () => {
    expect(
      resolveDingtalkPersonalErrorCode({ message: 'DINGTALK_NOT_TASK_OWNER' }),
    ).toBeUndefined();
  });

  it('tolerates circular error objects', () => {
    const error: Record<string, unknown> = { message: 'DINGTALK_PERSONAL_RATE_LIMITED' };
    error.self = error;

    expect(resolveDingtalkPersonalErrorCode(error)).toBe('DINGTALK_PERSONAL_RATE_LIMITED');
  });
});
