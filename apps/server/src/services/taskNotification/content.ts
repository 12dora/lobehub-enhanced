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
 * One ``` fence, same spans as `/```[^\n]*\n?([\s\S]*?)```/`.
 * A closer after the info-line newline wins; otherwise the rightmost ``` on
 * that line closes it and the body is empty. Null means no closer remains.
 */
const takeCodeFence = (raw: string, open: number): { capture: string; next: number } | null => {
  const after = open + 3;
  const newline = raw.indexOf('\n', after);
  const lineEnd = newline === -1 ? raw.length : newline;
  if (newline !== -1) {
    const close = raw.indexOf('```', newline + 1);
    if (close !== -1) return { capture: raw.slice(newline + 1, close), next: close + 3 };
  }
  const rel = raw.slice(after, lineEnd).lastIndexOf('```');
  if (rel === -1) return null;
  return { capture: '', next: after + rel + 3 };
};

/**
 * Same replacements as the old fence regex, without its super-linear backtracking.
 * The info string is dropped. The body (group 1) is kept.
 */
const stripCodeFences = (raw: string): string => {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const open = raw.indexOf('```', cursor);
    if (open === -1) {
      parts.push(raw.slice(cursor));
      break;
    }
    const matched = takeCodeFence(raw, open);
    if (!matched) {
      parts.push(raw.slice(cursor));
      break;
    }
    parts.push(raw.slice(cursor, open), matched.capture);
    cursor = matched.next;
  }
  return parts.join('');
};

/**
 * Turn markdown into DingTalk-friendly plain lines: drop fences, headings,
 * emphasis, and link targets, and keep the readable text and line breaks.
 * Images and HTML are removed afterwards by `sanitizeNotificationContent`.
 */
export const stripMarkdownToPlainLines = (raw: string): string => {
  let text = raw.replaceAll('\r\n', '\n');
  text = stripCodeFences(text);
  text = text.replaceAll(/`([^`\n]+)`/g, '$1');
  text = text.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replaceAll(/^#{1,6}\s+/gm, '');
  text = text.replaceAll(/(\*\*|__)([\s\S]*?)\1/g, '$2');
  text = text.replaceAll(/(^|\s)[*_]([^*\n_]+)[*_](?=\s|$)/g, '$1$2');
  text = text.replaceAll(/^\s*>\s?/gm, '');
  text = text.replaceAll(/^\s*[-*+]\s+/gm, '');
  text = text.replaceAll(/^\s*\d+\.\s+/gm, '');
  text = text.replaceAll(/[ \t]+\n/g, '\n');
  text = text.replaceAll(/\n{3,}/g, '\n\n');
  return text.trim();
};

/**
 * Body for a `task_completed` push: the run's last assistant message when we
 * have one, otherwise the task title. Never the raw instruction.
 */
export const taskCompletedNotifyBody = (input: {
  fallbackTitle?: string | null;
  lastAssistant?: string | null;
}): string => {
  const plain = stripMarkdownToPlainLines(input.lastAssistant ?? '');
  if (plain) return plain;
  return (input.fallbackTitle ?? '').trim();
};

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
