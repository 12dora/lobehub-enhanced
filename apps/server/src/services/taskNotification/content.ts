import type { TaskNotificationType } from '@lobechat/types';

/** Inbox body cap. */
export const INBOX_CONTENT_MAX_CHARS = 2000;
/** DingTalk markdown body cap (the inner content, not the wrapper). */
export const DINGTALK_CONTENT_MAX_CHARS = 1500;

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

export const buildDingtalkMarkdown = (taskName: string, content: string, now: Date): string => {
  const body = sanitizeNotificationContent(content, DINGTALK_CONTENT_MAX_CHARS);
  const stamp = formatShanghaiTimestamp(now);
  return `**${taskName}**\n\n${body}\n\n${stamp}`;
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

export const dingtalkPushTitle = (type: TaskNotificationType, taskName: string): string =>
  `${TASK_NOTIFICATION_ZH_LABELS[type]} · ${taskName}`;
