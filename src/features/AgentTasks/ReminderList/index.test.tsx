/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import zhChat from '../../../../locales/zh-CN/chat.json';
import ReminderList from './index';
import type { CreatedReminderView, ReceivedReminderView } from './types';

const dict = zhChat as Record<string, string>;

const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN chat key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  created: [] as unknown[],
  createdError: undefined as unknown,
  hideReceived: vi.fn(),
  listCreated: vi.fn(),
  listReceived: vi.fn(),
  received: [] as unknown[],
  refreshCreated: vi.fn(),
  refreshReceived: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@/services/reminder', () => ({
  reminderService: {
    cancel: mocks.cancel,
    hideReceived: mocks.hideReceived,
    listCreated: mocks.listCreated,
    listReceived: mocks.listReceived,
  },
}));

/** Resolve SWR synchronously from the fixtures, but still run the fetcher. */
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: string[], fetcher: () => Promise<unknown>) => {
    fetcher();
    const isCreated = key[0] === 'reminder:listCreated';

    return {
      data: isCreated ? mocks.created : mocks.received,
      error: isCreated ? mocks.createdError : undefined,
      isLoading: false,
      mutate: isCreated ? mocks.refreshCreated : mocks.refreshReceived,
    };
  },
}));

vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: mocks.toast,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Skeleton: () => <span data-testid="skeleton" />,
  Tag: ({ children }: { children?: ReactNode }) => <span data-testid="chip">{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

/** Popconfirm collapses to an inline "confirm" button in tests. */
vi.mock('antd', () => ({
  Popconfirm: ({
    children,
    okText,
    onConfirm,
  }: {
    children?: ReactNode;
    okText?: ReactNode;
    onConfirm?: () => void;
  }) => (
    <span>
      {children}
      <button type="button" onClick={onConfirm}>
        {`confirm:${String(okText)}`}
      </button>
    </span>
  ),
}));

const createdFixture: CreatedReminderView[] = [
  {
    content: '周三例会材料准备',
    creatorName: '张伟',
    fireAt: '2026-09-23T01:00:00.000Z',
    id: 'rmd_1',
    recipients: [
      { deptName: '安环部', displayName: '胡玉琴A', kind: 'user', staffId: 'u1' },
      { deptId: 'd1', displayName: '安环部', kind: 'department', memberCount: 12 },
    ],
    repeatRule: { freq: 'weekly', time: '09:00', weekdays: [3] },
    status: 'scheduled',
    timezone: 'Asia/Shanghai',
  },
  {
    content: '已经发出的提醒',
    creatorName: '张伟',
    fireAt: '2026-09-10T01:00:00.000Z',
    id: 'rmd_2',
    recipients: [],
    repeatRule: null,
    status: 'sent',
  },
];

const receivedFixture: ReceivedReminderView[] = [
  {
    content: '提交月度安全报告',
    creatorName: '李娜',
    firedAt: '2026-09-16T01:00:00.000Z',
    id: 'dlv_1',
    reminderId: 'rmd_9',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.created = createdFixture;
  mocks.received = receivedFixture;
  mocks.createdError = undefined;
  mocks.listCreated.mockResolvedValue(createdFixture);
  mocks.listReceived.mockResolvedValue(receivedFixture);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.hideReceived.mockResolvedValue(undefined);
});

describe('ReminderList', () => {
  it('loads both sections through the reminder service', () => {
    render(<ReminderList />);

    expect(mocks.listCreated).toHaveBeenCalled();
    expect(mocks.listReceived).toHaveBeenCalled();
    expect(screen.getByText('我发起的')).toBeInTheDocument();
    expect(screen.getByText('我收到的')).toBeInTheDocument();
  });

  it('renders a created reminder with status, next fire time, repeat and chips', () => {
    render(<ReminderList />);

    expect(screen.getByText('待发送')).toBeInTheDocument();
    expect(screen.getByText('已发送')).toBeInTheDocument();
    expect(screen.getByText('下次发送 2026-09-23 09:00')).toBeInTheDocument();
    expect(screen.getByText('周期 每周三 09:00')).toBeInTheDocument();
    expect(screen.getByText('@胡玉琴A · 安环部')).toBeInTheDocument();
    expect(screen.getByText('@安环部 · 12 人')).toBeInTheDocument();
    expect(screen.getAllByText('设置人 张伟')).toHaveLength(2);
  });

  it('renders a received reminder with its send time and creator', () => {
    render(<ReminderList />);

    expect(screen.getByText('提交月度安全报告')).toBeInTheDocument();
    expect(screen.getByText('发送时间 2026-09-16 09:00')).toBeInTheDocument();
    expect(screen.getByText('来自 李娜')).toBeInTheDocument();
  });

  it('offers 取消提醒 only for a scheduled reminder and refreshes after confirming', async () => {
    render(<ReminderList />);

    const confirmButtons = screen.getAllByText('confirm:取消提醒');
    expect(confirmButtons).toHaveLength(1);

    fireEvent.click(confirmButtons[0]);

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('rmd_1'));
    expect(mocks.refreshCreated).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith('提醒已取消');
  });

  it('hides a received reminder and refreshes after confirming', async () => {
    render(<ReminderList />);

    fireEvent.click(screen.getByText('confirm:删除'));

    await waitFor(() => expect(mocks.hideReceived).toHaveBeenCalledWith('dlv_1'));
    expect(mocks.refreshReceived).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith('提醒已删除');
  });

  it('surfaces a failed cancel as an error toast', async () => {
    mocks.cancel.mockRejectedValue(new Error('nope'));

    render(<ReminderList />);
    fireEvent.click(screen.getByText('confirm:取消提醒'));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('取消提醒失败'));
    expect(mocks.refreshCreated).not.toHaveBeenCalled();
  });

  it('shows both empty states when there is nothing to list', () => {
    mocks.created = [];
    mocks.received = [];

    render(<ReminderList />);

    expect(screen.getByText('暂无定时提醒')).toBeInTheDocument();
    expect(screen.getByText('暂无收到的提醒')).toBeInTheDocument();
  });

  it('shows a retry affordance when a section fails to load', () => {
    mocks.createdError = new Error('boom');

    render(<ReminderList />);

    expect(screen.getByText('加载定时提醒失败')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(mocks.refreshCreated).toHaveBeenCalled();
  });
});
