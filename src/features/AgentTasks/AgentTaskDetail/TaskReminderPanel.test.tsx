/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskReminderPanel from './TaskReminderPanel';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  fireNow: vi.fn(),
  message: { error: vi.fn(), success: vi.fn() },
  refreshTaskDetail: vi.fn(),
  refreshTaskList: vi.fn(),
  taskState: {
    activeTaskId: 'T-7',
    taskDetailMap: {} as Record<string, unknown>,
  },
}));

const reminderTask = (overrides: Record<string, unknown> = {}) => ({
  config: {
    reminder: {
      kind: 'reminder',
      once: false,
      reminderId: 'rmd_1',
      schedule: { kind: 'daily', time: '09:00' },
      scheduleSummary: '每天 09:00',
      until: '2026-12-31',
    },
  },
  heartbeat: { lastAt: '2026-09-16T01:00:00.000Z' },
  identifier: 'T-7',
  instruction: '@胡玉琴A·外贸组 @安环部\n\n每日例会 9:00 在三楼会议室',
  status: 'scheduled',
  ...overrides,
});

vi.mock('@lobehub/ui', () => ({
  Block: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span data-testid="chip">{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: mocks.message }) },
  // Render the confirm's OK affordance inline so a click can reach onConfirm.
  Popconfirm: ({
    children,
    okText,
    onConfirm,
  }: {
    children?: ReactNode;
    okText?: ReactNode;
    onConfirm?: () => void;
  }) => (
    <div>
      {children}
      <button data-testid="popconfirm-ok" type="button" onClick={onConfirm}>
        {okText}
      </button>
    </div>
  ),
}));

vi.mock('antd-style', () => ({ cssVar: { colorTextTertiary: '#999' } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0 ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('@/services/reminder', () => ({
  reminderService: { cancel: mocks.cancel, fireNow: mocks.fireNow },
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) =>
    selector({
      ...mocks.taskState,
      internal_refreshTaskDetail: mocks.refreshTaskDetail,
      refreshTaskList: mocks.refreshTaskList,
    }),
}));

describe('TaskReminderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshTaskDetail.mockResolvedValue(undefined);
    mocks.refreshTaskList.mockResolvedValue(undefined);
    mocks.fireNow.mockResolvedValue({
      failed: 1,
      firedAt: '2026-09-16T02:00:00.000Z',
      sent: 2,
      skipped: 0,
    });
    mocks.cancel.mockResolvedValue({ success: true });
    mocks.taskState.taskDetailMap = { 'T-7': reminderTask() };
  });

  afterEach(() => cleanup());

  it('renders nothing for a task that is not a reminder', () => {
    mocks.taskState.taskDetailMap = { 'T-7': { config: {}, identifier: 'T-7', status: 'backlog' } };

    const { container } = render(<TaskReminderPanel />);

    expect(container.textContent).toBe('');
  });

  it('shows recipients, schedule, end date and the last delivery', () => {
    render(<TaskReminderPanel />);

    const chips = screen.getAllByTestId('chip').map((chip) => chip.textContent);
    // Person keeps its department; a department mention is a bare name.
    expect(chips.some((chip) => chip?.includes('胡玉琴A'))).toBe(true);
    expect(chips).toContain('安环部');

    expect(screen.getByText('每天 09:00')).toBeTruthy();
    expect(screen.getByText('2026-12-31')).toBeTruthy();
    expect(screen.getByText('2026-09-16 09:00')).toBeTruthy();
  });

  it('falls back to 尚未发送 when the reminder never fired', () => {
    mocks.taskState.taskDetailMap = { 'T-7': reminderTask({ heartbeat: undefined }) };

    render(<TaskReminderPanel />);

    expect(screen.getByText('taskReminder.lastSent.never')).toBeTruthy();
  });

  it('fires the reminder now and reports the delivery counts', async () => {
    render(<TaskReminderPanel />);

    fireEvent.click(screen.getAllByTestId('popconfirm-ok')[0]);

    await waitFor(() => expect(mocks.fireNow).toHaveBeenCalledWith('T-7'));
    expect(mocks.message.success).toHaveBeenCalledWith(
      expect.stringContaining('taskReminder.fireNow.success'),
    );
    expect(mocks.message.success).toHaveBeenCalledWith(expect.stringContaining('"sent":2'));
    await waitFor(() => expect(mocks.refreshTaskDetail).toHaveBeenCalledWith('T-7'));
  });

  it('cancels the reminder and refreshes the task', async () => {
    render(<TaskReminderPanel />);

    fireEvent.click(screen.getAllByTestId('popconfirm-ok')[1]);

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('T-7'));
    expect(mocks.message.success).toHaveBeenCalledWith('taskReminder.cancel.success');
    await waitFor(() => expect(mocks.refreshTaskDetail).toHaveBeenCalledWith('T-7'));
  });

  it('hides both actions and shows a status tag once the reminder is canceled', () => {
    mocks.taskState.taskDetailMap = { 'T-7': reminderTask({ status: 'canceled' }) };

    render(<TaskReminderPanel />);

    expect(screen.queryByTestId('popconfirm-ok')).toBeNull();
    expect(screen.getByText('taskReminder.status.canceled')).toBeTruthy();
  });

  it('surfaces a failed send instead of a success toast', async () => {
    mocks.fireNow.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<TaskReminderPanel />);
    fireEvent.click(screen.getAllByTestId('popconfirm-ok')[0]);

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('taskReminder.fireNow.failed'),
    );
    expect(mocks.message.success).not.toHaveBeenCalled();
  });
});
