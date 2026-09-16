/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhChat from '../../../../../locales/zh-CN/chat.json';
import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import type {
  CancelReminderParams,
  CancelReminderState,
  CreateReminderParams,
  CreateReminderState,
  ListRemindersParams,
  ListRemindersState,
  SearchDirectoryParams,
  SearchDirectoryState,
} from '../../types';
import CancelReminderRender from './CancelReminder';
import CreateReminderRender from './CreateReminder';
import ListRemindersRender from './ListReminders';
import SearchDirectoryRender from './SearchDirectory';

const dict = { ...(zhChat as Record<string, string>), ...(zhPlugin as Record<string, string>) };

/** Real zh-CN copy, so a missing render key fails the test. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span data-testid="icon" />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

// The package vitest config has no globals, so RTL's auto-cleanup is off.
afterEach(() => cleanup());

const emptyCreateArgs: CreateReminderParams = {
  content: '',
  recipients: [],
  schedule: { kind: 'once', time: '09:00' },
};

const renderProps = <A, S>(
  args: A,
  pluginState?: S,
  content: unknown = '',
): BuiltinRenderProps<A, S> => ({
  args,
  content,
  messageId: 'msg_1',
  pluginState,
});

describe('CreateReminderRender', () => {
  it('renders the created reminder with identifier, recipients, schedule, next fire', () => {
    const state: CreateReminderState = {
      needsConfirmation: false,
      reminder: {
        content: '周三例会材料准备',
        identifier: 'TASK-1',
        nextFireAt: '2026-09-23T01:00:00.000Z',
        recipients: [
          {
            deptName: '安环部',
            deptPath: '捷发 / 安环部',
            displayName: '胡玉琴A',
            kind: 'user',
            staffId: 'u1',
          },
          {
            deptId: 'd1',
            deptName: '安环部',
            deptPath: '捷发 / 安环部',
            displayName: '安环部',
            kind: 'department',
            memberCount: 12,
          },
        ],
        scheduleSummary: '每周三 09:00',
        taskId: 'task-1',
      },
      status: 'created',
      success: true,
    };

    render(<CreateReminderRender {...renderProps(emptyCreateArgs, state)} />);

    expect(screen.getByText('已创建定时提醒')).toBeTruthy();
    expect(screen.getByText('TASK-1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'TASK-1' }).getAttribute('href')).toBe('/task/TASK-1');
    expect(screen.getByText('胡玉琴A · 安环部')).toBeTruthy();
    expect(screen.getByText('安环部 · 12')).toBeTruthy();
    expect(screen.getByText('每周三 09:00')).toBeTruthy();
    expect(screen.getByText('2026-09-23 09:00')).toBeTruthy();
    expect(screen.getByText('周三例会材料准备')).toBeTruthy();
  });

  it('renders clarification candidates as 姓名 · 部门', () => {
    const state: CreateReminderState = {
      ambiguous: [
        {
          candidates: [
            { deptPath: '捷发 / 安环部', leafDeptName: '安环部', name: '胡玉琴A', staffId: 's1' },
            { deptPath: '捷发 / 财务部', leafDeptName: '财务部', name: '胡玉琴A', staffId: 's2' },
          ],
          query: '胡玉琴A',
        },
      ],
      needsClarification: true,
      status: 'needs_clarification',
      success: true,
      unknown: ['不存在的人'],
    };

    render(<CreateReminderRender {...renderProps(emptyCreateArgs, state)} />);

    expect(screen.getByText('请选择收件人')).toBeTruthy();
    expect(screen.getByText('胡玉琴A · 安环部')).toBeTruthy();
    expect(screen.getByText('胡玉琴A · 财务部')).toBeTruthy();
    expect(screen.getByText('未找到：不存在的人')).toBeTruthy();
  });

  it('renders the confirmation notice with department member counts', () => {
    const state: CreateReminderState = {
      audience: [
        { deptId: 'd1', memberCount: 42, name: '生产部' },
        { deptId: 'd2', memberCount: 31, name: '质检部' },
      ],
      needsConfirmation: true,
      status: 'needs_confirmation',
      success: true,
    };

    render(<CreateReminderRender {...renderProps(emptyCreateArgs, state)} />);

    expect(screen.getByText('收件范围需要确认')).toBeTruthy();
    expect(screen.getByText('生产部 · 42 人')).toBeTruthy();
    expect(screen.getByText('质检部 · 31 人')).toBeTruthy();
    expect(screen.getByText('请在对话中确认后再创建。')).toBeTruthy();
  });

  it('renders nothing before a result lands', () => {
    const { container } = render(
      <CreateReminderRender {...renderProps(emptyCreateArgs, undefined)} />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('SearchDirectoryRender', () => {
  it('lists people and departments and flags same-name hits', () => {
    const state: SearchDirectoryState = {
      ambiguous: true,
      departmentCount: 1,
      hits: {
        departments: [
          { deptId: 'd1', memberCount: 12, name: '安环部', pathNames: '捷发 / 安环部' },
        ],
        users: [
          { deptPath: '捷发 / 安环部', name: '胡玉琴', staffId: 'u1' },
          { deptPath: '捷发 / 生产部', name: '胡玉琴', staffId: 'u2' },
        ],
      },
      userCount: 2,
    };

    render(
      <SearchDirectoryRender {...renderProps({ q: '' } satisfies SearchDirectoryParams, state)} />,
    );

    expect(screen.getByText('存在同名人员，请确认具体人员')).toBeTruthy();
    expect(screen.getByText('胡玉琴 · 捷发 / 安环部')).toBeTruthy();
    expect(screen.getByText('胡玉琴 · 捷发 / 生产部')).toBeTruthy();
    expect(screen.getByText('捷发 / 安环部 · 12 人')).toBeTruthy();
  });

  it('shows the empty hint when nothing matched', () => {
    const state: SearchDirectoryState = {
      ambiguous: false,
      departmentCount: 0,
      hits: { departments: [], users: [] },
      userCount: 0,
    };

    render(
      <SearchDirectoryRender {...renderProps({ q: '' } satisfies SearchDirectoryParams, state)} />,
    );

    expect(screen.getByText('未找到匹配的人员或部门')).toBeTruthy();
  });
});

describe('ListRemindersRender', () => {
  it('renders a mini list parsed from the tool content', () => {
    const content = JSON.stringify({
      items: [
        { content: '例会材料', fireAt: '2026-09-23T01:00:00.000Z', id: 'rmd_1' },
        { content: '安全报告', fireAt: '2026-09-24T01:30:00.000Z', id: 'rmd_2' },
      ],
      scope: 'created',
    });

    render(
      <ListRemindersRender
        {...renderProps(
          {} satisfies ListRemindersParams,
          { count: 2, scope: 'created', success: true } satisfies ListRemindersState,
          content,
        )}
      />,
    );

    expect(screen.getByText('我发起的提醒')).toBeTruthy();
    expect(screen.getByText('2026-09-23 09:00 · 例会材料')).toBeTruthy();
    expect(screen.getByText('2026-09-24 09:30 · 安全报告')).toBeTruthy();
  });

  it('renders the empty state when the scope has no reminders', () => {
    render(
      <ListRemindersRender
        {...renderProps(
          {} satisfies ListRemindersParams,
          { count: 0, scope: 'received', success: true } satisfies ListRemindersState,
          '{"items":[]}',
        )}
      />,
    );

    expect(screen.getByText('我收到的提醒')).toBeTruthy();
    expect(screen.getByText('暂无定时提醒')).toBeTruthy();
  });

  it('renders rows from pluginState.items when content is not JSON', () => {
    render(
      <ListRemindersRender
        {...renderProps(
          {} satisfies ListRemindersParams,
          {
            count: 1,
            items: [
              {
                content: '例会材料',
                nextFireAt: '2026-09-23T01:00:00.000Z',
                taskIdentifier: 'TASK-1',
              },
            ],
            scope: 'created',
            success: true,
          } satisfies ListRemindersState,
          '已创建定时提醒',
        )}
      />,
    );

    expect(screen.getByText('TASK-1')).toBeTruthy();
    expect(screen.getByText(/例会材料/)).toBeTruthy();
  });

  it('renders received rows from pluginState.items using firedAt', () => {
    render(
      <ListRemindersRender
        {...renderProps(
          {} satisfies ListRemindersParams,
          {
            count: 1,
            items: [
              {
                content: '例会材料',
                creatorName: '张伟',
                firedAt: '2026-09-23T01:00:00.000Z',
                id: 'dlv_1',
                reminderId: 'rmd_1',
              },
            ],
            scope: 'received',
            success: true,
          } satisfies ListRemindersState,
          '已收到定时提醒',
        )}
      />,
    );

    expect(screen.getByText('我收到的提醒')).toBeTruthy();
    expect(screen.getByText('2026-09-23 09:00 · 例会材料')).toBeTruthy();
  });
});

describe('CancelReminderRender', () => {
  it('renders a single confirmation line', () => {
    render(
      <CancelReminderRender
        {...renderProps(
          { taskId: 'task-1' } satisfies CancelReminderParams,
          { success: true, taskId: 'task-1' } satisfies CancelReminderState,
        )}
      />,
    );

    expect(screen.getByText('已取消该定时提醒')).toBeTruthy();
  });
});
