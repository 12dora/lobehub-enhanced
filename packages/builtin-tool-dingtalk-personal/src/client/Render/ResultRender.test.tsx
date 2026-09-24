/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div role="alert">
      <span>{title}</span>
      {description}
    </div>
  ),
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
  it('registers the result view for all 15 APIs, the batch write included', () => {
    expect(Object.keys(DingtalkPersonalRenders)).toHaveLength(15);
    expect(DingtalkPersonalRenders.completeTodos).toBe(ResultRender);
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

  it('links an unbound DingTalk identity to the binding page', () => {
    render(
      <ResultRender
        {...props('listMyTodos', undefined, { message: 'DINGTALK_IDENTITY_UNBOUND' })}
      />,
    );

    expect(screen.getByText(zh('render.error.DINGTALK_IDENTITY_UNBOUND'))).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: dict['builtins.dingtalk.action.binding'] })
        .getAttribute('href'),
    ).toBe('/settings/messenger/dingtalk');
  });

  it('sends what only the admin can switch on to the IM connector tab', () => {
    for (const code of [
      'DINGTALK_PERSONAL_DISABLED',
      'DINGTALK_PERSONAL_FEATURE_DISABLED',
      'DINGTALK_PERSONAL_CORP_ID_MISSING',
    ]) {
      const view = render(<ResultRender {...props('listMyTodos', undefined, { message: code })} />);
      const link = within(view.container).getByRole('link', {
        name: dict['builtins.dingtalk.action.adminImConnectors'],
      });
      expect(link.getAttribute('href')).toBe('/admin/system/general?tab=im-connectors');
      view.unmount();
    }
  });

  it('points the org CLI policy at the DingTalk developer console in a new tab', () => {
    render(
      <ResultRender
        {...props('listGroupMessages', undefined, {
          message: 'DINGTALK_PERSONAL_ORG_POLICY_DENIED',
        })}
      />,
    );

    const link = screen.getByRole('link', { name: dict['builtins.dingtalk.action.cliSettings'] });
    expect(link.getAttribute('href')).toBe(
      'https://open-dev.dingtalk.com/fe/old#/developerSettings',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('links DingTalk’s own permission page for PAT only when the tool returned one', () => {
    const uri = 'https://login.dingtalk.com/oauth2/pat/confirm?code=abc';
    const withUri = render(
      <ResultRender
        {...props('updateTodo', undefined, {
          code: 'DINGTALK_PERSONAL_PAT_REQUIRED',
          message: `该操作需要你在钉钉自己的权限页面上确认。这是钉钉自己的权限页面：${uri}（DINGTALK_PERSONAL_PAT_REQUIRED）`,
        })}
      />,
    );
    expect(
      within(withUri.container)
        .getByRole('link', { name: dict['builtins.dingtalk.action.patConfirm'] })
        .getAttribute('href'),
    ).toBe(uri);
    withUri.unmount();

    render(
      <ResultRender
        {...props('updateTodo', undefined, { message: 'DINGTALK_PERSONAL_PAT_REQUIRED' })}
      />,
    );
    expect(screen.getByText(zh('render.error.DINGTALK_PERSONAL_PAT_REQUIRED'))).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('offers no link where no page can help', () => {
    render(
      <ResultRender
        {...props('listMyTodos', undefined, { message: 'DINGTALK_IDENTITY_INACTIVE' })}
      />,
    );

    expect(screen.getByText(zh('render.error.DINGTALK_IDENTITY_INACTIVE'))).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
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

describe('ResultRender batch write', () => {
  const batch = (overrides: Record<string, unknown> = {}) => ({
    action: 'completeTodos',
    failed: 1,
    items: [
      { id: '1001', ok: true, title: '交库存日报' },
      { id: '1002', ok: true, title: '测试待办 123' },
      {
        error: '待办不存在或已删除（DINGTALK_PERSONAL_UPSTREAM）',
        id: '1003',
        ok: false,
        title: '写周报',
      },
    ],
    kind: 'batchWrite',
    succeeded: 2,
    summary: '已完成 2 项待办，1 项失败',
    total: 3,
    ...overrides,
  });

  it('shows the summary and one ✓ / ✗ row per todo, with the reason for a failure', () => {
    const { container } = render(<ResultRender {...props('completeTodos', batch())} />);

    expect(screen.getByText('已完成 2 项待办，1 项失败')).toBeTruthy();
    const rows = [...container.querySelectorAll('[data-status]')];
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['ok', 'ok', 'failed']);
    expect(rows[0].textContent).toBe('交库存日报');
    // The reason reads as plain Chinese: the trailing code is for the model.
    expect(rows[2].textContent).toBe('写周报待办不存在或已删除');
    // Ids stay React keys.
    expect(container.textContent).not.toMatch(/100[123]/);
  });

  it('names an untitled todo and an unexplained failure with neutral copy', () => {
    render(
      <ResultRender
        {...props(
          'completeTodos',
          batch({ items: [{ id: '57475254077', ok: false }], summary: '1 项待办未完成' }),
        )}
      />,
    );

    expect(screen.getByText(zh('render.unnamed.todo'))).toBeTruthy();
    expect(screen.getByText(zh('render.error.unknown'))).toBeTruthy();
    expect(screen.queryByText('57475254077')).toBeNull();
  });

  it('keeps the rows under the mapped error when every item failed', () => {
    const { container } = render(
      <ResultRender
        {...props(
          'completeTodos',
          batch({
            failed: 2,
            items: [
              { error: '请求过于频繁', id: '1001', ok: false, title: '交库存日报' },
              { error: '未执行', id: '1002', ok: false, title: '测试待办 123' },
            ],
            succeeded: 0,
            summary: '2 项待办均未完成',
          }),
          { body: { code: 'DINGTALK_PERSONAL_RATE_LIMITED' } },
        )}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe(
      zh('render.error.DINGTALK_PERSONAL_RATE_LIMITED'),
    );
    expect(screen.getByText('2 项待办均未完成')).toBeTruthy();
    expect(screen.getByText('未执行')).toBeTruthy();
    expect(container.querySelectorAll('[data-status="failed"]')).toHaveLength(2);
  });

  it('falls back to the counts without a summary and survives malformed items', () => {
    const { container } = render(
      <ResultRender
        {...props(
          'completeTodos',
          batch({
            items: [null, 'oops', { id: '1001', ok: true, title: '交库存日报' }],
            summary: '  ',
          }),
        )}
      />,
    );

    expect(screen.getByText(zh('render.batch.result', { failed: 0, succeeded: 1 }))).toBeTruthy();
    expect(container.querySelectorAll('[data-status]')).toHaveLength(1);
  });

  it('renders nothing for an empty batch without a summary', () => {
    const { container } = render(
      <ResultRender {...props('completeTodos', batch({ items: [], summary: '' }))} />,
    );

    expect(container.innerHTML).toBe('');
  });

  const AUTH_URL = 'https://aihub.example.com/settings/connector?dingtalkPersonal=authorize';

  const failedRow = (container: HTMLElement) =>
    container.querySelector('[data-status="failed"]') as HTMLElement;

  const oneFailure = (item: Record<string, unknown>) =>
    batch({
      items: [{ id: '1003', ok: false, title: '写周报', ...item }],
      summary: '1 项待办未完成',
    });

  it('cleans the legacy authorize sentence and keeps its link', () => {
    const { container } = render(
      <ResultRender
        {...props(
          'completeTodos',
          oneFailure({
            error: `你还没有授权 AI 助手读取你的钉钉个人数据。请点击下方卡片的「授权」按钮，或打开： [点此前往授权](${AUTH_URL}) 授权后再问我一次即可。`,
          }),
        )}
      />,
    );
    const failed = failedRow(container);

    expect(failed.textContent).toBe('写周报你还没有授权 AI 助手读取你的钉钉个人数据。点此前往授权');
    expect(failed.textContent).not.toContain('下方卡片');
    expect(within(failed).getByRole('link', { name: '点此前往授权' }).getAttribute('href')).toBe(
      AUTH_URL,
    );
  });

  it('shows the translated message of a known code instead of the sentence', () => {
    const { container } = render(
      <ResultRender
        {...props(
          'completeTodos',
          oneFailure({
            error: '钉钉授权已失效',
            errorCode: 'DINGTALK_PERSONAL_EXPIRED',
          }),
        )}
      />,
    );

    expect(failedRow(container).textContent).toBe(
      `写周报${zh('render.error.DINGTALK_PERSONAL_EXPIRED')}`,
    );
  });

  it('links the https page where the failure is fixed, with the server label', () => {
    const { container } = render(
      <ResultRender
        {...props(
          'completeTodos',
          oneFailure({
            actionLabel: '去授权',
            actionUrl: AUTH_URL,
            error: '尚未授权',
            errorCode: 'DINGTALK_PERSONAL_UNAUTHORIZED',
          }),
        )}
      />,
    );
    const failed = failedRow(container);
    const link = within(failed).getByRole('link', { name: '去授权' });

    expect(link.getAttribute('href')).toBe(AUTH_URL);
    expect(failed.textContent).toBe(
      `写周报${zh('render.error.DINGTALK_PERSONAL_UNAUTHORIZED')} 去授权`,
    );
  });

  it('falls back to 「去处理」 for an unlabeled link and never links a non-https target', () => {
    const { container } = render(
      <ResultRender
        {...props('completeTodos', oneFailure({ actionUrl: AUTH_URL, error: '需要授权' }))}
      />,
    );

    expect(
      within(failedRow(container)).getByRole('link', {
        name: translate('builtins.dingtalk.action.resolve'),
      }),
    ).toBeTruthy();
    cleanup();

    const unsafe = render(
      <ResultRender
        {...props(
          'completeTodos',
          oneFailure({
            actionLabel: '去授权',
            actionUrl: 'javascript:alert(1)',
            error: '需要授权',
          }),
        )}
      />,
    );

    expect(failedRow(unsafe.container).querySelector('a')).toBeNull();
    expect(failedRow(unsafe.container).textContent).toBe('写周报需要授权');
  });
});
