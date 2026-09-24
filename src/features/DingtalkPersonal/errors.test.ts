import { describe, expect, it } from 'vitest';

import {
  resolveDingtalkPersonalErrorCode,
  resolveDingtalkPersonalLinkKind,
  resolveIdentityRequiredKey,
  resolveIdentityRequiredLink,
  resolveLoginFailure,
  resolveRevokeErrorKey,
  resolveStartErrorKey,
} from './errors';

describe('resolveDingtalkPersonalErrorCode', () => {
  it('reads the code the router puts in the TRPC message', () => {
    expect(
      resolveDingtalkPersonalErrorCode(new Error('DINGTALK_PERSONAL_BROKER_UNAVAILABLE')),
    ).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
    expect(resolveDingtalkPersonalErrorCode('DINGTALK_IDENTITY_UNBOUND')).toBe(
      'DINGTALK_IDENTITY_UNBOUND',
    );
  });

  it('finds the code in the serialized error when the message is generic', () => {
    const error = { data: { cause: { code: 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND' } }, message: '' };
    expect(resolveDingtalkPersonalErrorCode(error)).toBe('DINGTALK_PERSONAL_LOGIN_NOT_FOUND');
  });

  it('returns undefined for errors without a DingTalk code', () => {
    expect(resolveDingtalkPersonalErrorCode(undefined)).toBeUndefined();
    expect(resolveDingtalkPersonalErrorCode(new Error('fetch failed'))).toBeUndefined();

    const circular: Record<string, unknown> = { message: 'boom' };
    circular.self = circular;
    expect(resolveDingtalkPersonalErrorCode(circular)).toBeUndefined();
  });
});

describe('resolveIdentityRequiredKey', () => {
  it('has a message per identity code and reads anything else as not bound', () => {
    expect(resolveIdentityRequiredKey('DINGTALK_IDENTITY_INACTIVE')).toBe(
      'dingtalkPersonal.identity.DINGTALK_IDENTITY_INACTIVE',
    );
    expect(resolveIdentityRequiredKey('DINGTALK_PERSONAL_CORP_ID_MISSING')).toBe(
      'dingtalkPersonal.identity.DINGTALK_PERSONAL_CORP_ID_MISSING',
    );
    expect(resolveIdentityRequiredKey('SOMETHING_NEW')).toBe(
      'dingtalkPersonal.identity.DINGTALK_IDENTITY_UNBOUND',
    );
    expect(resolveIdentityRequiredKey(undefined)).toBe(
      'dingtalkPersonal.identity.DINGTALK_IDENTITY_UNBOUND',
    );
  });
});

describe('resolveIdentityRequiredLink', () => {
  it('sends a missing binding to the binding page and a missing CorpId to the admin', () => {
    expect(resolveIdentityRequiredLink('DINGTALK_IDENTITY_UNBOUND')).toBe('binding');
    expect(resolveIdentityRequiredLink('DINGTALK_IDENTITY_UNVERIFIED')).toBe('binding');
    expect(resolveIdentityRequiredLink('SOMETHING_NEW')).toBe('binding');
    expect(resolveIdentityRequiredLink(undefined)).toBe('binding');
    expect(resolveIdentityRequiredLink('DINGTALK_PERSONAL_CORP_ID_MISSING')).toBe(
      'adminImConnectors',
    );
  });

  it('offers nothing for a deactivated identity', () => {
    expect(resolveIdentityRequiredLink('DINGTALK_IDENTITY_INACTIVE')).toBeUndefined();
  });
});

describe('resolveDingtalkPersonalLinkKind', () => {
  it.each([
    ['DINGTALK_PERSONAL_DISABLED', 'adminImConnectors'],
    ['DINGTALK_PERSONAL_FEATURE_DISABLED', 'adminImConnectors'],
    ['DINGTALK_IDENTITY_UNBOUND', 'binding'],
    ['DINGTALK_PERSONAL_ORG_POLICY_DENIED', 'cliSettings'],
    // Authorizing again is the card's own button, never a link on the card.
    ['DINGTALK_PERSONAL_EXPIRED', undefined],
    ['DINGTALK_PERSONAL_RATE_LIMITED', undefined],
    [undefined, undefined],
  ])('maps %s to %s', (code, kind) => {
    expect(resolveDingtalkPersonalLinkKind(code)).toBe(kind);
  });
});

describe('resolveStartErrorKey', () => {
  it.each([
    ['DINGTALK_IDENTITY_UNVERIFIED', 'dingtalkPersonal.identity.DINGTALK_IDENTITY_UNVERIFIED'],
    ['DINGTALK_PERSONAL_DISABLED', 'dingtalkPersonal.start.error.disabled'],
    ['DINGTALK_PERSONAL_RATE_LIMITED', 'dingtalkPersonal.start.error.rateLimited'],
    ['DINGTALK_PERSONAL_BROKER_UNAVAILABLE', 'dingtalkPersonal.start.error.unavailable'],
    ['DINGTALK_PERSONAL_TIMEOUT', 'dingtalkPersonal.start.error.unavailable'],
    ['DINGTALK_PERSONAL_UPSTREAM', 'dingtalkPersonal.start.error.failed'],
    [undefined, 'dingtalkPersonal.start.error.failed'],
  ])('maps %s to %s', (code, key) => {
    expect(resolveStartErrorKey(code)).toBe(key);
  });
});

describe('resolveRevokeErrorKey', () => {
  it.each([
    ['DINGTALK_PERSONAL_REVOKE_FAILED', 'dingtalkPersonal.revoke.error.retryLater'],
    ['DINGTALK_PERSONAL_BROKER_UNAVAILABLE', 'dingtalkPersonal.revoke.error.retryLater'],
    ['DINGTALK_PERSONAL_TIMEOUT', 'dingtalkPersonal.revoke.error.retryLater'],
    ['DINGTALK_PERSONAL_INTERNAL', 'dingtalkPersonal.revoke.failed'],
    [undefined, 'dingtalkPersonal.revoke.failed'],
  ])('maps %s to %s', (code, key) => {
    expect(resolveRevokeErrorKey(code)).toBe(key);
  });
});

describe('resolveLoginFailure', () => {
  it('says nothing while the job is pending or once it succeeded', () => {
    expect(resolveLoginFailure({ status: 'pending' })).toBeUndefined();
    expect(resolveLoginFailure({ status: 'succeeded' })).toBeUndefined();
  });

  it('names who actually authorized on an identity mismatch', () => {
    expect(
      resolveLoginFailure({
        errorCode: 'IDENTITY_MISMATCH',
        mismatchUserName: '李四',
        status: 'failed',
      }),
    ).toEqual({ key: 'dingtalkPersonal.login.error.identityMismatch', values: { name: '李四' } });
    expect(resolveLoginFailure({ errorCode: 'IDENTITY_MISMATCH', status: 'failed' })).toEqual({
      key: 'dingtalkPersonal.login.error.identityMismatchUnknown',
    });
  });

  it('tells the member the organization has not enabled CLI access, and where that is', () => {
    expect(resolveLoginFailure({ errorCode: 'ORG_CLI_DISABLED', status: 'failed' })).toEqual({
      key: 'dingtalkPersonal.login.error.orgCliDisabled',
      link: 'cliSettings',
    });
  });

  it('reads an expired code and a timed-out login the same way', () => {
    expect(resolveLoginFailure({ status: 'expired' })).toEqual({
      key: 'dingtalkPersonal.login.error.expired',
    });
    expect(resolveLoginFailure({ errorCode: 'LOGIN_TIMEOUT', status: 'failed' })).toEqual({
      key: 'dingtalkPersonal.login.error.expired',
    });
  });

  it('falls back to a generic failure, and says so when the job was cancelled', () => {
    expect(resolveLoginFailure({ status: 'cancelled' })).toEqual({
      key: 'dingtalkPersonal.login.error.cancelled',
    });
    expect(resolveLoginFailure({ errorCode: 'LOGIN_FAILED', status: 'failed' })).toEqual({
      key: 'dingtalkPersonal.login.error.failed',
    });
  });
});
