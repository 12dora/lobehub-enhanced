// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSystemStatus } from '@/enterprise/client/services/adminSystem';

import { DependencyGrid } from './SystemOverview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: {},
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: { span: ({ children }: { children?: ReactNode }) => <span>{children}</span> },
  useReducedMotion: () => true,
}));

// Layout primitives stay on the root package; OperationalStatus still renders the root Tag.
vi.mock('@lobehub/ui', () => ({
  Block: ({
    children,
    ...rest
  }: {
    'children'?: ReactNode;
    'data-status'?: string;
    'data-testid'?: string;
  }) => (
    <div data-status={rest['data-status']} data-testid={rest['data-testid']}>
      {children}
    </div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Tag: ({ children, color }: { children?: ReactNode; color?: string }) => (
    <span data-color={color}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: () => null,
  Tag: ({ children, color }: { children?: ReactNode; color?: string }) => (
    <span data-color={color}>{children}</span>
  ),
  Text: ({
    children,
    ...rest
  }: {
    'children'?: ReactNode;
    'data-testid'?: string;
    'title'?: string;
    'type'?: string;
  }) => (
    <span data-testid={rest['data-testid']} data-type={rest.type} title={rest.title}>
      {children}
    </span>
  ),
}));

const health = {
  errorCategory: null,
  lastCheckedAt: new Date('2026-08-21T00:00:00.000Z'),
  status: 'healthy' as const,
};

const status = (
  sandbox?: AdminSystemStatus['dependencies']['sandbox'],
  documentRender?: AdminSystemStatus['dependencies']['documentRender'],
  overrides?: Partial<AdminSystemStatus['dependencies']>,
): AdminSystemStatus => ({
  build: { gitSha: 'abc1234', version: '1.0.0' },
  capabilities: [],
  dependencies: {
    database: health,
    keyManagement: health,
    mail: health,
    objectStorage: health,
    redis: health,
    ...(sandbox ? { sandbox } : {}),
    ...(documentRender ? { documentRender } : {}),
    ...overrides,
  },
  domains: [],
  featureFlags: {
    databaseOidc: false,
    managedAgents: true,
    managedAi: true,
    managedConnectors: true,
    managedSkills: true,
    platformAdmin: true,
    runtimeBranding: true,
    settingsPolicy: true,
  },
  instanceStatus: health,
  jobs: {
    active: 0,
    completed: 0,
    errorCategory: null,
    failed: 0,
    status: 'healthy',
    total: 0,
  },
  oidc: {
    activeRevision: null,
    configured: false,
    pendingRestart: false,
    source: 'disabled',
    status: 'disabled',
  },
  recentEvents: [],
  recentPublishFailures: { count: 0, errorCategory: null, items: [], status: 'healthy' },
  runtimeErrors: [],
  snapshotAt: new Date('2026-08-21T00:00:00.000Z'),
  workers: [],
});

/** Every tile — generic or probe-backed — renders exactly two secondary info lines. */
const infoLines = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-testid="dependency-line"]')].map(
    (node) => node.textContent ?? '',
  );

describe('DependencyGrid tile shape', () => {
  it('renders exactly two info lines per tile', () => {
    const { container } = render(
      <DependencyGrid
        status={status(
          {
            activeContainers: 2,
            daemonReachable: true,
            errorCategory: null,
            imagePresent: true,
            lastCheckedAt: new Date('2026-08-21T00:00:00.000Z'),
            maxContainers: 8,
            status: 'healthy',
          },
          {
            configured: true,
            errorCategory: null,
            lastCheckedAt: new Date('2026-08-22T00:00:00.000Z'),
            latencyMs: 12,
            queuePending: 3,
            queueRunning: 1,
            status: 'healthy',
            version: '8.5.0',
          },
        )}
      />,
    );

    // 5 generic dependencies + sandbox + document render, two lines each.
    expect(infoLines(container)).toHaveLength(14);
  });

  it('shows what a dependency is and how it is doing', () => {
    render(
      <DependencyGrid
        status={status(undefined, undefined, {
          database: {
            detail: 'PostgreSQL',
            errorCategory: null,
            lastCheckedAt: new Date('2026-08-21T00:00:00.000Z'),
            latencyMs: 4,
            status: 'healthy',
            version: '17.4',
          },
        })}
      />,
    );

    expect(screen.getByText('PostgreSQL 17.4')).toBeTruthy();
    expect(screen.getByText('system.dependencies.latency:{"ms":4}')).toBeTruthy();
  });

  /** Passive probes are healthy, not broken — line 2 has to say so plainly. */
  it('explains a passive check instead of leaving the second line empty', () => {
    render(<DependencyGrid status={status()} />);

    expect(screen.getAllByText('system.dependencies.noLiveCheck').length).toBeGreaterThan(0);
  });
});

describe('DependencyGrid sandbox row', () => {
  it('hides the sandbox row when the probe is omitted', () => {
    render(<DependencyGrid status={status()} />);
    expect(screen.queryByText('system.dependencies.sandbox')).toBeNull();
  });

  it('summarises daemon, image, and container usage in two lines', () => {
    render(
      <DependencyGrid
        status={status({
          activeContainers: 2,
          daemonReachable: true,
          errorCategory: null,
          imagePresent: true,
          lastCheckedAt: new Date('2026-08-21T00:00:00.000Z'),
          maxContainers: 8,
          status: 'healthy',
        })}
      />,
    );

    expect(screen.getByText('system.dependencies.sandbox')).toBeTruthy();
    expect(screen.getByText('system.sandbox.daemonUp · system.sandbox.imageReady')).toBeTruthy();
    expect(screen.getByText('system.sandbox.containersInUse:{"active":2,"max":8}')).toBeTruthy();
  });

  /** With the daemon down the image state is unknown — only the daemon is flagged. */
  it('reports an unreachable daemon in red without guessing the image state', () => {
    const { container } = render(
      <DependencyGrid
        status={status({
          activeContainers: 0,
          daemonReachable: false,
          errorCategory: 'operation_unavailable',
          imagePresent: false,
          lastCheckedAt: new Date('2026-08-21T00:00:00.000Z'),
          lastError: 'docker socket refused the connection',
          maxContainers: 8,
          status: 'unavailable',
        })}
      />,
    );

    const daemon = screen.getByText('system.sandbox.daemonDown');
    expect(daemon.getAttribute('data-type')).toBe('danger');
    expect(container.textContent).not.toContain('system.sandbox.imageMissing');
    expect(screen.getByText('docker socket refused the connection')).toBeTruthy();
  });

  /** The production failure: daemon fine, image gone, pull policy never. */
  it('keeps a failed probe as a red tile with the image, pull policy and error', () => {
    const lastError = '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）';
    const { container } = render(
      <DependencyGrid
        status={status({
          activeContainers: 0,
          daemonReachable: true,
          detail: 'Docker',
          errorCategory: 'operation_unavailable',
          imagePresent: false,
          lastCheckedAt: new Date('2026-08-20T23:59:30.000Z'),
          lastError,
          maxContainers: 8,
          pullPolicy: 'never',
          status: 'unavailable',
        })}
      />,
    );

    const tile = [...container.querySelectorAll('[data-testid="dependency-tile"]')].find((node) =>
      node.textContent?.includes('system.dependencies.sandbox'),
    );
    expect(tile?.getAttribute('data-status')).toBe('unavailable');
    expect(tile?.querySelector('[data-color="error"]')?.textContent).toBe(
      'system.values.status.unavailable',
    );

    const missing = screen.getByText('system.sandbox.imageMissing');
    expect(missing.getAttribute('data-type')).toBe('danger');
    expect(tile?.textContent).toContain(
      `system.sandbox.pullPolicy:${JSON.stringify({ policy: 'systemGeneral.sandbox.pullPolicy.never' })}`,
    );

    const error = screen.getByText(lastError);
    expect(error.getAttribute('data-type')).toBe('danger');
    expect(tile?.querySelector('[data-testid="dependency-checked-at"]')?.textContent).toBe(
      `system.dependencies.checkedAt:${JSON.stringify({ time: 'system.relative.seconds:{"count":30}' })}`,
    );
  });

  it('names the image when the server reports it', () => {
    render(
      <DependencyGrid
        status={status({
          activeContainers: 0,
          daemonReachable: true,
          errorCategory: 'operation_unavailable',
          image: 'aihub-sandbox:latest',
          imagePresent: false,
          lastCheckedAt: new Date('2026-08-21T00:00:00.000Z'),
          maxContainers: 8,
          status: 'unavailable',
        })}
      />,
    );

    const missing = screen.getByTestId('sandbox-image-missing');
    expect(missing.textContent).toBe(
      `system.sandbox.imageNamedMissing:${JSON.stringify({ image: 'aihub-sandbox:latest' })}`,
    );
    expect(missing.getAttribute('data-type')).toBe('danger');
  });
});

describe('DependencyGrid failed probes and check time', () => {
  it('renders a failed generic probe red with its error category', () => {
    const { container } = render(
      <DependencyGrid
        status={status(undefined, undefined, {
          redis: {
            errorCategory: 'operation_unavailable',
            lastCheckedAt: new Date('2026-08-20T23:55:00.000Z'),
            status: 'unavailable',
          },
        })}
      />,
    );

    const tile = container.querySelector('[data-status="unavailable"]');
    expect(tile?.textContent).toContain('system.dependencies.redis');
    const error = screen.getByText('system.values.dependencyError.operation_unavailable');
    expect(error.getAttribute('data-type')).toBe('danger');
    expect(tile?.querySelector('[data-testid="dependency-checked-at"]')?.textContent).toBe(
      `system.dependencies.checkedAt:${JSON.stringify({ time: 'system.relative.minutes:{"count":5}' })}`,
    );
  });

  it('keeps healthy detail lines neutral', () => {
    render(<DependencyGrid status={status()} />);

    for (const line of screen.getAllByText('system.dependencies.noLiveCheck')) {
      expect(line.getAttribute('data-type')).toBe('secondary');
    }
  });

  it('shows every tile when it was last checked, or that it never was', () => {
    render(
      <DependencyGrid
        status={status(undefined, undefined, {
          mail: { errorCategory: null, lastCheckedAt: null, status: 'unknown' },
        })}
      />,
    );

    const checked = screen.getAllByTestId('dependency-checked-at').map((node) => node.textContent);
    expect(checked).toHaveLength(5);
    expect(checked).toContain('system.dependencies.neverChecked');
    expect(checked).toContain(
      `system.dependencies.checkedAt:${JSON.stringify({ time: 'system.relative.justNow' })}`,
    );
  });
});

describe('DependencyGrid document render row', () => {
  it('hides the document render row when the probe is omitted', () => {
    render(<DependencyGrid status={status()} />);
    expect(screen.queryByText('system.dependencies.documentRender')).toBeNull();
  });

  it('names the engine and explains the queue without a sidecar line', () => {
    const { container } = render(
      <DependencyGrid
        status={status(undefined, {
          configured: true,
          detail: 'Gotenberg',
          errorCategory: null,
          lastCheckedAt: new Date('2026-08-22T00:00:00.000Z'),
          latencyMs: 12,
          queuePending: 3,
          queueRunning: 1,
          status: 'healthy',
          version: '8.5.0',
        })}
      />,
    );

    expect(screen.getByText('system.dependencies.documentRender')).toBeTruthy();
    expect(screen.getByText('Gotenberg 8.5.0')).toBeTruthy();
    expect(screen.getByText('system.documentRender.queue:{"pending":3,"running":1}')).toBeTruthy();
    expect(container.textContent).not.toContain('system.documentRender.sidecar');
    expect(container.textContent).not.toContain('system.documentRender.version');
    expect(container.textContent).not.toContain('systemGeneral.test.latency');
  });

  /** An unconfigured deployment still gets the tile — "not set up" is the answer it needs. */
  it('reports an unconfigured sidecar', () => {
    const { container } = render(
      <DependencyGrid
        status={status(undefined, {
          configured: false,
          errorCategory: null,
          lastCheckedAt: new Date('2026-08-22T00:00:00.000Z'),
          queuePending: 0,
          queueRunning: 0,
          status: 'disabled',
        })}
      />,
    );

    expect(screen.getByText('system.documentRender.notConfigured')).toBeTruthy();
    expect(container.textContent).not.toContain('system.documentRender.sidecar');
    expect(container.textContent).not.toContain('system.documentRender.queue');
  });

  it('appends the 24h failed-render count to a healthy queue line in amber', () => {
    render(
      <DependencyGrid
        status={status(undefined, {
          configured: true,
          detail: 'Gotenberg',
          errorCategory: null,
          failed24h: 3,
          lastCheckedAt: new Date('2026-08-21T00:00:00.000Z'),
          queuePending: 0,
          queueRunning: 1,
          status: 'healthy',
        })}
      />,
    );

    const failed = screen.getByText('system.documentRender.failed24h:{"count":3}');
    expect(failed.getAttribute('data-type')).toBe('warning');
  });

  it('prefers the last error over the queue summary', () => {
    render(
      <DependencyGrid
        status={status(undefined, {
          configured: true,
          detail: 'Gotenberg',
          errorCategory: 'operation_unavailable',
          lastCheckedAt: new Date('2026-08-22T00:00:00.000Z'),
          lastError: 'sidecar returned 502',
          queuePending: 0,
          queueRunning: 0,
          status: 'unavailable',
        })}
      />,
    );

    expect(screen.getByText('sidecar returned 502')).toBeTruthy();
  });
});
