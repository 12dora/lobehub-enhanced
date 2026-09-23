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
  it('renders approvals and assistant todos with the note once and the merged total', () => {
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

    // Only the first note, exactly once.
    expect(text.split(ORG_NOTE)).toHaveLength(2);
    expect(text).not.toContain('第二条说明');

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
    expect(screen.getByText('2026-09-21 09:30')).toBeTruthy();
    expect(screen.queryByText('本助手创建的待办')).toBeNull();
  });

  it('shows the todo empty state for an empty old result', () => {
    render(<TodoList {...props({ count: 0, items: [], success: true })} />);

    expect(screen.getByText('暂无待办')).toBeTruthy();
  });
});
