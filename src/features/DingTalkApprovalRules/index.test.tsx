/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import zhSetting from '../../../locales/zh-CN/setting.json';
import DingTalkApprovalRules from './index';
import { resolveRunPanelMotion, RUN_PANEL_WIDTH } from './RunHistoryDrawer';
import type * as SwrKeysModule from './swrKeys';
import type { ApprovalRuleRow, ApprovalRuleRunRow } from './types';

const dict = zhSetting as Record<string, string>;

/** Real zh-CN copy so a renamed/missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN setting key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const mocks = vi.hoisted(() => ({
  approvalEnabled: true,
  confirmConfig: undefined as
    { content?: unknown; okText?: unknown; onOk?: () => void; title?: unknown } | undefined,
  /** What the run-history panel was handed by the base-ui Drawer atoms. */
  drawer: {
    motion: undefined as unknown,
    onExitComplete: undefined as (() => void) | undefined,
    onOpenChange: undefined as ((open: boolean) => void) | undefined,
    open: false,
    placement: undefined as string | undefined,
    popupClassName: undefined as string | undefined,
    popupWidth: undefined as number | string | undefined,
    width: undefined as number | string | undefined,
  },
  list: vi.fn(),
  listError: undefined as unknown,
  listLoading: false,
  listRuns: vi.fn(),
  mutateApprovalRuleLists: vi.fn(),
  refreshList: vi.fn(),
  remove: vi.fn(),
  rules: undefined as unknown,
  runs: undefined as unknown,
  setEnabled: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  // Only the page's own namespace is asserted against real copy; shared
  // primitives (AsyncError) keep an identity `t`.
  useTranslation: (ns?: string) => ({ t: ns === 'setting' ? translate : (key: string) => key }),
}));

vi.mock('./useDingTalkApprovalEnabled', () => ({
  readDingTalkApprovalCapability: () => mocks.approvalEnabled,
  useDingTalkApprovalEnabled: () => mocks.approvalEnabled,
}));

vi.mock('@/services/dingtalkApprovalRule', () => ({
  dingtalkApprovalRuleService: {
    list: mocks.list,
    listRuns: mocks.listRuns,
    remove: mocks.remove,
    setEnabled: mocks.setEnabled,
  },
}));

/** Resolve SWR synchronously from the fixtures, but still run the fetcher. */
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (!key) return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    fetcher();
    const isList = (key as unknown[])[0] === 'dingtalkApprovalRule:list';

    return {
      data: isList ? mocks.rules : mocks.runs,
      error: isList ? mocks.listError : undefined,
      isLoading: isList ? mocks.listLoading : false,
      mutate: isList ? mocks.refreshList : vi.fn(),
    };
  },
}));

vi.mock('./swrKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof SwrKeysModule>()),
  // The real one needs the SWR provider; assert the invalidation instead.
  mutateApprovalRuleLists: mocks.mutateApprovalRuleLists,
}));

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('@/components/NeuralNetworkLoading', () => ({
  default: () => <span data-testid="loading" />,
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Empty: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: mocks.toast,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <span data-tooltip={String(title)}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  confirmModal: (config: NonNullable<typeof mocks.confirmConfig>) => {
    mocks.confirmConfig = config;
    return { close: vi.fn(), destroy: vi.fn() };
  },
  DrawerBackdrop: () => null,
  DrawerClose: ({ 'aria-label': label }: { 'aria-label'?: string }) => (
    <button aria-label={label} type="button" onClick={() => mocks.drawer.onOpenChange?.(false)}>
      {label}
    </button>
  ),
  DrawerContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  // Children stay mounted while the panel slides out, as the real atom does.
  DrawerPopup: ({
    children,
    className,
    motionProps,
    placement,
    popupStyle,
    width,
  }: {
    children?: ReactNode;
    className?: string;
    motionProps?: unknown;
    placement?: string;
    popupStyle?: { width?: number | string };
    width?: number | string;
  }) => {
    mocks.drawer.motion = motionProps;
    mocks.drawer.placement = placement;
    mocks.drawer.popupClassName = className;
    mocks.drawer.popupWidth = popupStyle?.width;
    mocks.drawer.width = width;

    return (
      <div data-open={String(mocks.drawer.open)} data-testid="runs-drawer">
        {children}
      </div>
    );
  },
  DrawerPortal: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DrawerRoot: ({
    children,
    onExitComplete,
    onOpenChange,
    open,
  }: {
    children?: ReactNode;
    onExitComplete?: () => void;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) => {
    mocks.drawer.onExitComplete = onExitComplete;
    mocks.drawer.onOpenChange = onOpenChange;
    mocks.drawer.open = Boolean(open);
    return <>{children}</>;
  },
  DrawerTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children?: ReactNode }) => <span data-testid="chip">{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

const ruleFixture: ApprovalRuleRow[] = [
  {
    action: 'agree',
    conditions: {
      fields: [{ componentId: 'f1', label: '请假天数', op: 'lte', value: 1 }],
      match: 'all',
      originators: { staffIds: ['u1'] },
    },
    dailyCap: 20,
    dailyCount: 3,
    dailyCountDate: new Date().toISOString(),
    enabled: true,
    expiresAt: null,
    id: 'rule_1',
    name: '团队短期请假自动同意',
    originatorLabels: { u1: '张三' },
    processName: '请假',
  },
  {
    action: 'redirect',
    conditions: { match: 'all' },
    dailyCap: null,
    dailyCount: 0,
    disabledReason: 'admin',
    enabled: false,
    expiresAt: '2026-08-01T00:00:00.000Z',
    id: 'rule_2',
    name: '出差报销转交',
    processName: '报销',
    redirectToName: '李四',
    remark: '请财务复核',
  },
];

const runFixture: ApprovalRuleRunRow[] = [
  {
    action: 'agree',
    createdAt: '2026-09-20T01:00:00.000Z',
    id: 'run_1',
    instanceTitle: '张三的请假申请',
    originatorName: '张三',
    status: 'skipped_quota',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approvalEnabled = true;
  mocks.confirmConfig = undefined;
  mocks.drawer.motion = undefined;
  mocks.drawer.onExitComplete = undefined;
  mocks.drawer.onOpenChange = undefined;
  mocks.drawer.open = false;
  mocks.drawer.placement = undefined;
  mocks.drawer.popupClassName = undefined;
  mocks.drawer.popupWidth = undefined;
  mocks.drawer.width = undefined;
  mocks.rules = ruleFixture;
  mocks.runs = runFixture;
  mocks.listError = undefined;
  mocks.listLoading = false;
  mocks.list.mockResolvedValue(ruleFixture);
  mocks.listRuns.mockResolvedValue(runFixture);
  mocks.setEnabled.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.mutateApprovalRuleLists.mockResolvedValue(undefined);
});

describe('DingTalkApprovalRules capability gate', () => {
  it('states that the feature is unavailable and asks the server for nothing', () => {
    mocks.approvalEnabled = false;

    render(<DingTalkApprovalRules />);

    expect(screen.getByText('管理员尚未启用钉钉审批，自动审批规则暂不可用。')).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe('DingTalkApprovalRules table', () => {
  it('renders one row per rule with its condition summary, action and quota', () => {
    render(<DingTalkApprovalRules />);

    expect(mocks.list).toHaveBeenCalledWith({ includeDisabled: true });
    expect(screen.getByText('团队短期请假自动同意')).toBeInTheDocument();
    expect(screen.getByText('请假')).toBeInTheDocument();
    expect(screen.getByText('发起人：张三；请假天数 ≤ 1')).toBeInTheDocument();
    expect(screen.getByText('同意')).toBeInTheDocument();
    expect(screen.getByText('3 / 20')).toBeInTheDocument();
    expect(screen.getByText('长期有效')).toBeInTheDocument();
    expect(screen.getByText('已启用')).toBeInTheDocument();
  });

  it('names the transfer target, shows the unlimited quota and the disable reason', () => {
    render(<DingTalkApprovalRules />);

    expect(screen.getByText('转交给李四')).toBeInTheDocument();
    expect(screen.getByText('全部审批单')).toBeInTheDocument();
    expect(screen.getByText('0 · 不限')).toBeInTheDocument();
    expect(screen.getByText('已停用')).toBeInTheDocument();
    // The rule's window has lapsed too, yet the reason the user has to act on is
    // the administrator's decision — the expiry is not what stopped it.
    expect(screen.getByText('管理员停用')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
  });

  it('keeps the recorded reason on a stopped rule whose expiry also lapsed', () => {
    mocks.rules = [
      {
        ...ruleFixture[0],
        disabledReason: 'user',
        enabled: false,
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    ];

    render(<DingTalkApprovalRules />);

    expect(screen.getByText('本人停用')).toBeInTheDocument();
    expect(screen.queryByText('已过期')).toBeNull();
  });

  it('shows the count alone when the server reports no daily cap', () => {
    // `dailyCap` is absent from today's `list` payload; the cell must not invent one.
    mocks.rules = [{ ...ruleFixture[0], dailyCap: undefined }];

    render(<DingTalkApprovalRules />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('3 / 20')).toBeNull();
  });

  it('marks an enabled-but-expired rule as stopped', () => {
    mocks.rules = [{ ...ruleFixture[0], expiresAt: '2020-01-01T00:00:00.000Z' }];

    render(<DingTalkApprovalRules />);

    expect(screen.getByText('已停用')).toBeInTheDocument();
    expect(screen.getByText('已过期')).toBeInTheDocument();
  });

  it('guides the user to chat when there is no rule', () => {
    mocks.rules = [];

    render(<DingTalkApprovalRules />);

    expect(screen.getByText('暂无规则')).toBeInTheDocument();
    expect(
      screen.getByText('在对话中告诉助理您的审批要求，例如「自动同意我团队 1 天以内的请假」。'),
    ).toBeInTheDocument();
  });

  it('shows a loading state, then a retry when the first load failed', () => {
    mocks.rules = undefined;
    mocks.listLoading = true;

    const { unmount } = render(<DingTalkApprovalRules />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    unmount();

    mocks.listLoading = false;
    mocks.listError = new Error('boom');

    render(<DingTalkApprovalRules />);
    // A failed load must never read as "no rules".
    expect(screen.queryByText('暂无规则')).toBeNull();
    fireEvent.click(screen.getByText('error.retry'));
    expect(mocks.refreshList).toHaveBeenCalled();
  });

  it('disables a rule and refreshes the list', async () => {
    render(<DingTalkApprovalRules />);

    fireEvent.click(screen.getByText('停用'));

    await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith('rule_1', false));
    expect(mocks.toast.success).toHaveBeenCalledWith('规则已停用');
    expect(mocks.mutateApprovalRuleLists).toHaveBeenCalled();
  });

  it('re-enables a rule its owner stopped themselves', async () => {
    mocks.rules = [{ ...ruleFixture[1], disabledReason: 'user', expiresAt: null }];

    render(<DingTalkApprovalRules />);

    fireEvent.click(screen.getByText('启用'));

    await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith('rule_2', true));
    expect(mocks.toast.success).toHaveBeenCalledWith('规则已启用');
  });

  it('will not let the owner undo a 强制停用, and says why', () => {
    // rule_2 was stopped by an administrator: flipping the flag back would not make
    // it run, and the server refuses it — so the button must not offer to try.
    render(<DingTalkApprovalRules />);

    const enable = screen.getByText('启用').closest('button');
    expect(enable).toBeDisabled();
    fireEvent.click(screen.getByText('启用'));
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(screen.getByText('启用').closest('[data-tooltip]')?.getAttribute('data-tooltip')).toBe(
      '管理员停用，无法在此重新启用。',
    );
  });

  it('blocks re-enabling a rule whose window has closed', () => {
    mocks.rules = [
      { ...ruleFixture[0], disabledReason: 'user', enabled: false, expiresAt: '2020-01-01' },
    ];

    render(<DingTalkApprovalRules />);

    expect(screen.getByText('启用').closest('button')).toBeDisabled();
    // The owner stopped it, but the expiry is what keeps it from running again.
    expect(screen.getByText('启用').closest('[data-tooltip]')?.getAttribute('data-tooltip')).toBe(
      '已过期，无法在此重新启用。',
    );
  });

  it('surfaces a failed toggle as an error toast without refreshing', async () => {
    mocks.setEnabled.mockRejectedValue(new Error('nope'));

    render(<DingTalkApprovalRules />);
    fireEvent.click(screen.getByText('停用'));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('更新规则失败，请重试。'));
    expect(mocks.mutateApprovalRuleLists).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting and names the rule', async () => {
    render(<DingTalkApprovalRules />);

    fireEvent.click(screen.getAllByText('删除')[0]);

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.confirmConfig?.title).toBe('删除规则');
    expect(mocks.confirmConfig?.content).toBe(
      '删除规则「团队短期请假自动同意」后，符合条件的审批不再自动处理。',
    );

    mocks.confirmConfig?.onOk?.();

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('rule_1'));
    expect(mocks.toast.success).toHaveBeenCalledWith('规则已删除');
    expect(mocks.mutateApprovalRuleLists).toHaveBeenCalled();
  });

  it('surfaces a failed delete as an error toast', async () => {
    mocks.remove.mockRejectedValue(new Error('nope'));

    render(<DingTalkApprovalRules />);
    fireEvent.click(screen.getAllByText('删除')[0]);
    mocks.confirmConfig?.onOk?.();

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('删除规则失败，请重试。'));
  });
});

describe('DingTalkApprovalRules run history', () => {
  it('loads the runs of the chosen rule only after the drawer is opened', async () => {
    render(<DingTalkApprovalRules />);

    expect(mocks.listRuns).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText('执行记录')[0]);

    expect(mocks.listRuns).toHaveBeenCalledWith('rule_1');
    await waitFor(() => expect(screen.getByText('张三的请假申请')).toBeInTheDocument());
    expect(screen.getByText('2026-09-20 09:00')).toBeInTheDocument();
    expect(screen.getByText('已达上限')).toBeInTheDocument();
  });

  it('tells the user the rule has never run instead of showing an empty table', async () => {
    mocks.runs = [];

    render(<DingTalkApprovalRules />);
    fireEvent.click(screen.getAllByText('执行记录')[0]);

    await waitFor(() => expect(screen.getByText('该规则尚未执行过')).toBeInTheDocument());
  });

  it('slides in from the right with a stable CSS width and the clip fix', () => {
    render(<DingTalkApprovalRules />);

    fireEvent.click(screen.getAllByText('执行记录')[0]);

    const drawer = screen.getByTestId('runs-drawer');
    expect(drawer.dataset.open).toBe('true');
    expect(mocks.drawer.placement).toBe('right');
    expect(mocks.drawer.width).toBe(RUN_PANEL_WIDTH);
    expect(mocks.drawer.popupWidth).toBe(`calc(${RUN_PANEL_WIDTH} + 48px)`);
    expect(mocks.drawer.popupClassName).toBeTruthy();
    // A collapsed slide under reduced motion, a softer enter than exit otherwise.
    expect(resolveRunPanelMotion(true).transition.duration).toBe(0);
    expect(resolveRunPanelMotion(false).transition.duration).toBeGreaterThan(
      resolveRunPanelMotion(false).exit.transition.duration,
    );
  });

  it('closes from the drawer chrome and keeps the rule until the slide-out finishes', () => {
    render(<DingTalkApprovalRules />);

    fireEvent.click(screen.getAllByText('执行记录')[0]);
    // The table cell plus the panel's subtitle.
    expect(screen.getAllByText('团队短期请假自动同意')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('关闭'));
    expect(screen.getByTestId('runs-drawer').dataset.open).toBe('false');
    // Still rendered, so the panel does not blank halfway through its exit.
    expect(screen.getAllByText('团队短期请假自动同意')).toHaveLength(2);

    act(() => {
      mocks.drawer.onExitComplete?.();
    });

    expect(screen.getAllByText('团队短期请假自动同意')).toHaveLength(1);
  });
});
