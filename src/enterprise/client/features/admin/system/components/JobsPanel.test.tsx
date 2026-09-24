// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminReauthCancelledError } from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import type {
  AdminSystemJobMutations,
  AdminSystemJobsState,
} from '@/enterprise/client/features/admin/system/hooks/useAdminSystem';
import type { AdminSystemJob } from '@/enterprise/client/services/adminSystem';

import { JobsPanel } from './JobsPanel';

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_target, property) => String(property) }),
  cssVar: {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Alert: ({ message }: { message?: ReactNode }) => <div role="alert">{message}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, loading: _loading, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Text: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  toast,
}));

interface ConfirmOptions {
  confirmText?: string;
  content: ReactNode;
  onConfirm: () => Promise<void> | void;
  title: string;
}

const confirm = vi.hoisted(() => ({ last: undefined as ConfirmOptions | undefined }));

vi.mock('@/enterprise/client/features/admin/primitives/DangerConfirm', () => ({
  openDangerConfirm: (options: ConfirmOptions) => {
    confirm.last = options;
  },
}));

const table = vi.hoisted(() => ({
  props: undefined as any,
}));

vi.mock('@/enterprise/client/features/admin/primitives/DataTable', () => ({
  default: (props: any) => {
    table.props = props;
    return (
      <div data-testid="table">
        {props.dataSource.map((row: AdminSystemJob) => (
          <div data-testid="row" key={row.jobId}>
            {row.jobId}
          </div>
        ))}
      </div>
    );
  },
}));

const job = (overrides: Partial<AdminSystemJob> = {}): AdminSystemJob => ({
  attempt: 1,
  canCancel: false,
  canRetry: false,
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  errorCategory: null,
  failedCount: 0,
  finishedAt: new Date('2026-09-20T00:01:00.000Z'),
  jobId: 'pjob_0000000000000001',
  kind: 'audit_export',
  maxAttempts: 3,
  progress: { done: 1, total: 1 },
  revision: null,
  startedAt: new Date('2026-09-20T00:00:01.000Z'),
  status: 'succeeded',
  typeId: 'platform.audit.export.v1',
  updatedAt: new Date('2026-09-20T00:01:00.000Z'),
  ...overrides,
});

const buildState = (overrides: Partial<AdminSystemJobsState> = {}): AdminSystemJobsState => ({
  backgroundError: undefined,
  data: undefined,
  goToFirstPage: vi.fn(),
  initialError: undefined,
  isLoadingInitial: false,
  isLoadingPage: false,
  jobs: [job()],
  page: 2,
  pageSize: 50,
  refresh: vi.fn(),
  setPagination: vi.fn(),
  total: 120,
  ...overrides,
});

const buildMutations = (
  overrides: Partial<AdminSystemJobMutations> = {},
): AdminSystemJobMutations => ({
  busyJobIds: [],
  cancel: vi.fn(),
  clear: vi.fn().mockResolvedValue({ hidden: 12, ok: true }),
  clearing: false,
  refreshPendingJobIds: [],
  retry: vi.fn(),
  retryRefresh: vi.fn(),
  ...overrides,
});

describe('JobsPanel', () => {
  beforeEach(() => {
    confirm.last = undefined;
    table.props = undefined;
    toast.error.mockReset();
    toast.success.mockReset();
  });

  it('drives numbered server pagination with the exact total and 20/50/100 sizes', () => {
    const state = buildState();
    render(<JobsPanel canOperate mutations={buildMutations()} state={state} />);

    expect(table.props.pagination).toEqual({
      current: 2,
      pageSize: 50,
      pageSizeOptions: ['20', '50', '100'],
      total: 120,
    });
    table.props.onPaginationChange(3, 50);
    expect(state.setPagination).toHaveBeenCalledWith(3, 50);
    // No keyset leftovers: no 加载更多, no staged "apply updates" banner.
    expect(screen.queryByText('system.jobs.actions.loadMore')).toBeNull();
    expect(screen.queryByText('system.jobs.actions.applyUpdates')).toBeNull();
  });

  it('confirms 清除 with a short notice, then reports how many rows were hidden', async () => {
    const mutations = buildMutations();
    render(<JobsPanel canOperate mutations={mutations} state={buildState()} />);

    fireEvent.click(screen.getByText('system.jobs.actions.clear'));
    expect(confirm.last?.title).toBe('system.jobs.modal.clear.title');
    expect(confirm.last?.content).toBe('system.jobs.modal.clear.description');
    expect(mutations.clear).not.toHaveBeenCalled();

    await act(async () => {
      await confirm.last?.onConfirm();
    });
    expect(mutations.clear).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('system.jobs.toast.cleared:{"count":12}');
  });

  it('shows the table as loading instead of rows from another page', () => {
    const state = buildState({ isLoadingPage: true });
    render(<JobsPanel canOperate mutations={buildMutations()} state={state} />);
    expect(table.props.loading).toBe(true);
  });

  it('uses neutral copy when re-authentication for 清除 is cancelled', async () => {
    const mutations = buildMutations({
      clear: vi.fn().mockResolvedValue({ error: new AdminReauthCancelledError(), ok: false }),
    });
    render(<JobsPanel canOperate mutations={mutations} state={buildState()} />);

    fireEvent.click(screen.getByText('system.jobs.actions.clear'));
    await act(async () => {
      await confirm.last?.onConfirm();
    });
    expect(toast.error).toHaveBeenCalledWith('system.actions.reauthCancelled');
  });

  it('reports a failed clear', async () => {
    const mutations = buildMutations({
      clear: vi.fn().mockResolvedValue({ error: new Error('boom'), ok: false }),
    });
    render(<JobsPanel canOperate mutations={mutations} state={buildState()} />);

    fireEvent.click(screen.getByText('system.jobs.actions.clear'));
    await act(async () => {
      await confirm.last?.onConfirm();
    });
    expect(toast.error).toHaveBeenCalledWith('system.jobs.toast.clearFailed');
  });

  it('offers 清除 only to operators, and not on an empty list', () => {
    const { rerender } = render(
      <JobsPanel canOperate={false} mutations={buildMutations()} state={buildState()} />,
    );
    expect(screen.queryByText('system.jobs.actions.clear')).toBeNull();
    expect(screen.getByText('system.jobs.readOnly')).toBeTruthy();

    rerender(
      <JobsPanel
        canOperate
        mutations={buildMutations()}
        state={buildState({ jobs: [], total: 0 })}
      />,
    );
    expect((screen.getByText('system.jobs.actions.clear') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('keeps the rows and offers a retry when a background refresh fails', () => {
    const state = buildState({
      backgroundError: new Error('offline'),
      data: { clearedAt: null, items: [job()], page: 2, pageSize: 50, total: 120 } as never,
    });
    render(<JobsPanel canOperate mutations={buildMutations()} state={state} />);

    expect(screen.getByText('system.jobs.refreshFailed')).toBeTruthy();
    expect(screen.getAllByTestId('row')).toHaveLength(1);
  });

  it('renders the section title without the old description paragraph', () => {
    render(<JobsPanel canOperate mutations={buildMutations()} state={buildState()} />);

    expect(screen.getByRole('heading', { name: 'system.jobs.title' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('system.jobs.description');
  });
});
