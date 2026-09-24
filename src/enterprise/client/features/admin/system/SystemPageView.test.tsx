// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AdminSystemInstancesState,
  AdminSystemJobMutations,
  AdminSystemJobsState,
} from './hooks/useAdminSystem';
import { SystemPageView, type SystemPageViewProps } from './SystemPageView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: new Proxy({}, { get: () => '' }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <>
      {children}
      <span data-testid="tooltip">{title}</span>
    </>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ title }: { title?: ReactNode }) => <div role="alert">{title}</div>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Text: ({ as: As = 'span', children }: { as?: 'h1' | 'h2' | 'span'; children?: ReactNode }) => (
    <As>{children}</As>
  ),
}));

vi.mock('@/enterprise/client/services/adminSystem', () => ({ adminSystemService: {} }));

vi.mock('@/enterprise/client/features/admin/pages/AdminStateSurfaces', () => ({
  AdminLoadingSurface: () => <div data-testid="loading" />,
}));

vi.mock('./alerts/AlertSettingsDrawer', () => ({
  AlertSettingsDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="alert-settings-drawer" /> : null,
}));
vi.mock('./components/InstancesTable', () => ({ InstancesTable: () => <div /> }));
vi.mock('./components/JobsPanel', () => ({ JobsPanel: () => <div data-testid="jobs-panel" /> }));
vi.mock('./components/RuntimeHealth', () => ({
  CapabilityReadiness: () => null,
  RecentEventList: () => null,
  RuntimeErrorList: () => null,
  StatusSummaryBadge: () => null,
  WorkerHealthList: () => null,
}));
vi.mock('./components/SystemOverview', () => ({
  BuildSummary: () => null,
  DependencyGrid: () => null,
  JobsSummary: () => null,
  OidcSummary: () => null,
  PublishFailures: () => null,
}));

const props = (overrides: Partial<SystemPageViewProps> = {}): SystemPageViewProps => ({
  alertSettingsOpen: false,
  canOperate: true,
  canRead: true,
  instances: {} as AdminSystemInstancesState,
  isRefreshing: false,
  jobs: {} as AdminSystemJobsState,
  mutations: {} as AdminSystemJobMutations,
  onAlertSettingsOpenChange: vi.fn(),
  onRefresh: vi.fn(),
  onShowOfflineInstancesChange: vi.fn(),
  showOfflineInstances: false,
  status: { data: undefined, error: undefined, isLoading: false, retry: vi.fn() },
  ...overrides,
});

describe('SystemPageView', () => {
  it('puts 告警设置 next to 刷新 and opens the drawer from it', () => {
    const onAlertSettingsOpenChange = vi.fn();
    const onRefresh = vi.fn();
    const { rerender } = render(
      <SystemPageView {...props({ onAlertSettingsOpenChange, onRefresh })} />,
    );

    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons.indexOf('system.actions.alertSettings')).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf('system.actions.alertSettings')).toBe(
      buttons.indexOf('system.actions.refresh') - 1,
    );

    fireEvent.click(screen.getByText('system.actions.alertSettings'));
    expect(onAlertSettingsOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('system.actions.refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    expect(screen.queryByTestId('alert-settings-drawer')).toBeNull();
    rerender(<SystemPageView {...props({ alertSettingsOpen: true })} />);
    expect(screen.getByTestId('alert-settings-drawer')).toBeTruthy();
  });

  it('drops the page subtitle and the instance description, keeping a "?" tip', () => {
    render(<SystemPageView {...props()} />);

    expect(document.body.textContent).not.toContain('system.description');
    expect(document.body.textContent).not.toContain('system.instances.description');
    expect(
      screen.getByRole('button', {
        name: 'systemGeneral.helpFor:{"field":"system.instances.title"}',
      }),
    ).toBeTruthy();
    expect(screen.getByTestId('tooltip').textContent).toBe('system.instances.help');
  });
});
