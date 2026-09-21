// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DINGTALK_WORKSPACE_ERROR_CODES,
  DingtalkWorkspaceError,
  isDingtalkWorkspaceErrorCode,
} from './errors';

describe('DingtalkWorkspaceError', () => {
  it('stores the stable code and optional upstream code', () => {
    const error = new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', '60011');
    expect(error.code).toBe('DINGTALK_FORBIDDEN');
    expect(error.upstreamCode).toBe('60011');
    expect(error.message).toBe('DINGTALK_FORBIDDEN');
    expect(error.name).toBe('DingtalkWorkspaceError');
  });

  it('recognizes contracted codes only', () => {
    expect(isDingtalkWorkspaceErrorCode('DINGTALK_NOT_CONFIGURED')).toBe(true);
    expect(isDingtalkWorkspaceErrorCode('DINGTALK_AMBIGUOUS')).toBe(true);
    expect(isDingtalkWorkspaceErrorCode('not-a-code')).toBe(false);
    expect(DINGTALK_WORKSPACE_ERROR_CODES).toContain('DINGTALK_PREMIUM_REQUIRED');
  });
});
