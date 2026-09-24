/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import TodoList from './TodoList';

const dict = zhPlugin as Record<string, string>;

const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: translate }),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ title }: { title?: ReactNode }) => <div role="alert">{title}</div>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

afterEach(() => cleanup());

const props = (pluginState?: unknown): BuiltinRenderProps<Record<string, unknown>, any> => ({
  args: {},
  content: '',
  messageId: 'msg_1',
  pluginState,
});

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR - 60_000).toISOString();

const ORG_NOTE =
  '你在钉钉客户端里自己创建的待办，以及其他应用推送的待办，钉钉未向本系统开放读取（需专属钉钉的待办读权限），这里只包含：待我审批的流程、由本助手创建的待办。';

const APPROVAL_TASK_ID = '2049183091773';
const PROCESS_INSTANCE_ID = 'a7Bc9dEfGhIjKlMn-1234567890';
const TODO_TASK_ID = 'task6b1f0a9c8e7d4b3a5c9e2f81d4b70a36';

const approval = (title: string, originatorName: string, createdAt: string, index = 0) => ({
  createdAt,
  originatorName,
  processInstanceId: `${PROCESS_INSTANCE_ID}-${index}`,
  source: 'approval',
  taskId: `${APPROVAL_TASK_ID}${index}`,
  title,
});

const appTodo = (subject: string, overrides: Record<string, unknown> = {}) => ({
  done: false,
  isDone: false,
  source: 'assistant',
  subject,
  taskId: TODO_TASK_ID,
  ...overrides,
});

describe('TodoList (merged listTodos)', () => {
  it('renders approvals and assistant todos with every note once and the merged total', () => {
    const { container } = render(
      <TodoList
        {...props({
          appTodos: [appTodo('写周报', { priority: 40 })],
          approvals: {
            count: 2,
            items: [
              approval('采购申请', '王五', hoursAgo(3), 0),
              approval('请假申请', '赵六', hoursAgo(1), 1),
            ],
            truncated: false,
          },
          notes: [ORG_NOTE, '第二条说明'],
          serverNow: '2026-09-24 10:00:00',
          success: true,
          truncated: false,
        })}
      />,
    );
    const text = container.textContent ?? '';

    expect(screen.getByText('共 3 项')).toBeTruthy();
    expect(screen.getByText('待我审批（2）')).toBeTruthy();
    expect(screen.getByText('采购申请')).toBeTruthy();
    expect(screen.getByText(/^王五 · 3\s?小时前$/)).toBeTruthy();
    expect(screen.getByText(/^赵六 · 1\s?小时前$/)).toBeTruthy();

    expect(screen.getByText('本助手创建的待办')).toBeTruthy();
    expect(screen.getByText('写周报')).toBeTruthy();
    expect(screen.getByText('紧急')).toBeTruthy();
    expect(screen.getByText('待完成')).toBeTruthy();
    expect(screen.queryByText('组织待办')).toBeNull();

    // Every note, each exactly once.
    expect(text.split(ORG_NOTE)).toHaveLength(2);
    expect(text.split('第二条说明')).toHaveLength(2);

    // Names only: approval and todo ids never reach the card.
    expect(text).not.toContain(APPROVAL_TASK_ID);
    expect(text).not.toContain(PROCESS_INSTANCE_ID);
    expect(text).not.toContain(TODO_TASK_ID);
  });

  it('adds org todos to the list and the total when the tenant can read them', () => {
    render(
      <TodoList
        {...props({
          appTodos: [appTodo('写周报')],
          approvals: { count: 0, items: [], truncated: false },
          notes: [],
          orgTodos: [appTodo('客户端里建的待办', { done: true, isDone: true, taskId: 't2' })],
          success: true,
        })}
      />,
    );

    expect(screen.getByText('共 2 项')).toBeTruthy();
    expect(screen.queryByText(/待我审批/)).toBeNull();
    expect(screen.getByText('组织待办')).toBeTruthy();
    expect(screen.getByText('客户端里建的待办')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('reads a merged card that only carries `done`', () => {
    render(
      <TodoList
        {...props({
          appTodos: [{ done: true, source: 'assistant', subject: '已办完', taskId: 't3' }],
          approvals: { count: 0, items: [] },
          notes: [],
        })}
      />,
    );

    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('counts approvals beyond the rows it received', () => {
    render(
      <TodoList
        {...props({
          appTodos: [],
          approvals: {
            count: 8,
            items: [approval('采购申请', '王五', hoursAgo(2))],
            truncated: true,
          },
          notes: [],
        })}
      />,
    );

    expect(screen.getByText('共 8 项')).toBeTruthy();
    expect(screen.getByText('待我审批（8）')).toBeTruthy();
    expect(screen.getByText('+7')).toBeTruthy();
  });

  it('shows the empty state with the note when nothing is pending', () => {
    const { container } = render(
      <TodoList
        {...props({
          appTodos: [],
          approvals: { count: 0, items: [], truncated: false },
          notes: [ORG_NOTE],
          success: true,
        })}
      />,
    );

    expect(screen.getByText('暂无待办')).toBeTruthy();
    expect(container.textContent).toContain(ORG_NOTE);
    expect(screen.queryByText(/^共 \d+ 项$/)).toBeNull();
  });

  it('shows an unnamed approval with a neutral noun, and drops an unreadable time', () => {
    render(
      <TodoList
        {...props({
          appTodos: [],
          approvals: {
            count: 1,
            items: [{ createdAt: 'not a time', originatorName: '王五', taskId: APPROVAL_TASK_ID }],
          },
          notes: [],
        })}
      />,
    );

    expect(screen.getByText('未命名条目')).toBeTruthy();
    expect(screen.getByText('王五')).toBeTruthy();
  });
});

const PERSONAL_MERGED_NOTE = '已包含你在钉钉里的全部待办（经你授权读取）';
const PERSONAL_AUTH_NOTE =
  '授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办（设置 → 连接器 → 钉钉个人数据）';

const personalTodo = (subject: string, overrides: Record<string, unknown> = {}) => ({
  done: false,
  source: 'personal',
  subject,
  taskId: '57475254077',
  ...overrides,
});

describe('TodoList (personal todos)', () => {
  it('shows the read-only 我的钉钉待办 section with due date, priority and overdue flag', () => {
    const { container } = render(
      <TodoList
        {...props({
          appTodos: [appTodo('写周报')],
          approvals: { count: 0, items: [], truncated: false },
          notes: [PERSONAL_MERGED_NOTE],
          personalTodos: [
            personalTodo('交库存日报', { dueTime: Date.now() - 2 * HOUR, priority: 40 }),
            personalTodo('测试待办 123', {
              dueTime: Date.now() + 48 * HOUR,
              priority: 20,
              taskId: '57475254078',
            }),
            personalTodo('已办完的事', {
              done: true,
              dueTime: Date.now() - 48 * HOUR,
              taskId: '57475254079',
            }),
          ],
          success: true,
        })}
      />,
    );
    const text = container.textContent ?? '';

    expect(screen.getByText('共 4 项')).toBeTruthy();
    expect(screen.getByText('我的钉钉待办')).toBeTruthy();
    expect(screen.getByText('本助手创建的待办')).toBeTruthy();
    expect(screen.getByText('交库存日报')).toBeTruthy();
    expect(screen.getByText(/^已逾期 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 紧急$/)).toBeTruthy();
    // Only the open, past-due row is flagged.
    expect(text.split('已逾期')).toHaveLength(2);
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(text).toContain(PERSONAL_MERGED_NOTE);
    expect(text).not.toContain('57475254077');
  });

  it('puts the personal section before the assistant todos', () => {
    const { container } = render(
      <TodoList
        {...props({
          appTodos: [appTodo('写周报')],
          approvals: { count: 0, items: [] },
          notes: [],
          personalTodos: [personalTodo('客户端里的待办')],
        })}
      />,
    );
    const text = container.textContent ?? '';

    expect(text.indexOf('我的钉钉待办')).toBeLessThan(text.indexOf('本助手创建的待办'));
  });

  it('renders a personal-only result as merged', () => {
    render(<TodoList {...props({ notes: [], personalTodos: [personalTodo('只有个人待办')] })} />);

    expect(screen.getByText('共 1 项')).toBeTruthy();
    expect(screen.getByText('我的钉钉待办')).toBeTruthy();
    expect(screen.getByText('只有个人待办')).toBeTruthy();
  });

  it('shows the authorize hint next to the other notes', () => {
    const { container } = render(
      <TodoList
        {...props({
          appTodos: [],
          approvals: { count: 0, items: [] },
          notes: [ORG_NOTE, PERSONAL_AUTH_NOTE, ORG_NOTE, '  '],
        })}
      />,
    );
    const text = container.textContent ?? '';

    expect(text.split(ORG_NOTE)).toHaveLength(2);
    expect(text.split(PERSONAL_AUTH_NOTE)).toHaveLength(2);
    expect(screen.queryByText('我的钉钉待办')).toBeNull();
    expect(screen.getByText('暂无待办')).toBeTruthy();
  });
});

describe('TodoList (note links)', () => {
  it('renders the markdown link in the authorize note as a real link', () => {
    const href = 'https://chat.example.com/settings/connector?dingtalkPersonal=authorize';
    const { container } = render(
      <TodoList
        {...props({
          appTodos: [],
          approvals: { count: 0, items: [] },
          notes: [
            `授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：[点此前往授权](${href})`,
            '[坏链接](javascript:alert(1))',
          ],
        })}
      />,
    );
    const text = container.textContent ?? '';

    const link = screen.getByText('点此前往授权').closest('a');
    expect(link?.getAttribute('href')).toBe(href);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(text).toContain('授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：点此前往授权');
    expect(text).not.toContain(`](${href})`);
    // An unsafe target stays readable text, never a link.
    expect(text).toContain('[坏链接](javascript:alert(1))');
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });
});

describe('TodoList (legacy { items, count } history)', () => {
  it('still renders the old shape', () => {
    render(
      <TodoList
        {...props({
          count: 1,
          items: [{ dueTime: '2026-09-21T09:30:00+08:00', isDone: false, subject: '旧待办' }],
          success: true,
        })}
      />,
    );

    expect(screen.getByText('共 1 项')).toBeTruthy();
    expect(screen.getByText('旧待办')).toBeTruthy();
    // Past due and still open.
    expect(screen.getByText('已逾期 · 2026-09-21 09:30')).toBeTruthy();
    expect(screen.queryByText('本助手创建的待办')).toBeNull();
  });

  it('shows the todo empty state for an empty old result', () => {
    render(<TodoList {...props({ count: 0, items: [], success: true })} />);

    expect(screen.getByText('暂无待办')).toBeTruthy();
  });
});
