/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhChat from '../../../../../locales/zh-CN/chat.json';
import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import type { CreateReminderState, SearchDirectoryState } from '../../types';
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

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span data-testid="icon" />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/features/AgentTasks/ReminderList/ReminderRecipients', () => ({
  default: ({ recipients }: { recipients?: Array<{ displayName: string }> }) => (
    <span data-testid="recipients">
      {(recipients ?? []).map((item) => item.displayName).join(',')}
    </span>
  ),
}));

// The package vitest config has no globals, so RTL's auto-cleanup is off.
afterEach(() => cleanup());

const renderProps = <S,>(pluginState: S, content: unknown = '') =>
  ({
    args: {} as never,
    content,
    messageId: 'msg_1',
    pluginState,
  }) as never;

describe('CreateReminderRender', () => {
  it('renders the created reminder as a compact card', () => {
    const state: CreateReminderState = {
      needsConfirmation: false,
      reminder: {
        content: '周三例会材料准备',
        creatorName: '张伟',
        fireAt: '2026-09-23T01:00:00.000Z',
        id: 'rmd_1',
        recipients: [
          { deptName: '安环部', displayName: '胡玉琴A', kind: 'user' },
          { displayName: '安环部', kind: 'department', memberCount: 12 },
        ],
        repeat: { freq: 'weekly', time: '09:00', weekdays: [3] },
      },
      success: true,
    };

    render(<CreateReminderRender {...renderProps(state)} />);

    expect(screen.getByText('已创建定时提醒')).toBeTruthy();
    expect(screen.getByTestId('recipients').textContent).toBe('胡玉琴A,安环部');
    expect(screen.getByText('2026-09-23 09:00')).toBeTruthy();
    expect(screen.getByText('每周三 09:00')).toBeTruthy();
    expect(screen.getByText('周三例会材料准备')).toBeTruthy();
    expect(screen.getByText('张伟')).toBeTruthy();
  });

  it('renders the confirmation notice with department member counts', () => {
    const state: CreateReminderState = {
      audience: [
        { deptId: 'd1', memberCount: 42, name: '生产部' },
        { deptId: 'd2', memberCount: 31, name: '质检部' },
      ],
      needsConfirmation: true,
      success: true,
    };

    render(<CreateReminderRender {...renderProps(state)} />);

    expect(screen.getByText('收件范围需要确认')).toBeTruthy();
    expect(screen.getByText('生产部 · 42 人')).toBeTruthy();
    expect(screen.getByText('质检部 · 31 人')).toBeTruthy();
    expect(screen.getByText('请在对话中确认后再创建。')).toBeTruthy();
    // Nothing was created, so no reminder card fields.
    expect(screen.queryByTestId('recipients')).toBeNull();
  });

  it('renders nothing before a result lands', () => {
    const { container } = render(<CreateReminderRender {...renderProps(undefined)} />);

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

    render(<SearchDirectoryRender {...renderProps(state)} />);

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

    render(<SearchDirectoryRender {...renderProps(state)} />);

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
        {...renderProps({ count: 2, scope: 'created' as const, success: true }, content)}
      />,
    );

    expect(screen.getByText('我发起的提醒')).toBeTruthy();
    expect(screen.getByText('2026-09-23 09:00 · 例会材料')).toBeTruthy();
    expect(screen.getByText('2026-09-24 09:30 · 安全报告')).toBeTruthy();
  });

  it('renders the empty state when the scope has no reminders', () => {
    render(
      <ListRemindersRender
        {...renderProps({ count: 0, scope: 'received' as const, success: true }, '{"items":[]}')}
      />,
    );

    expect(screen.getByText('我收到的提醒')).toBeTruthy();
    expect(screen.getByText('暂无定时提醒')).toBeTruthy();
  });
});

describe('CancelReminderRender', () => {
  it('renders a single confirmation line', () => {
    render(<CancelReminderRender {...renderProps({ id: 'rmd_1', success: true })} />);

    expect(screen.getByText('已取消该定时提醒')).toBeTruthy();
  });
});
