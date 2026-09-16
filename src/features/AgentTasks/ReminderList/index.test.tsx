/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import zhChat from '../../../../locales/zh-CN/chat.json';
import ReminderList from './index';
import type * as SwrKeysModule from './swrKeys';
import type { CreatedReminderRow, ReceivedReminderRow } from './types';

const dict = zhChat as Record<string, string>;

/** Real zh-CN copy so a renamed/missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN chat key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  created: [] as unknown[],
  createdError: undefined as unknown,
  createdLoading: false,
  fireNow: vi.fn(),
  hideReceived: vi.fn(),
  listCreated: vi.fn(),
  listReceived: vi.fn(),
  mutateReminderLists: vi.fn(),
  navigate: vi.fn(),
  received: [] as unknown[],
  receivedError: undefined as unknown,
  receivedLoading: false,
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
    fireNow: mocks.fireNow,
    hideReceived: mocks.hideReceived,
    listCreated: mocks.listCreated,
    listReceived: mocks.listReceived,
  },
}));

/** Resolve SWR synchronously from the fixtures, but still run the fetcher. */
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown[], fetcher: () => Promise<unknown>) => {
    fetcher();
    const isCreated = key[0] === 'reminder:listCreated';

    return {
      data: isCreated ? mocks.created : mocks.received,
      error: isCreated ? mocks.createdError : mocks.receivedError,
      isLoading: isCreated ? mocks.createdLoading : mocks.receivedLoading,
      mutate: isCreated ? mocks.refreshCreated : mocks.refreshReceived,
    };
  },
}));

vi.mock('./swrKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof SwrKeysModule>()),
  // The real one needs the SWR provider; assert the invalidation instead.
  mutateReminderLists: mocks.mutateReminderLists,
}));

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('../shared/taskDetailPath', () => ({
  useNavigateToTaskDetail: () => mocks.navigate,
}));

vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: mocks.toast,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <span data-tooltip={String(title)}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Checkbox: ({
    checked,
    children,
    onChange,
  }: {
    checked?: boolean;
    children?: ReactNode;
    onChange?: (next: boolean) => void;
  }) => (
    <label>
      <input checked={!!checked} type="checkbox" onChange={() => onChange?.(!checked)} />
      {children}
    </label>
  ),
  Segmented: ({
    onChange,
    options,
    value,
  }: {
    onChange?: (next: string) => void;
    options: { label: string; value: string }[];
    value?: string;
  }) => (
    <div>
      {options.map((option) => (
        <button
          data-active={option.value === value}
          key={option.value}
          type="button"
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Skeleton: () => <span data-testid="skeleton" />,
  Tag: ({ children }: { children?: ReactNode }) => <span data-testid="chip">{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

/** Keep the real antd `Table`; collapse `Popconfirm` to an inline confirm button. */
vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
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
        <button
          type="button"
          onClick={() => {
            void Promise.resolve(onConfirm?.()).catch(() => undefined);
          }}
        >
          {`confirm:${String(okText)}`}
        </button>
      </span>
    ),
  };
});

const createdFixture: CreatedReminderRow[] = [
  {
    content: '周三例会材料准备',
    firedCount: 3,
    lastDelivery: { failed: 1, firedAt: '2026-09-16T01:00:00.000Z', sent: 2, skipped: 0 },
    lastFiredAt: '2026-09-16T01:00:00.000Z',
    nextFireAt: '2026-09-23T01:00:00.000Z',
    recipients: [
      { deptName: '安环部', displayName: '胡玉琴A', kind: 'user', staffId: 'u1' },
      { deptId: 'd1', displayName: '安环部', kind: 'department', memberCount: 12 },
    ],
    reminderId: 'rmd_1',
    scheduleSummary: '每周三 09:00',
    status: 'scheduled',
    taskId: 'task_1',
    taskIdentifier: 'RMD-1',
  },
  {
    content: '已经结束的提醒',
    firedCount: 1,
    lastFiredAt: '2026-09-10T01:00:00.000Z',
    nextFireAt: null,
    recipients: [],
    reminderId: 'rmd_2',
    scheduleSummary: '2026-09-10 09:00 一次',
    status: 'completed',
    taskId: 'task_2',
    taskIdentifier: 'RMD-2',
  },
];

const receivedFixture: ReceivedReminderRow[] = [
  {
    content: '提交月度安全报告',
    creatorName: '李娜',
    failedReason: null,
    firedAt: '2026-09-16T01:00:00.000Z',
    id: 'dlv_1',
    reminderId: 'rmd_9',
    robotFailedReason: '机器人未绑定',
    robotStatus: 'failed',
    status: 'sent',
  },
];

const showReceived = () => fireEvent.click(screen.getByText('我收到的'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.created = createdFixture;
  mocks.received = receivedFixture;
  mocks.createdError = undefined;
  mocks.receivedError = undefined;
  mocks.createdLoading = false;
  mocks.receivedLoading = false;
  mocks.listCreated.mockResolvedValue(createdFixture);
  mocks.listReceived.mockResolvedValue(receivedFixture);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.hideReceived.mockResolvedValue(undefined);
  mocks.mutateReminderLists.mockResolvedValue(undefined);
  mocks.fireNow.mockResolvedValue({
    failed: 1,
    firedAt: '2026-09-16T02:00:00.000Z',
    sent: 2,
    skipped: 0,
  });
});

describe('ReminderList 我发起的', () => {
  it('loads the created reminders and renders one row per reminder task', () => {
    render(<ReminderList />);

    // The router caps limit at 200; the tables ask for the whole set.
    expect(mocks.listCreated).toHaveBeenCalledWith({ includeFinished: false, limit: 200 });
    expect(screen.getByText('周三例会材料准备')).toBeInTheDocument();
    expect(screen.getByText('已经结束的提醒')).toBeInTheDocument();
    expect(screen.getByText('每周三 09:00')).toBeInTheDocument();
    expect(screen.getByText('09-23 09:00')).toBeInTheDocument();
    expect(screen.getByText('09-16 09:00')).toBeInTheDocument();
    expect(screen.getByText('已发 2 · 失败 1 · 跳过 0')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('renders recipient chips and a dash for a missing next fire', () => {
    render(<ReminderList />);

    expect(screen.getByText('胡玉琴A · 安环部')).toBeInTheDocument();
    expect(screen.getByText('安环部 · 12 人')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('opens the task detail page from the content cell', () => {
    render(<ReminderList />);

    fireEvent.click(screen.getByText('周三例会材料准备'));

    expect(mocks.navigate).toHaveBeenCalledWith('RMD-1');
  });

  it('offers 立即发送 / 取消提醒 only for a scheduled reminder', () => {
    render(<ReminderList />);

    expect(screen.getAllByText('confirm:立即发送')).toHaveLength(1);
    expect(screen.getAllByText('confirm:取消提醒')).toHaveLength(1);
  });

  it('fires a reminder now and refreshes the table', async () => {
    render(<ReminderList />);

    fireEvent.click(screen.getByText('confirm:立即发送'));

    await waitFor(() => expect(mocks.fireNow).toHaveBeenCalledWith('task_1'));
    expect(mocks.toast.success).toHaveBeenCalledWith('已发 2 · 失败 1 · 跳过 0');
    expect(mocks.mutateReminderLists).toHaveBeenCalled();
  });

  it('cancels a reminder and refreshes the table', async () => {
    render(<ReminderList />);

    fireEvent.click(screen.getByText('confirm:取消提醒'));

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('task_1'));
    expect(mocks.toast.success).toHaveBeenCalledWith('提醒已取消');
    expect(mocks.mutateReminderLists).toHaveBeenCalled();
  });

  it('surfaces a failed cancel as an error toast without refreshing', async () => {
    mocks.cancel.mockRejectedValue(new Error('nope'));

    render(<ReminderList />);
    fireEvent.click(screen.getByText('confirm:取消提醒'));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('取消提醒失败'));
    expect(mocks.mutateReminderLists).not.toHaveBeenCalled();
  });

  it('asks for finished reminders when 显示已结束 is checked', () => {
    render(<ReminderList />);

    fireEvent.click(screen.getByText('显示已结束'));

    expect(mocks.listCreated).toHaveBeenCalledWith({ includeFinished: true, limit: 200 });
  });

  it('shows the empty state when there is no reminder', () => {
    mocks.created = [];

    render(<ReminderList />);

    expect(screen.getByText('暂无定时提醒')).toBeInTheDocument();
  });

  it('shows a skeleton while loading and a retry when the load fails', () => {
    mocks.created = undefined as unknown as typeof mocks.created;
    mocks.createdLoading = true;

    const { unmount } = render(<ReminderList />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    unmount();

    mocks.createdLoading = false;
    mocks.createdError = new Error('boom');

    render(<ReminderList />);
    expect(screen.getByText('加载定时提醒失败')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(mocks.refreshCreated).toHaveBeenCalled();
  });
});

describe('ReminderList 我收到的', () => {
  it('renders one row per delivery with its channels', () => {
    render(<ReminderList />);
    showReceived();

    expect(mocks.listReceived).toHaveBeenCalledWith({ limit: 200 });
    expect(screen.getByText('提交月度安全报告')).toBeInTheDocument();
    expect(screen.getByText('09-16 09:00')).toBeInTheDocument();
    expect(screen.getByText('李娜')).toBeInTheDocument();

    const workNotice = screen.getByText('工作通知');
    expect(workNotice.closest('[data-tooltip]')).toHaveAttribute(
      'data-tooltip',
      '工作通知、已发送',
    );

    const robot = screen.getByText('机器人');
    expect(robot.closest('[data-tooltip]')).toHaveAttribute(
      'data-tooltip',
      '机器人、发送失败、机器人未绑定',
    );
  });

  it('renders no channel tag for a channel the delivery never used', () => {
    mocks.received = [{ ...receivedFixture[0], robotFailedReason: null, robotStatus: null }];

    render(<ReminderList />);
    showReceived();

    expect(screen.getByText('工作通知')).toBeInTheDocument();
    // `robotStatus` is absent on the live payload — a 未发送 机器人 tag would be a lie.
    expect(screen.queryByText('机器人')).toBeNull();
  });

  it('hides a received reminder and refreshes the table', async () => {
    render(<ReminderList />);
    showReceived();

    fireEvent.click(screen.getByText('confirm:删除'));

    await waitFor(() => expect(mocks.hideReceived).toHaveBeenCalledWith('dlv_1'));
    expect(mocks.toast.success).toHaveBeenCalledWith('提醒已删除');
    expect(mocks.mutateReminderLists).toHaveBeenCalled();
  });

  it('shows the empty state and the retry affordance', () => {
    mocks.received = [];

    const { unmount } = render(<ReminderList />);
    showReceived();
    expect(screen.getByText('暂无收到的提醒')).toBeInTheDocument();
    unmount();

    mocks.receivedError = new Error('boom');

    render(<ReminderList />);
    showReceived();
    const error = screen.getByText('加载定时提醒失败');
    expect(error).toBeInTheDocument();
    fireEvent.click(within(error.parentElement as HTMLElement).getByText('重试'));
    expect(mocks.refreshReceived).toHaveBeenCalled();
  });
});
