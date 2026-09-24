import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://chat.example.com' },
}));

const {
  DINGTALK_BRANDING_FALLBACK,
  DINGTALK_CHAT_DISABLED_REPLY,
  DINGTALK_UNKNOWN_USER_REPLY,
  formatDingTalkChatDisabledReply,
  formatDingTalkUnknownUserReply,
  isValidDingTalkStaffId,
} = await import('./const');

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
      '请先使用钉钉账号登录 AI平台（[用钉钉登录](https://chat.example.com/dingtalk/sso?redirect=%2F)），再回来对话。',
    );
    expect(formatDingTalkUnknownUserReply('AI平台')).not.toMatch(/\]\(<http/);
    expect(DINGTALK_UNKNOWN_USER_REPLY).toBe(
      formatDingTalkUnknownUserReply(DINGTALK_BRANDING_FALLBACK),
    );
    expect(DINGTALK_UNKNOWN_USER_REPLY).toContain(DINGTALK_BRANDING_FALLBACK);
    expect(DINGTALK_UNKNOWN_USER_REPLY).not.toContain('AIHub');
  });

  it('tells a locked-out chat to ask an admin, with the connector link', () => {
    const admin =
      'https://chat.example.com/dingtalk/sso?redirect=' +
      encodeURIComponent('/admin/system/general?tab=im-connectors');
    expect(formatDingTalkChatDisabledReply()).toBe(
      `对话能力已由管理员关闭。请联系管理员开启（管理员入口：[IM 连接器设置](${admin})）。`,
    );
    expect(DINGTALK_CHAT_DISABLED_REPLY).toBe(formatDingTalkChatDisabledReply());
  });
});
