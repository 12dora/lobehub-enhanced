import { describe, expect, it } from 'vitest';

import {
  DINGTALK_PLATFORM_USER_ID_MAX,
  displayBindingUserLabel,
  emptyImConnectorBindingDraft,
  readImConnectorBindingConflict,
  toImConnectorBindingUpsertInput,
  validateImConnectorBindingDraft,
} from './bindings';

const draft = (overrides: Partial<ReturnType<typeof emptyImConnectorBindingDraft>> = {}) => ({
  ...emptyImConnectorBindingDraft(),
  ...overrides,
});

describe('validateImConnectorBindingDraft', () => {
  it('requires both halves of a binding', () => {
    expect(validateImConnectorBindingDraft(draft())).toEqual({
      platformUserId: 'required',
      userId: 'required',
    });
  });

  it('treats whitespace as empty, so a space cannot stand in for a userid', () => {
    expect(validateImConnectorBindingDraft(draft({ platformUserId: '   ', userId: '  ' }))).toEqual(
      { platformUserId: 'required', userId: 'required' },
    );
  });

  it('accepts a complete draft without the optional display name', () => {
    expect(
      validateImConnectorBindingDraft(draft({ platformUserId: 'ding-user', userId: 'user-1' })),
    ).toEqual({});
  });

  it('mirrors the contract bound on the DingTalk userid', () => {
    expect(
      validateImConnectorBindingDraft(
        draft({ platformUserId: 'x'.repeat(DINGTALK_PLATFORM_USER_ID_MAX + 1), userId: 'user-1' }),
      ),
    ).toEqual({ platformUserId: 'tooLong' });
  });

  it('flags a display name past the contract bound', () => {
    expect(
      validateImConnectorBindingDraft(
        draft({ platformUserId: 'ding-user', platformUsername: 'x'.repeat(201), userId: 'u' }),
      ),
    ).toEqual({ platformUsername: 'tooLong' });
  });
});

describe('toImConnectorBindingUpsertInput', () => {
  it('trims what the admin typed', () => {
    expect(
      toImConnectorBindingUpsertInput(
        'dingtalk',
        draft({ platformUserId: '  ding-user  ', platformUsername: ' 张三 ', userId: ' user-1 ' }),
      ),
    ).toEqual({
      platform: 'dingtalk',
      platformUserId: 'ding-user',
      platformUsername: '张三',
      userId: 'user-1',
    });
  });

  // Omitting it is what lets the server look the name up from the corp directory itself.
  it('omits an empty display name rather than sending it blank', () => {
    expect(
      toImConnectorBindingUpsertInput(
        'dingtalk',
        draft({ platformUserId: 'ding-user', platformUsername: '   ', userId: 'user-1' }),
      ),
    ).toEqual({ platform: 'dingtalk', platformUserId: 'ding-user', userId: 'user-1' });
  });
});

describe('readImConnectorBindingConflict', () => {
  const details = {
    boundUserEmail: 'other@example.com',
    boundUserId: 'user-2',
    boundUserName: '李四',
  };

  it('reads the other account off the formatter body', () => {
    expect(
      readImConnectorBindingConflict({
        data: { errorData: { code: 'PLATFORM_USER_ALREADY_BOUND', details } },
      }),
    ).toEqual(details);
  });

  it('reads it off a raw TRPCError cause as well', () => {
    expect(
      readImConnectorBindingConflict({
        cause: { data: { code: 'PLATFORM_USER_ALREADY_BOUND', details } },
      }),
    ).toEqual(details);
  });

  it('ignores every other failure, so the caller falls through to its generic copy', () => {
    expect(readImConnectorBindingConflict(new Error('network'))).toBeNull();
    expect(
      readImConnectorBindingConflict({ data: { errorData: { code: 'PLATFORM_NOT_FOUND' } } }),
    ).toBeNull();
  });

  // Without the other user's id there is nothing for 改绑 to unbind.
  it('ignores a conflict body that does not name the other account', () => {
    expect(
      readImConnectorBindingConflict({
        data: { errorData: { code: 'PLATFORM_USER_ALREADY_BOUND', details: {} } },
      }),
    ).toBeNull();
  });
});

describe('displayBindingUserLabel', () => {
  it('prefers the name, then the email, and never shows nothing', () => {
    expect(displayBindingUserLabel('张三', 'a@example.com', 'user-1')).toBe('张三');
    expect(displayBindingUserLabel(null, 'a@example.com', 'user-1')).toBe('a@example.com');
    expect(displayBindingUserLabel(null, null, 'user-1')).toBe('user-1');
  });
});
