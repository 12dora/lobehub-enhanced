/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { DingtalkPersonalRenders } from './index';
import ResultRender from './ResultRender';

const dict = zhPlugin as Record<string, string>;
const P = 'builtins.lobe-dingtalk-personal';

const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const zh = (key: string, options?: Record<string, unknown>) => translate(`${P}.${key}`, options);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: translate }),
}));

vi.mock('@/features/DingtalkPersonal/AuthorizeCard', () => ({
  AuthorizeCard: ({ compact }: { compact?: boolean }) => (
    <div data-compact={String(!!compact)} data-testid="authorize-card" />
  ),
}));

// The shared link renderer comes from the workspace client entry; keep its own
// service and styles out of this test.
vi.mock('@/services/dingtalkWorkspace', () => ({ dingtalkWorkspaceService: {} }));

vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector' },
  shinyTextStyles: { shinyText: 'shiny' },
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ title }: { title?: ReactNode }) => <div role="alert">{title}</div>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

afterEach(() => cleanup());

const props = (
  apiName: string,
  pluginState?: unknown,
  pluginError?: unknown,
): BuiltinRenderProps<Record<string, unknown>, any> => ({
  apiName,
  args: {},
  content: '',
  messageId: 'msg_1',
  pluginError,
  pluginState,
});

const HOUR = 60 * 60 * 1000;

describe('DingtalkPersonalRenders registry', () => {
  it('registers the result view for all 14 APIs', () => {
    expect(Object.keys(DingtalkPersonalRenders)).toHaveLength(14);
    expect(new Set(Object.values(DingtalkPersonalRenders)).size).toBe(1);
  });
});

describe('ResultRender', () => {
  it('shows the inline authorize card even though the call failed', () => {
    render(
      <ResultRender
        {...props(
          'listMyTodos',
          {
            code: 'DINGTALK_PERSONAL_UNAUTHORIZED',
            kind: 'authorizationRequired',
            login: {
              expiresAt: '2026-09-24T10:15:00.000Z',
              jobId: 'job_1',
              status: 'pending',
              userCode: 'ABCD-EFGH',
              verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=X',
            },
            settingsPath: '/settings/connector',
          },
          { message: 'DINGTALK_PERSONAL_UNAUTHORIZED' },
        )}
      />,
    );

    expect(screen.getByTestId('authorize-card').dataset.compact).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('maps a failure to its short message', () => {
    render(
      <ResultRender
        {...props('getTodo', undefined, { body: { code: 'DINGTALK_PERSONAL_RATE_LIMITED' } })}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe(
      zh('render.error.DINGTALK_PERSONAL_RATE_LIMITED'),
    );
  });

  it('renders nothing without a state', () => {
    const { container } = render(<ResultRender {...props('listMyTodos')} />);
    const unknown = render(<ResultRender {...props('listMyTodos', { kind: 'mystery' })} />);

    expect(container.innerHTML).toBe('');
    expect(unknown.container.innerHTML).toBe('');
  });

  it('lists open todos with due date, priority and an overdue flag', () => {
    const now = Date.now();
    const { container } = render(
      <ResultRender
        {...props('listMyTodos', {
          hasMore: true,
          kind: 'todos',
          page: 1,
          status: 'open',
          todos: [
            { dueTime: now - 2 * HOUR, priority: 40, subject: '交库存日报', taskId: '1001' },
            { dueTime: now + 48 * HOUR, priority: 20, subject: '测试待办 123', taskId: '1002' },
            { dueTime: null, priority: null, subject: '', taskId: '1003' },
          ],
        })}
      />,
    );

    expect(screen.getByText(zh('apiName.listMyTodos'))).toBeTruthy();
    expect(screen.getByText('交库存日报')).toBeTruthy();
    expect(screen.getByText(zh('render.priority.urgent'))).toBeTruthy();
    expect(screen.queryByText(zh('render.priority.normal'))).toBeNull();
    expect(screen.getByText(zh('render.unnamed.todo'))).toBeTruthy();
    expect(screen.getByText(zh('render.todo.hasMore'))).toBeTruthy();

    const overduePrefix = zh('render.todo.overdueAt', { time: '' }).trim();
    const text = container.textContent ?? '';
    expect(text.split(overduePrefix)).toHaveLength(2);
    expect(text).toContain(zh('render.todo.dueAt', { time: '' }).trim());
    // Ids stay React keys.
    expect(container.textContent).not.toContain('1001');
  });

  it('does not call a done todo overdue', () => {
    const { container } = render(
      <ResultRender
        {...props('listMyTodos', {
          hasMore: false,
          kind: 'todos',
          page: 1,
          status: 'done',
          todos: [{ dueTime: Date.now() - HOUR, priority: 20, subject: '旧待办', taskId: '1' }],
        })}
      />,
    );

    expect(container.textContent).not.toContain(zh('render.todo.overdueAt', { time: '' }).trim());
  });

  it('shows the todo empty state', () => {
    render(
      <ResultRender
        {...props('listMyTodos', {
          hasMore: false,
          kind: 'todos',
          page: 1,
          status: 'open',
          todos: [],
        })}
      />,
    );

    expect(screen.getByText(zh('render.todo.empty'))).toBeTruthy();
  });

  it('expands a long list on demand', () => {
    const todos = Array.from({ length: 9 }, (_, index) => ({
      dueTime: null,
      priority: 20,
      subject: `待办 ${index + 1}`,
      taskId: String(index),
    }));
    render(
      <ResultRender
        {...props('listMyTodos', { hasMore: false, kind: 'todos', page: 1, status: 'all', todos })}
      />,
    );

    expect(screen.queryByText('待办 9')).toBeNull();
    fireEvent.click(screen.getByText(zh('render.showAll', { count: 9 })));
    expect(screen.getByText('待办 9')).toBeTruthy();
  });

  it('renders the todo detail with people and the DingTalk link', () => {
    render(
      <ResultRender
        {...props('getTodo', {
          kind: 'todo',
          todo: {
            createdTime: 1_790_178_236_600,
            creatorName: '张三',
            detailUrl: 'https://n.dingtalk.com/dingding/dd-todo/detail/index.html?taskId=1001',
            dueTime: 1_790_326_800_000,
            executorNames: ['张三', '李四'],
            isDone: true,
            participantNames: [],
            priority: 30,
            subject: '测试待办 123',
            taskId: '1001',
          },
        })}
      />,
    );

    expect(screen.getByText('测试待办 123')).toBeTruthy();
    expect(screen.getByText('2026-09-25 17:00')).toBeTruthy();
    expect(screen.getByText('张三、李四')).toBeTruthy();
    expect(screen.getByText(zh('render.priority.high'))).toBeTruthy();
    expect(screen.getByText(zh('render.todo.status.done'))).toBeTruthy();
    expect(screen.getByText(zh('render.openInDingtalk')).closest('a')?.getAttribute('href')).toBe(
      'https://n.dingtalk.com/dingding/dd-todo/detail/index.html?taskId=1001',
    );
  });

  it('drops a link that is not a web address', () => {
    render(
      <ResultRender
        {...props('getTodo', {
          kind: 'todo',
          todo: {
            detailUrl: 'javascript:alert(1)',
            dueTime: null,
            executorNames: [],
            isDone: false,
            participantNames: [],
            priority: null,
            subject: '待办',
            taskId: '1',
          },
        })}
      />,
    );

    expect(screen.queryByText(zh('render.openInDingtalk'))).toBeNull();
  });

  it('lists groups with their member count', () => {
    render(
      <ResultRender
        {...props('searchGroups', {
          groups: [{ conversationId: 'cid1==', memberCount: 7, name: '示例每日库存' }],
          hasMore: false,
          kind: 'groups',
        })}
      />,
    );

    expect(screen.getByText(zh('apiName.searchGroups'))).toBeTruthy();
    expect(screen.getByText('示例每日库存')).toBeTruthy();
    expect(screen.getByText(zh('render.group.members', { count: 7 }))).toBeTruthy();
  });

  it('shows messages with sender, time, text and file chips', () => {
    const { container } = render(
      <ResultRender
        {...props('listGroupMessages', {
          conversationId: 'cid1==',
          count: 2,
          endTime: '2026-09-24T23:59:59+08:00',
          hasMore: false,
          kind: 'messages',
          messages: [
            {
              createTime: '2026-09-24 08:05:33',
              files: [
                { name: '2026年9月库存日报表.xlsx', resourceId: 'f1', resourceType: 'fileId' },
              ],
              messageId: 'm1',
              sender: '王五',
              text: '[文件] 2026年9月库存日报表.xlsx',
            },
            { createTime: '2026-09-24 09:10:00', files: [], sender: '', text: '收到' },
          ],
          startTime: '2026-09-18T00:00:00+08:00',
          truncated: true,
        })}
      />,
    );

    expect(screen.getByText('王五')).toBeTruthy();
    expect(screen.getByText('2026-09-24 08:05')).toBeTruthy();
    expect(screen.getByText('2026年9月库存日报表.xlsx')).toBeTruthy();
    expect(screen.getByText(zh('render.message.unknownSender'))).toBeTruthy();
    expect(screen.getByText(zh('render.message.more'))).toBeTruthy();
    expect(container.textContent).toContain(zh('render.message.count', { count: 2 }));
    expect(container.textContent).not.toContain('cid1==');
  });

  it('keeps the file preview collapsed until asked', () => {
    render(
      <ResultRender
        {...props('downloadMessageFile', {
          fileId: 'file_1',
          kind: 'file',
          name: '2026年9月库存日报表.xlsx',
          preview: '<sheet name="9月">| 品名 | 库存 |</sheet>',
          sizeBytes: 93_388,
          url: 'https://files.example.com/f/abc.xlsx',
        })}
      />,
    );

    expect(screen.getByText('2026年9月库存日报表.xlsx')).toBeTruthy();
    expect(screen.getByText('91.2 KB')).toBeTruthy();
    expect(screen.queryByText(/品名/)).toBeNull();
    fireEvent.click(screen.getByText(zh('render.file.showPreview')));
    expect(screen.getByText(/品名/)).toBeTruthy();
    expect(screen.getByText(zh('render.file.open')).closest('a')?.getAttribute('href')).toBe(
      'https://files.example.com/f/abc.xlsx',
    );
  });

  it('says when a file could not be read as text', () => {
    render(
      <ResultRender
        {...props('downloadMessageFile', { kind: 'file', name: 'photo.png', sizeBytes: 2048 })}
      />,
    );

    expect(screen.getByText(zh('render.file.noPreview'))).toBeTruthy();
  });

  it('lists received reports under the inbox title', () => {
    render(
      <ResultRender
        {...props('listReports', {
          box: 'inbox',
          complete: false,
          kind: 'reports',
          reports: [
            {
              createTime: 1_790_178_236_600,
              creatorName: '李四',
              reportId: 'r1',
              templateName: '日报',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(zh('render.report.box.inbox'))).toBeTruthy();
    expect(screen.getByText('日报')).toBeTruthy();
    expect(screen.getByText(/^李四 · 2026-09-/)).toBeTruthy();
    expect(screen.getByText(zh('render.hasMore'))).toBeTruthy();
  });

  it('renders the report contents as rows', () => {
    render(
      <ResultRender
        {...props('getReport', {
          kind: 'report',
          report: {
            contents: [
              { key: '今日完成工作', value: '盘点库存\n整理报表' },
              { key: '明日计划', value: '' },
            ],
            creatorName: '李四',
            reportId: 'r1',
            templateName: '日报',
          },
        })}
      />,
    );

    expect(screen.getByText('日报')).toBeTruthy();
    expect(screen.getByText('今日完成工作')).toBeTruthy();
    expect(screen.getByText(/盘点库存/)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('lists templates and the fields of one template in order', () => {
    render(
      <ResultRender
        {...props('listReportTemplates', {
          kind: 'templates',
          templates: [
            { id: 't1', name: '日报' },
            { id: 't2', name: '周报' },
          ],
        })}
      />,
    );
    expect(screen.getByText('周报')).toBeTruthy();
    cleanup();

    const { container } = render(
      <ResultRender
        {...props('getReportTemplate', {
          kind: 'template',
          template: {
            fields: [
              { name: '明日计划', sort: 1, type: 1 },
              { name: '今日完成工作', sort: 0, type: 1 },
            ],
            id: 't1',
            name: '日报',
          },
        })}
      />,
    );

    expect(screen.getByText(zh('render.template.fieldCount', { count: 2 }))).toBeTruthy();
    const text = container.textContent ?? '';
    expect(text.indexOf('今日完成工作')).toBeLessThan(text.indexOf('明日计划'));
  });

  it('confirms a finished write with the server summary', () => {
    render(
      <ResultRender
        {...props('completeTodo', {
          action: 'completeTodo',
          kind: 'write',
          summary: '「测试待办 123」已完成',
          taskId: '1001',
        })}
      />,
    );

    expect(screen.getByText(zh('render.written.completeTodo'))).toBeTruthy();
    expect(screen.getByText('「测试待办 123」已完成')).toBeTruthy();
  });

  it('links the markdown link in a write summary', () => {
    render(
      <ResultRender
        {...props('submitReport', {
          action: 'submitReport',
          kind: 'write',
          reportId: 'r1',
          summary: '日报已提交，[在钉钉中查看](https://example.dingtalk.com/report/r1)',
        })}
      />,
    );

    const link = screen.getByText('在钉钉中查看').closest('a');
    expect(link?.getAttribute('href')).toBe('https://example.dingtalk.com/report/r1');
    expect(link?.getAttribute('target')).toBe('_blank');
  });
});
