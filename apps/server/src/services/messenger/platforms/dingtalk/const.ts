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

export const DINGTALK_ASKER_ONLY_REPLY = '仅提问人可操作';
export const DINGTALK_QUEUE_JOINED_REPLY = '已加入队列';
export const DINGTALK_QUEUE_FULL_REPLY = '队列已满，请稍后再试';
export const DINGTALK_QUEUE_UNAVAILABLE_REPLY = '暂时无法排队，请稍后再试';
export const DINGTALK_STOP_NONE_REPLY = '没有正在执行的任务';
export const DINGTALK_STOP_REQUESTED_REPLY = '已请求停止';
export const DINGTALK_STOP_FAILED_REPLY = '无法停止当前执行';
export const DINGTALK_AGENTS_PICKER_PROMPT = '点选要切换的助手';
export const DINGTALK_UNLINKED_COMMAND_REPLY = DINGTALK_UNKNOWN_USER_REPLY;
export const DINGTALK_THINKING_REPLY = '正在思考…';
export const DINGTALK_UNSUPPORTED_MEDIA_REPLY = '暂不支持语音和视频消息';
export const DINGTALK_QUESTION_GONE_REPLY = '该问题已失效，将作为新消息处理。';
export const DINGTALK_UNKNOWN_COMMAND_REPLY = '未知命令。发送 /帮助 查看可用命令。';
export const DINGTALK_NO_TOPICS_REPLY = '暂无会话记录。';
export const DINGTALK_RESUME_USAGE_REPLY = '用法：/继续 N';
export const DINGTALK_RESUME_RANGE_REPLY = '序号超出范围。发送 /会话 查看最近会话。';
export const DINGTALK_RESUMED_REPLY = '已切换到该会话。';
export const DINGTALK_NO_ACTIVE_AGENT_REPLY = '未选择助手。发送 /助手 选择一个。';
export const DINGTALK_MARKDOWN_TITLE_FALLBACK = '回复';

export const formatDingTalkAgentSwitched = (title: string): string => `已切换到：${title}`;

export const formatDingTalkCurrentAgent = (title: string): string => `当前助手：${title}`;

export const formatDingTalkScopeSwitched = (scopeName: string, agentTitle?: string): string =>
  agentTitle ? `已切换到：${scopeName}，当前助手：${agentTitle}` : `已切换到：${scopeName}`;

export const formatDingTalkCurrentScope = (scopeName: string): string => `当前范围：${scopeName}`;

export const DINGTALK_AGENT_NOT_FOUND_REPLY = '未找到该助手';
export const DINGTALK_UNKNOWN_ACTION_REPLY = '未知操作';
export const DINGTALK_SCOPE_NOT_FOUND_REPLY = '未找到该范围';
export const DINGTALK_SCOPE_PICKER_PROMPT = '点选要切换的范围';
export const DINGTALK_PERSONAL_SCOPE_LABEL = '个人';

export const DINGTALK_HELP_TEXT = [
  '命令：',
  '• /助手 — 查看或切换助手',
  '• /会话 — 最近 5 个会话',
  '• /继续 N — 继续第 N 个会话',
  '• /新会话 — 开始新会话',
  '• /当前 — 查看当前状态',
  '• /停止 — 停止当前执行',
  '• /帮助 — 查看帮助',
].join('\n');

export const DINGTALK_QUEUE_KEY_PREFIX = 'messenger:dingtalk:queue:';
export const DINGTALK_QUEUE_TTL_SECONDS = 60 * 60;
export const DINGTALK_QUEUE_MAX_LENGTH = 5;
export const DINGTALK_BUSY_KEY_PREFIX = 'messenger:dingtalk:busy:';
export const DINGTALK_BUSY_TTL_SECONDS = DINGTALK_QUEUE_TTL_SECONDS;
export const DINGTALK_PENDING_QUESTION_KEY_PREFIX = 'messenger:dingtalk:pending-question:';
export const DINGTALK_PENDING_QUESTION_TTL_SECONDS = 24 * 60 * 60;
export const DINGTALK_LIST_PAGE_SIZE = 5;

export const DINGTALK_STREAM_STATUS_TTL_SECONDS = 120;
export const DINGTALK_COUNTER_TTL_SECONDS = 8 * 24 * 60 * 60;

export const buildDingTalkIdentityEmail = (staffId: string): string =>
  `${staffId}@${resolveDingTalkIdentityEmailDomain()}`;
