// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';

import type { AdminApprovalRuleRow } from './columns';
import DingtalkApprovalRulesPage from './DingtalkApprovalRulesPage';
import type * as SwrKeysModule from './swrKeys';

/**
 * `conditions` / `originatorLabels` are optional on the row: the column has to read
 * as "all requests" on a payload that does not carry them, so the fixture models a
 * payload without them rather than declaring the contract's required shape.
 */
type AdminApprovalRuleFixture = Omit<AdminApprovalRuleRow, 'conditions' | 'originatorLabels'> &
  Partial<Pick<AdminApprovalRuleRow, 'conditions' | 'originatorLabels'>>;

const rule = (patch: Partial<AdminApprovalRuleFixture> = {}): AdminApprovalRuleFixture => ({
  action: 'agree',
  createdAt: '2026-09-01T00:00:00.000Z',
  dailyCount: 2,
  dailyCountDate: '2026-09-21',
  disabledReason: null,
  enabled: true,
  expiresAt: null,
  id: 'rule_1',
  lastRunAt: '2026-09-20T01:00:00.000Z',
  name: '团队短期请假自动同意',
  processCode: 'PROC-LEAVE',
  processName: '请假',
  redirectToName: null,
  staffId: 'staff_1',
  updatedAt: '2026-09-20T01:00:00.000Z',
  userDisplayName: '张三',
  userEmail: 'zhangsan@example.com',
  userId: 'user_1',
  ...patch,
});

const mocks = vi.hoisted(() => ({
  approvalEnabled: true,
  confirm: vi.fn(),
  disable: vi.fn(),
  invalidate: vi.fn(),
  listError: undefined as unknown,
  listInput: undefined as unknown,
  listLoading: false,
  mutate: vi.fn(),
  permissions: [] as string[],
  rows: [] as unknown[],
  runAdminMutation: vi.fn(),
  toastSuccess: vi.fn(),
  total: 0,
}));

vi.mock('antd-style', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createStaticStyles: () => new Proxy({}, { get: () => '' }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolation is kept so the assertions cover what the operator reads.
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join('|')}` : key,
  }),
}));

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({
    authMethod: null,
    permissions: mocks.permissions,
    status: 'allowed',
  }),
}));

vi.mock('@/features/DingTalkApprovalRules/useDingTalkApprovalEnabled', () => ({
  readDingTalkApprovalCapability: () => mocks.approvalEnabled,
  useDingTalkApprovalEnabled: () => mocks.approvalEnabled,
}));

vi.mock('@/enterprise/client/services/adminDingtalkApprovalRules', () => ({
  adminDingtalkApprovalRulesService: {
    disable: (...args: unknown[]) => mocks.disable(...args),
    list: (...args: unknown[]) => {
      mocks.listInput = args[0];
      return Promise.resolve({ items: mocks.rows, page: 1, pageSize: 20, total: mocks.total });
    },
  },
}));

/** Keep the real list hook (debounce + clamp) but resolve SWR from the fixtures. */
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (!key) return { data: undefined, error: undefined, isLoading: false, mutate: mocks.mutate };
    void fetcher();

    return {
      data: mocks.listError
        ? undefined
        : { items: mocks.rows, page: 1, pageSize: 20, total: mocks.total },
      error: mocks.listError,
      isLoading: mocks.listLoading,
      mutate: mocks.mutate,
    };
  },
}));

vi.mock('./swrKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof SwrKeysModule>()),
  invalidateAdminDingtalkApprovalRules: () => mocks.invalidate(),
}));

vi.mock('../primitives/DangerConfirm', () => ({
  openDangerConfirm: (options: unknown) => mocks.confirm(options),
}));

vi.mock('../primitives/runAdminMutation', () => ({
  runAdminMutation: async (options: { run: () => Promise<void> }) => {
    mocks.runAdminMutation(options);
    await options.run();
    return true;
  },
}));

vi.mock('@lobehub/ui', () => ({
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  SearchBar: ({
    onInputChange,
    placeholder,
    value,
  }: {
    onInputChange?: (value: string) => void;
    placeholder?: string;
    value?: string;
  }) => (
    <input
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(event) => onInputChange?.(event.target.value)}
    />
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <span data-tooltip={String(title)}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, loading: _loading, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: vi.fn(), success: (...args: unknown[]) => mocks.toastSuccess(...args) },
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({
  default: () => <span data-testid="loading" />,
}));

vi.mock('../primitives/AdminPageTemplate', () => ({
  default: ({ children, toolbar }: { children?: ReactNode; toolbar?: ReactNode }) => (
    <main>
      {toolbar}
      {children}
    </main>
  ),
}));

const forceDisableButton = () => screen.getByText('dingtalkApprovalRules.forceDisable');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approvalEnabled = true;
  mocks.permissions = [PLATFORM_PERMISSIONS.SYSTEM_READ, PLATFORM_PERMISSIONS.SYSTEM_OPERATE];
  mocks.rows = [rule()];
  mocks.total = 1;
  mocks.listError = undefined;
  mocks.listInput = undefined;
  mocks.listLoading = false;
  mocks.disable.mockResolvedValue(rule({ enabled: false }));
  mocks.invalidate.mockResolvedValue(undefined);
});

describe('DingtalkApprovalRulesPage capability gate', () => {
  it('states that DingTalk approval is off and asks the server for nothing', () => {
    // A deep link with the capability off must explain itself, not show an empty
    // table that reads as "nobody has created a rule yet".
    mocks.approvalEnabled = false;

    render(<DingtalkApprovalRulesPage />);

    expect(screen.getByText('dingtalkApprovalRules.unavailable')).toBeInTheDocument();
    expect(mocks.listInput).toBeUndefined();
  });

  it('fails closed before the permission surface, since neither promises data', () => {
    mocks.approvalEnabled = false;
    mocks.permissions = [];

    render(<DingtalkApprovalRulesPage />);

    expect(screen.getByText('dingtalkApprovalRules.unavailable')).toBeInTheDocument();
    expect(screen.queryByText('dingtalkApprovalRules.noReadPermission')).toBeNull();
  });
});

describe('DingtalkApprovalRulesPage', () => {
  it('lists every owner’s rule with the columns an administrator needs', () => {
    render(<DingtalkApprovalRulesPage />);

    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('zhangsan@example.com')).toBeInTheDocument();
    expect(screen.getByText('团队短期请假自动同意')).toBeInTheDocument();
    expect(screen.getByText('请假')).toBeInTheDocument();
    expect(screen.getByText('dingtalkApprovalRules.action.agree')).toBeInTheDocument();
    expect(screen.getByText('dingtalkApprovalRules.expiry.never')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20 09:00')).toBeInTheDocument();
    // No conditions on the payload: the cell states what the rule covers instead of
    // leaving the operator to guess.
    expect(screen.getByText('approvalRule.condition.any')).toBeInTheDocument();
  });

  it('summarizes the conditions with the names the server resolved', () => {
    mocks.rows = [
      rule({
        conditions: {
          fields: [{ componentId: 'f1', label: '请假天数', op: 'lte', value: 1 }],
          match: 'all',
          originators: { staffIds: ['u1'] },
        },
        originatorLabels: { u1: '张三' },
      }),
    ];

    render(<DingtalkApprovalRulesPage />);

    // Same sentence the owner reads in their own settings, names and all.
    expect(screen.getByText(/approvalRule\.condition\.originator:张三/)).toBeInTheDocument();
    expect(screen.getByText(/请假天数\|≤\|1/)).toBeInTheDocument();
  });

  it('falls back to the generic originator wording when no name was resolved', () => {
    mocks.rows = [rule({ conditions: { match: 'all', originators: { staffIds: ['u1'] } } })];

    render(<DingtalkApprovalRulesPage />);

    // A raw staff id is not an answer to "who does this rule cover?".
    expect(screen.getByText('approvalRule.condition.originatorSpecific')).toBeInTheDocument();
  });

  it('names the transfer target and the reason a rule stopped', () => {
    mocks.rows = [
      rule({
        action: 'redirect',
        disabledReason: 'admin',
        enabled: false,
        id: 'rule_2',
        redirectToName: '李四',
      }),
    ];

    render(<DingtalkApprovalRulesPage />);

    expect(screen.getByText('dingtalkApprovalRules.action.redirectTo:李四')).toBeInTheDocument();
    expect(screen.getByText('dingtalkApprovalRules.disabledReason.admin')).toBeInTheDocument();
  });

  it('reads an expired rule as stopped whatever the stored flag says', () => {
    mocks.rows = [rule({ expiresAt: '2020-01-01T00:00:00.000Z' })];

    render(<DingtalkApprovalRulesPage />);

    expect(screen.getByText('dingtalkApprovalRules.disabledReason.expired')).toBeInTheDocument();
    expect(forceDisableButton().closest('button')).toBeDisabled();
  });

  it('keeps the recorded reason on a stopped rule whose window also lapsed', () => {
    mocks.rows = [
      rule({ disabledReason: 'admin', enabled: false, expiresAt: '2020-01-01T00:00:00.000Z' }),
    ];

    render(<DingtalkApprovalRulesPage />);

    // The administrator's decision is the reason to act on, not the lapsed window.
    expect(screen.getByText('dingtalkApprovalRules.disabledReason.admin')).toBeInTheDocument();
    expect(screen.queryByText('dingtalkApprovalRules.disabledReason.expired')).toBeNull();
  });

  it('confirms the force disable, records the audit reason and refreshes the list', async () => {
    render(<DingtalkApprovalRulesPage />);

    fireEvent.click(forceDisableButton());

    const options = mocks.confirm.mock.calls[0][0] as {
      content: string;
      onConfirm: () => Promise<void>;
    };
    expect(options.content).toContain('dingtalkApprovalRules.forceDisableConfirm');
    expect(mocks.disable).not.toHaveBeenCalled();

    await act(async () => {
      await options.onConfirm();
    });

    expect(mocks.disable).toHaveBeenCalledWith({
      reason: 'admin.dingtalk.approval_rule.disable',
      ruleId: 'rule_1',
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('dingtalkApprovalRules.toast.forceDisabled');
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('cannot disable anything without SYSTEM_OPERATE', () => {
    mocks.permissions = [PLATFORM_PERMISSIONS.SYSTEM_READ];

    render(<DingtalkApprovalRulesPage />);

    expect(forceDisableButton().closest('button')).toBeDisabled();
    fireEvent.click(forceDisableButton());
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('asks the server for nothing without SYSTEM_READ', () => {
    mocks.permissions = [];

    render(<DingtalkApprovalRulesPage />);

    expect(screen.getByText('dingtalkApprovalRules.noReadPermission')).toBeInTheDocument();
    expect(mocks.listInput).toBeUndefined();
  });

  it('runs the search on the server after the debounce, from the first page', async () => {
    vi.useFakeTimers();
    try {
      render(<DingtalkApprovalRulesPage />);

      fireEvent.change(screen.getByPlaceholderText('dingtalkApprovalRules.searchPlaceholder'), {
        target: { value: ' 请假 ' },
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mocks.listInput).toEqual({ page: 1, pageSize: 20, q: '请假' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes an empty search result from an empty deployment', async () => {
    mocks.rows = [];
    mocks.total = 0;

    render(<DingtalkApprovalRulesPage />);
    expect(screen.getByText('dingtalkApprovalRules.empty')).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByPlaceholderText('dingtalkApprovalRules.searchPlaceholder'), {
        target: { value: 'nothing' },
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() =>
      expect(screen.getByText('dingtalkApprovalRules.emptyFiltered')).toBeInTheDocument(),
    );
  });

  it('shows a failed load as an error with a retry, never as an empty list', () => {
    mocks.rows = [];
    mocks.listError = new Error('boom');

    render(<DingtalkApprovalRulesPage />);

    expect(screen.queryByText('dingtalkApprovalRules.empty')).toBeNull();
    fireEvent.click(screen.getByText('primitives.dataTable.retry'));
    expect(mocks.mutate).toHaveBeenCalled();
  });
});
