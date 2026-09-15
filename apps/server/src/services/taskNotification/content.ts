import type { TaskNotificationType } from '@lobechat/types';

/** Inbox body cap. */
export const INBOX_CONTENT_MAX_CHARS = 2000;
/** DingTalk markdown body cap (the inner content, not the wrapper). */
export const DINGTALK_CONTENT_MAX_CHARS = 1500;

/** User-facing body for heartbeat-timeout failures (inbox + DingTalk). */
export const TASK_NOTIFY_HEARTBEAT_TIMEOUT_ZH = '心跳超时';
/** User-facing body when the producer has no error text. */
export const TASK_NOTIFY_UNKNOWN_ERROR_ZH = '未知错误';

const TASK_NOTIFY_CONTENT_ZH: Record<string, string> = {
  'Heartbeat timeout': TASK_NOTIFY_HEARTBEAT_TIMEOUT_ZH,
  'Unknown error': TASK_NOTIFY_UNKNOWN_ERROR_ZH,
};

/** Map known English error tokens to zh-CN bodies. Unknown strings pass through. */
export const localizeTaskNotifyContent = (raw: string): string =>
  TASK_NOTIFY_CONTENT_ZH[raw] ?? raw;

const HEARTBEAT_TIMEOUT_TOKENS = new Set(['Heartbeat timeout', TASK_NOTIFY_HEARTBEAT_TIMEOUT_ZH]);

export const isHeartbeatTimeoutContent = (raw: string | undefined): boolean =>
  Boolean(raw && HEARTBEAT_TIMEOUT_TOKENS.has(raw));

/**
 * Zh labels used only inside the DingTalk push title.
 * The web inbox localises by `notifications.type`.
 */
export const TASK_NOTIFICATION_ZH_LABELS = {
  task_completed: '任务已完成',
  task_run_completed: '任务已完成一次运行',
  task_run_failed: '任务运行失败',
  task_waiting_for_user: '任务等待处理',
} as const satisfies Record<TaskNotificationType, string>;

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const MARKDOWN_REF_IMAGE_RE = /!\[[^\]]*\]\[[^\]]*\]/g;
const HTML_TAG_RE = /<[^>]+>/g;

const truncate = (text: string, maxChars: number): string =>
  text.length > maxChars ? text.slice(0, maxChars) : text;

/**
 * Plain-text notification body: strip markdown images and HTML tags, keep
 * line breaks, then truncate.
 */
export const sanitizeNotificationContent = (
  raw: string | undefined,
  maxChars: number = INBOX_CONTENT_MAX_CHARS,
): string => {
  const stripped = (raw ?? '')
    .replaceAll(MARKDOWN_IMAGE_RE, '')
    .replaceAll(MARKDOWN_REF_IMAGE_RE, '')
    .replaceAll(HTML_TAG_RE, '')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

  return truncate(stripped, maxChars);
};

/**
 * Strip markdown punctuation / blank lines from a task name so it cannot
 * break the DingTalk card title (`**name**` wrapper or `label · name`).
 */
export const sanitizeTaskNameForMarkdown = (name: string): string =>
  name
    .replaceAll(/[*_`~#[\]\\]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

export const buildDingtalkMarkdown = (taskName: string, content: string, now: Date): string => {
  const body = sanitizeNotificationContent(content, DINGTALK_CONTENT_MAX_CHARS);
  const stamp = formatShanghaiTimestamp(now);
  const safeName = sanitizeTaskNameForMarkdown(taskName) || taskName;
  return `**${safeName}**\n\n${body}\n\n${stamp}`;
};

export const formatShanghaiTimestamp = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
};

export const dingtalkPushTitle = (type: TaskNotificationType, taskName: string): string => {
  const safeName = sanitizeTaskNameForMarkdown(taskName) || taskName;
  return `${TASK_NOTIFICATION_ZH_LABELS[type]} · ${safeName}`;
};
