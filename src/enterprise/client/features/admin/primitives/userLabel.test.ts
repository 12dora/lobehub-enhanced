import { describe, expect, it } from 'vitest';

import { displayUserLabel, displayUserSecondary } from './userLabel';

describe('displayUserLabel', () => {
  it('prefers fullName, then username, email, then id', () => {
    expect(
      displayUserLabel({
        email: 'a@ex.com',
        fullName: 'Break-glass Super Admin',
        id: 'breakglass_mthda3xs',
        username: 'breakglass',
      }),
    ).toBe('Break-glass Super Admin');
    expect(
      displayUserLabel({ email: 'a@ex.com', fullName: null, id: 'u1', username: 'ada' }),
    ).toBe('ada');
    expect(
      displayUserLabel({ email: 'a@ex.com', fullName: '  ', id: 'u1', username: null }),
    ).toBe('a@ex.com');
    expect(displayUserLabel({ email: null, fullName: null, id: 'u1', username: null })).toBe('u1');
  });
});

describe('displayUserSecondary', () => {
  it('returns email when the primary is the display name', () => {
    expect(
      displayUserSecondary({
        email: 'ada@ex.com',
        fullName: 'Ada Lovelace',
        id: 'u1',
        username: 'ada',
      }),
    ).toBe('ada@ex.com');
  });

  it('skips the field that already is the primary', () => {
    expect(
      displayUserSecondary({ email: 'ada@ex.com', fullName: null, id: 'u1', username: 'ada' }),
    ).toBe('ada@ex.com');
    expect(
      displayUserSecondary({ email: 'ada@ex.com', fullName: null, id: 'u1', username: null }),
    ).toBeUndefined();
  });
});
