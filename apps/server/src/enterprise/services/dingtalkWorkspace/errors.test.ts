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
    expect(error.missingScopes).toBeUndefined();
  });

  it('stores de-duplicated missingScopes without the apply URL or message text', () => {
    const error = new DingtalkWorkspaceError(
      'DINGTALK_FORBIDDEN',
      'Forbidden.AccessDenied.AccessTokenPermissionDenied',
      ['Calendar.Event.Write', 'Calendar.Event.Write', 'Calendar.EventSchedule.Read'],
    );
    expect(error.missingScopes).toEqual(['Calendar.Event.Write', 'Calendar.EventSchedule.Read']);
    expect(error.missingScopes?.join(',')).not.toContain('https://');
    expect(error.missingScopes?.join(',')).not.toContain('权限');
  });

  it('stores an open-dev apply URL separately from the scope codes', () => {
    const url = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    const error = new DingtalkWorkspaceError(
      'DINGTALK_FORBIDDEN',
      '60011',
      ['Calendar.Event.Write'],
      url,
    );
    expect(error.applyUrl).toBe(url);
    expect(error.missingScopes).toEqual(['Calendar.Event.Write']);
    const blocked = new DingtalkWorkspaceError(
      'DINGTALK_FORBIDDEN',
      '60011',
      ['Calendar.Event.Write'],
      'https://evil.example/apply',
    );
    expect(blocked.applyUrl).toBeUndefined();
  });

  it('omits empty missingScopes', () => {
    const error = new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', '60011', []);
    expect(error.missingScopes).toBeUndefined();
  });

  it('recognizes contracted codes only', () => {
    expect(isDingtalkWorkspaceErrorCode('DINGTALK_NOT_CONFIGURED')).toBe(true);
    expect(isDingtalkWorkspaceErrorCode('DINGTALK_AMBIGUOUS')).toBe(true);
    expect(isDingtalkWorkspaceErrorCode('not-a-code')).toBe(false);
    expect(DINGTALK_WORKSPACE_ERROR_CODES).toContain('DINGTALK_PREMIUM_REQUIRED');
  });
});
