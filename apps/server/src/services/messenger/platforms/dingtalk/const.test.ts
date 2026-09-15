import { describe, expect, it } from 'vitest';

import {
  DINGTALK_BRANDING_FALLBACK,
  DINGTALK_UNKNOWN_USER_REPLY,
  formatDingTalkUnknownUserReply,
  isValidDingTalkStaffId,
} from './const';

describe('isValidDingTalkStaffId', () => {
  it('accepts DingTalk userid charset up to 64 characters', () => {
    expect(isValidDingTalkStaffId('staff_1')).toBe(true);
    expect(isValidDingTalkStaffId('Staff.Id-9')).toBe(true);
    expect(isValidDingTalkStaffId('a'.repeat(64))).toBe(true);
  });

  it('rejects empty, oversize, or non-canonical local-parts', () => {
    expect(isValidDingTalkStaffId('')).toBe(false);
    expect(isValidDingTalkStaffId('a@b')).toBe(false);
    expect(isValidDingTalkStaffId('has space')).toBe(false);
    expect(isValidDingTalkStaffId('a'.repeat(65))).toBe(false);
  });
});

describe('formatDingTalkUnknownUserReply', () => {
  it('uses the branding display name and never hardcodes AIHub', () => {
    expect(formatDingTalkUnknownUserReply('AI平台')).toBe(
      '请先使用钉钉账号登录 AI平台 网页端一次，再回来对话。',
    );
    expect(DINGTALK_UNKNOWN_USER_REPLY).toBe(
      formatDingTalkUnknownUserReply(DINGTALK_BRANDING_FALLBACK),
    );
    expect(DINGTALK_UNKNOWN_USER_REPLY).toContain(DINGTALK_BRANDING_FALLBACK);
    expect(DINGTALK_UNKNOWN_USER_REPLY).not.toContain('AIHub');
  });
});
