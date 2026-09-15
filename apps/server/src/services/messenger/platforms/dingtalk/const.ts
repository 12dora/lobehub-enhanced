/**
 * Identity email convention: AIHub user email is
 * `<dingtalkStaffId>@<DINGTALK_IDENTITY_EMAIL_DOMAIN>`.
 * Override the domain with env `DINGTALK_IDENTITY_EMAIL_DOMAIN`.
 */
export const DINGTALK_IDENTITY_EMAIL_DOMAIN = 'dingtalk.jiefakj.com';

export const resolveDingTalkIdentityEmailDomain = (): string =>
  process.env.DINGTALK_IDENTITY_EMAIL_DOMAIN?.trim() || DINGTALK_IDENTITY_EMAIL_DOMAIN;

export const DINGTALK_INSTALLATION_KEY = 'dingtalk:singleton';

export const DINGTALK_UNKNOWN_USER_REPLY = '请先使用钉钉账号登录 AIHub 网页端一次，再回来对话。';

export const DINGTALK_CHAT_DISABLED_REPLY = '对话能力已由管理员关闭。';

export const DINGTALK_TOPIC_TITLE_PREFIX = '钉钉 · ';

export const DINGTALK_IDLE_NEW_TOPIC_NOTICE = '已开始新会话';

export const DINGTALK_CARD_CALLBACK_EVENT = 'card.callback';
export const DINGTALK_ROBOT_MESSAGE_EVENT = 'im.bot.message';

export const DINGTALK_STREAM_STATUS_TTL_SECONDS = 120;
export const DINGTALK_COUNTER_TTL_SECONDS = 8 * 24 * 60 * 60;

export const buildDingTalkIdentityEmail = (staffId: string): string =>
  `${staffId}@${resolveDingTalkIdentityEmailDomain()}`;
