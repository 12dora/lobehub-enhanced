import { describe, expect, it } from 'vitest';

import { isDingTalkIdentityMissing, resolveDingTalkIdentityMissingCode } from './identityError';

describe('resolveDingTalkIdentityMissingCode', () => {
  it('recovers the code from a TRPC error message', () => {
    expect(resolveDingTalkIdentityMissingCode(new Error('DINGTALK_IDENTITY_UNBOUND'))).toBe(
      'DINGTALK_IDENTITY_UNBOUND',
    );
    expect(
      resolveDingTalkIdentityMissingCode(new Error('FORBIDDEN: DINGTALK_IDENTITY_UNVERIFIED')),
    ).toBe('DINGTALK_IDENTITY_UNVERIFIED');
  });

  it('reads the code out of a serialized error payload', () => {
    expect(
      resolveDingTalkIdentityMissingCode({
        data: { code: 'FORBIDDEN' },
        shape: { message: 'DINGTALK_IDENTITY_UNBOUND' },
      }),
    ).toBe('DINGTALK_IDENTITY_UNBOUND');
  });

  it('accepts a bare string, as a thrown code sometimes is', () => {
    expect(resolveDingTalkIdentityMissingCode('DINGTALK_IDENTITY_UNVERIFIED')).toBe(
      'DINGTALK_IDENTITY_UNVERIFIED',
    );
  });

  it('survives an error that cannot be serialized', () => {
    const circular: Record<string, unknown> = { message: 'DINGTALK_IDENTITY_UNBOUND' };
    circular.self = circular;

    expect(resolveDingTalkIdentityMissingCode(circular)).toBe('DINGTALK_IDENTITY_UNBOUND');
  });

  it('leaves every other failure to the ordinary error state', () => {
    expect(resolveDingTalkIdentityMissingCode(undefined)).toBeUndefined();
    expect(resolveDingTalkIdentityMissingCode(new Error('boom'))).toBeUndefined();
    expect(resolveDingTalkIdentityMissingCode(new Error('DINGTALK_UNAVAILABLE'))).toBeUndefined();
    // A bound identity that was switched off is something to act on, not an empty state.
    expect(
      resolveDingTalkIdentityMissingCode(new Error('DINGTALK_IDENTITY_INACTIVE')),
    ).toBeUndefined();
  });
});

describe('isDingTalkIdentityMissing', () => {
  it('answers the question the table asks', () => {
    expect(isDingTalkIdentityMissing(new Error('DINGTALK_IDENTITY_UNBOUND'))).toBe(true);
    expect(isDingTalkIdentityMissing(new Error('boom'))).toBe(false);
  });
});
