import { describe, expect, it } from 'vitest';

import {
  formatAuthorizationTime,
  formatCountdown,
  listEnabledFeatures,
  resolveVerificationUrl,
} from './format';

describe('resolveVerificationUrl', () => {
  it('keeps DingTalk’s own https device-login page', () => {
    const url = 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=ABCD-EFGH';
    expect(resolveVerificationUrl(url)).toBe(url);
    expect(resolveVerificationUrl('https://dingtalk.com/verify')).toBe(
      'https://dingtalk.com/verify',
    );
  });

  it('refuses another host, http, look-alike hosts and control characters', () => {
    for (const value of [
      undefined,
      '',
      'http://login.dingtalk.com/oauth2/device/verify.htm',
      'https://evil.example.com/verify',
      'https://dingtalk.com.evil.example/verify',
      'https://evildingtalk.com/verify',
      'https://login.dingtalk.com@evil.example/verify',
      'https://login.dingtalk.com/\n',
      'https://login.dingtalk.com/\nverify',
      '/settings/connector',
      'javascript:alert(1)',
    ])
      expect(resolveVerificationUrl(value)).toBeUndefined();
  });
});

describe('formatCountdown', () => {
  it('prints minutes and seconds, rounding a partial second up', () => {
    expect(formatCountdown(900_000)).toBe('15:00');
    expect(formatCountdown(61_001)).toBe('01:02');
    expect(formatCountdown(999)).toBe('00:01');
  });

  it('never goes below zero', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5000)).toBe('00:00');
  });
});

describe('formatAuthorizationTime', () => {
  it('formats a parsable timestamp and drops a missing or broken one', () => {
    expect(formatAuthorizationTime('2026-09-24T08:30:00')).toBe('2026-09-24 08:30');
    expect(formatAuthorizationTime(undefined)).toBeNull();
    expect(formatAuthorizationTime('not a date')).toBeNull();
  });
});

describe('listEnabledFeatures', () => {
  it('keeps the card order and only what is explicitly on', () => {
    expect(listEnabledFeatures({ chat: true, report: false, todo: true, write: true })).toEqual([
      'todo',
      'chat',
      'write',
    ]);
    expect(listEnabledFeatures(undefined)).toEqual([]);
  });

  it('lists documents and sheets after the personal reads and before the write permission', () => {
    expect(
      listEnabledFeatures({
        chat: false,
        docs: true,
        report: true,
        sheets: true,
        todo: false,
        write: true,
      }),
    ).toEqual(['report', 'docs', 'sheets', 'write']);
    expect(listEnabledFeatures({ docs: false, sheets: true })).toEqual(['sheets']);
  });
});
