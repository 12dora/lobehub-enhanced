import { describe, expect, it } from 'vitest';

import {
  buildDingtalkMarkdown,
  DINGTALK_CONTENT_MAX_CHARS,
  dingtalkPushTitle,
  formatShanghaiTimestamp,
  INBOX_CONTENT_MAX_CHARS,
  sanitizeNotificationContent,
  stripMarkdownToPlainLines,
  TASK_NOTIFICATION_ZH_LABELS,
  taskCompletedNotifyBody,
} from './content';

describe('sanitizeNotificationContent', () => {
  it('strips markdown images and keeps surrounding text / line breaks', () => {
    const raw = 'Hello\n\n![chart](https://example.com/a.png)\n\nWorld';
    expect(sanitizeNotificationContent(raw)).toBe('Hello\n\nWorld');
  });

  it('strips HTML tags including img', () => {
    const raw = 'Hi <b>there</b><img src="x.png" alt="x">!';
    expect(sanitizeNotificationContent(raw)).toBe('Hi there!');
  });

  it('truncates to the inbox cap', () => {
    const raw = 'a'.repeat(INBOX_CONTENT_MAX_CHARS + 50);
    expect(sanitizeNotificationContent(raw)).toHaveLength(INBOX_CONTENT_MAX_CHARS);
  });

  it('truncates to a custom cap', () => {
    expect(sanitizeNotificationContent('abcdefghij', 4)).toBe('abcd');
  });

  it('returns empty string for blank input', () => {
    expect(sanitizeNotificationContent(undefined)).toBe('');
    expect(sanitizeNotificationContent('   ')).toBe('');
  });
});

describe('stripMarkdownToPlainLines', () => {
  it('turns headings, emphasis, and links into plain lines', () => {
    expect(
      stripMarkdownToPlainLines('## 已完成\n\n**催交**已发给[邵军军](https://example.com)。'),
    ).toBe('已完成\n\n催交已发给邵军军。');
  });

  it('drops fenced code markers and keeps the body', () => {
    expect(stripMarkdownToPlainLines('```text\nline one\n```')).toBe('line one');
  });

  it('drops a same-line fence and keeps a closer that follows the info-line newline', () => {
    expect(stripMarkdownToPlainLines('before ```hidden``` after')).toBe('before  after');
    expect(stripMarkdownToPlainLines('```abc```\nkept\n```')).toBe('kept');
    expect(stripMarkdownToPlainLines('```a`b\nline\n```')).toBe('line');
    expect(stripMarkdownToPlainLines('See\n```js\nconst a = 1\n```\nDone')).toBe(
      'See\nconst a = 1\n\nDone',
    );
    expect(stripMarkdownToPlainLines('```\nprice $1\n```')).toBe('price $1');
  });

  it('leaves an unclosed fence in place', () => {
    const unclosed = `\`\`\`${'a'.repeat(2000)}`;
    expect(stripMarkdownToPlainLines('```not closed')).toBe('```not closed');
    expect(stripMarkdownToPlainLines(unclosed)).toBe(unclosed);
    expect(stripMarkdownToPlainLines('````')).toBe('````');
  });
});

describe('taskCompletedNotifyBody', () => {
  it('prefers the assistant message over the title', () => {
    expect(
      taskCompletedNotifyBody({
        fallbackTitle: '催交邵军军',
        lastAssistant: '已发给邵军军',
      }),
    ).toBe('已发给邵军军');
  });

  it('falls back to the title when the assistant message is empty', () => {
    expect(taskCompletedNotifyBody({ fallbackTitle: '催交邵军军', lastAssistant: '  ' })).toBe(
      '催交邵军军',
    );
  });
});

describe('buildDingtalkMarkdown', () => {
  it('wraps truncated content with the task name and Shanghai timestamp', () => {
    const now = new Date('2026-09-15T08:05:00.000Z'); // 16:05 Asia/Shanghai (UTC+8)
    const markdown = buildDingtalkMarkdown('Daily digest', 'body text', now);
    expect(markdown).toBe('**Daily digest**\n\nbody text\n\n2026-09-15 16:05');
  });

  it('strips markdown punctuation from the task name so it cannot break the title', () => {
    const now = new Date('2026-09-15T08:05:00.000Z');
    const markdown = buildDingtalkMarkdown('**Daily**\n\n# digest', 'body', now);
    expect(markdown.startsWith('**Daily digest**\n\n')).toBe(true);
  });

  it('caps the inner content at 1500 chars', () => {
    const now = new Date('2026-09-15T00:00:00.000Z');
    const markdown = buildDingtalkMarkdown('T', 'x'.repeat(DINGTALK_CONTENT_MAX_CHARS + 10), now);
    const body = markdown.split('\n\n')[1];
    expect(body).toHaveLength(DINGTALK_CONTENT_MAX_CHARS);
  });
});

describe('dingtalkPushTitle', () => {
  it('uses the zh label for each type', () => {
    expect(dingtalkPushTitle('task_run_completed', '报表')).toBe(
      `${TASK_NOTIFICATION_ZH_LABELS.task_run_completed} · 报表`,
    );
    expect(dingtalkPushTitle('task_run_failed', '报表')).toBe('任务运行失败 · 报表');
    expect(dingtalkPushTitle('task_waiting_for_user', '报表')).toBe('任务等待处理 · 报表');
    expect(dingtalkPushTitle('task_completed', '报表')).toBe('任务已完成 · 报表');
  });

  it('strips markdown from the task name', () => {
    expect(dingtalkPushTitle('task_run_failed', '**报表**')).toBe('任务运行失败 · 报表');
  });
});

describe('formatShanghaiTimestamp', () => {
  it('formats YYYY-MM-DD HH:mm in Asia/Shanghai', () => {
    expect(formatShanghaiTimestamp(new Date('2026-01-01T16:00:00.000Z'))).toBe('2026-01-02 00:00');
  });
});
