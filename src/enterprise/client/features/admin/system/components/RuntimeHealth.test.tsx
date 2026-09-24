// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSystemStatus } from '@/enterprise/client/services/adminSystem';

import {
  CapabilityReadiness,
  RecentEventList,
  RuntimeErrorList,
  StatusSummaryBadge,
  WorkerHealthList,
} from './RuntimeHealth';

/** Echoes the key plus any interpolation values (defaultValue is dropped). */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const rest = { ...values };
      delete rest.defaultValue;
      return Object.keys(rest).length > 0 ? `${key}:${JSON.stringify(rest)}` : key;
    },
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

interface MockProps {
  'aria-expanded'?: boolean;
  'children'?: ReactNode;
  'color'?: string;
  'data-severity'?: string;
  'data-status'?: string;
  'data-testid'?: string;
  'lineClamp'?: number;
  'onClick'?: () => void;
  'title'?: string;
  'type'?: string;
}

// Layout primitives stay on the root package; OperationalStatus still renders the root Tag.
vi.mock('@lobehub/ui', () => ({
  Block: ({ children, ...rest }: MockProps) => (
    <div
      data-severity={rest['data-severity']}
      data-status={rest['data-status']}
      data-testid={rest['data-testid']}
    >
      {children}
    </div>
  ),
  Flexbox: ({ children, 'data-testid': testId }: MockProps & { 'data-testid'?: string }) => (
    <div data-testid={testId}>{children}</div>
  ),
  Icon: () => <span />,
  Tag: ({ children, color }: MockProps) => (
    <span data-color={color} data-testid="tag">
      {children}
    </span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, ...rest }: MockProps) => (
    <button aria-expanded={rest['aria-expanded']} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Tag: ({ children, color }: MockProps) => (
    <span data-color={color} data-testid="tag">
      {children}
    </span>
  ),
  Text: ({ children, ...rest }: MockProps) => (
    <span
      data-line-clamp={rest.lineClamp}
      data-testid={rest['data-testid']}
      data-type={rest.type}
      title={rest.title}
    >
      {children}
    </span>
  ),
}));

const SNAPSHOT = new Date('2026-09-23T08:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(SNAPSHOT.getTime() - minutes * 60_000);
const healthy = { errorCategory: null, lastCheckedAt: SNAPSHOT, status: 'healthy' as const };

const buildStatus = (overrides: Partial<AdminSystemStatus> = {}): AdminSystemStatus =>
  ({
    capabilities: [],
    dependencies: {
      database: healthy,
      keyManagement: healthy,
      mail: healthy,
      objectStorage: healthy,
      redis: healthy,
    },
    recentEvents: [],
    runtimeErrors: [],
    snapshotAt: SNAPSHOT,
    workers: [],
    ...overrides,
  }) as AdminSystemStatus;

describe('StatusSummaryBadge', () => {
  it('shows 全部正常 when nothing is wrong', () => {
    render(<StatusSummaryBadge status={buildStatus()} />);

    const tag = screen.getByTestId('tag');
    expect(tag.textContent).toBe('system.summary.allHealthy');
    expect(tag.getAttribute('data-color')).toBe('success');
  });

  it('counts problems and names them', () => {
    render(
      <StatusSummaryBadge
        status={buildStatus({
          dependencies: {
            ...buildStatus().dependencies,
            sandbox: {
              activeContainers: 0,
              daemonReachable: true,
              errorCategory: 'operation_unavailable',
              imagePresent: false,
              lastCheckedAt: SNAPSHOT,
              maxContainers: 4,
              status: 'unavailable',
            },
          },
          runtimeErrors: [
            { count24h: 7, lastAt: minutesAgo(2), lastError: '400', subsystem: 'system_agent' },
          ],
        })}
      />,
    );

    const tag = screen.getByTestId('tag');
    expect(tag.textContent).toBe('system.summary.problems:{"count":2}');
    expect(tag.getAttribute('data-color')).toBe('error');
    const summary = screen.getByTestId('system-status-summary');
    expect(summary.textContent).toContain('system.dependencies.sandbox');
    expect(summary.textContent).toContain(
      'system.summary.runtimeLabel:{"name":"system.subsystems.system_agent"}',
    );
  });
});

describe('RuntimeErrorList', () => {
  it('shows an explicit empty state when nothing failed in 24h', () => {
    render(<RuntimeErrorList status={buildStatus()} />);

    expect(screen.getByTestId('runtime-errors-empty').textContent).toBe(
      'system.runtimeErrors.empty',
    );
    expect(screen.queryAllByTestId('runtime-error-row')).toHaveLength(0);
  });

  it('lists each subsystem with its count, last error and last time, newest first', () => {
    render(
      <RuntimeErrorList
        status={buildStatus({
          runtimeErrors: [
            {
              count24h: 2,
              lastAt: minutesAgo(180),
              lastError: 'embedding 401',
              subsystem: 'memory',
            },
            {
              count24h: 12,
              lastAt: minutesAgo(5),
              lastError: 'generateTopicTitle failed: 400 Bad Request',
              subsystem: 'system_agent',
            },
          ],
        })}
      />,
    );

    const rows = screen.getAllByTestId('runtime-error-row');
    expect(rows).toHaveLength(2);

    const [first, second] = rows;
    expect(first.textContent).toContain('system.subsystems.system_agent');
    expect(first.getAttribute('data-severity')).toBe('error');
    expect(within(first).getByTestId('tag').textContent).toBe(
      'system.runtimeErrors.count:{"count":12}',
    );
    expect(first.textContent).toContain(
      `system.runtimeErrors.lastAt:${JSON.stringify({ time: 'system.relative.minutes:{"count":5}' })}`,
    );
    const error = within(first).getByTestId('runtime-error-text');
    expect(error.textContent).toBe('generateTopicTitle failed: 400 Bad Request');
    expect(error.getAttribute('data-type')).toBe('danger');

    // An error that stopped hours ago is still listed, but amber.
    expect(second.textContent).toContain('system.subsystems.memory');
    expect(second.getAttribute('data-severity')).toBe('warning');
  });

  it('clips a long error to two lines and expands it on demand', () => {
    const longError = `sandbox exec failed: ${'x'.repeat(200)}`;
    render(
      <RuntimeErrorList
        status={buildStatus({
          runtimeErrors: [
            { count24h: 3, lastAt: minutesAgo(1), lastError: longError, subsystem: 'sandbox' },
          ],
        })}
      />,
    );

    const error = screen.getByTestId('runtime-error-text');
    expect(error.textContent).toBe(longError);
    expect(error.getAttribute('data-line-clamp')).toBe('2');

    fireEvent.click(screen.getByText('system.runtimeErrors.expand'));

    expect(screen.getByTestId('runtime-error-text').getAttribute('data-line-clamp')).toBeNull();
    expect(screen.getByText('system.runtimeErrors.collapse')).toBeTruthy();
  });
});

describe('CapabilityReadiness', () => {
  it('shows status, translated reason, detail and the fix-it hint', () => {
    render(
      <CapabilityReadiness
        status={buildStatus({
          capabilities: [
            { key: 'memory_embedding', reason: '未配置记忆向量模型', status: 'disabled' },
            {
              detail: '已核对 9 个槽位',
              key: 'system_agent_models',
              status: 'healthy',
            },
            {
              detail: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
              key: 'sandbox',
              reason: 'operation_unavailable',
              status: 'unavailable',
            },
          ],
        })}
      />,
    );

    const [memory, models, sandbox] = screen.getAllByTestId('capability-tile');

    expect(memory.getAttribute('data-status')).toBe('disabled');
    expect(memory.textContent).toContain('未配置记忆向量模型');
    expect(memory.textContent).toContain('system.capabilities.hint.memory_embedding');

    expect(models.textContent).toContain('已核对 9 个槽位');
    expect(models.textContent).not.toContain('system.capabilities.hint');

    expect(sandbox.getAttribute('data-status')).toBe('unavailable');
    const reason = within(sandbox).getByText('system.values.dependencyError.operation_unavailable');
    expect(reason.getAttribute('data-type')).toBe('danger');
    expect(sandbox.textContent).toContain('aihub-sandbox:latest');
    expect(sandbox.textContent).toContain('system.capabilities.hint.sandbox');
  });

  it('skips the fix-it hint when a feature is simply switched off', () => {
    render(
      <CapabilityReadiness
        status={buildStatus({
          capabilities: [
            { key: 'sandbox', reason: '沙箱未启用或不是本地 Docker 提供方', status: 'disabled' },
          ],
        })}
      />,
    );

    const [sandbox] = screen.getAllByTestId('capability-tile');
    expect(sandbox.textContent).toContain('沙箱未启用或不是本地 Docker 提供方');
    expect(sandbox.textContent).not.toContain('system.capabilities.hint');
  });

  it('points at the IM connector settings while DingTalk personal data is off', () => {
    const { unmount } = render(
      <CapabilityReadiness
        status={buildStatus({ capabilities: [{ key: 'dingtalk_personal', status: 'disabled' }] })}
      />,
    );

    const [off] = screen.getAllByTestId('capability-tile');
    expect(off.textContent).toContain('system.capabilities.dingtalk_personal');
    expect(off.textContent).toContain('system.capabilities.hint.dingtalk_personal');
    unmount();

    render(
      <CapabilityReadiness
        status={buildStatus({
          capabilities: [{ detail: '已授权 3 人', key: 'dingtalk_personal', status: 'healthy' }],
        })}
      />,
    );

    const [healthy] = screen.getAllByTestId('capability-tile');
    expect(healthy.textContent).toContain('已授权 3 人');
    expect(healthy.textContent).not.toContain('system.capabilities.hint');
  });
});

describe('WorkerHealthList', () => {
  it('shows the last tick, the interval and why a worker is down', () => {
    render(
      <WorkerHealthList
        status={buildStatus({
          workers: [
            {
              intervalMs: 60_000,
              lastTickAt: minutesAgo(0.5),
              name: 'reminder',
              started: true,
              startedAt: minutesAgo(120),
              status: 'healthy',
            },
            {
              intervalMs: 60_000,
              lastError: 'redis lock lost',
              lastTickAt: null,
              name: 'task_scheduler',
              started: false,
              startedAt: null,
              status: 'unavailable',
            },
          ],
        })}
      />,
    );

    const [reminder, scheduler] = screen.getAllByTestId('worker-tile');
    expect(reminder.textContent).toContain('system.workers.reminder');
    expect(reminder.textContent).toContain(
      `system.workers.lastTick:${JSON.stringify({ time: 'system.relative.seconds:{"count":30}' })}`,
    );
    expect(reminder.textContent).toContain('system.interval.minutes:{"count":1}');

    expect(scheduler.getAttribute('data-status')).toBe('unavailable');
    expect(scheduler.textContent).toContain('system.workers.noTick');
    expect(within(scheduler).getByText('system.workers.notStarted').getAttribute('data-type')).toBe(
      'danger',
    );
    expect(within(scheduler).getByTestId('runtime-error-text').textContent).toBe('redis lock lost');
  });

  it('says so when no worker is expected on this instance', () => {
    render(<WorkerHealthList status={buildStatus()} />);
    expect(screen.getByText('system.workers.empty')).toBeTruthy();
  });
});

describe('RecentEventList', () => {
  const event = (minutes: number, message: string, level: 'error' | 'info' | 'warning') => ({
    at: minutesAgo(minutes),
    level,
    message,
    subsystem: 'dependency:sandbox',
  });

  it('lists events newest first with their level and source', () => {
    render(
      <RecentEventList
        status={buildStatus({
          recentEvents: [
            event(30, 'AIHub 状态告警：沙箱不可用', 'warning'),
            event(1, '沙箱已恢复', 'info'),
          ],
        })}
      />,
    );

    const rows = screen.getAllByTestId('recent-event');
    expect(rows.map((row) => within(row).getByTestId('tag').textContent)).toEqual([
      'system.recentEvents.level.info',
      'system.recentEvents.level.warning',
    ]);
    expect(rows[0].textContent).toContain('沙箱已恢复');
    expect(rows[0].textContent).toContain('system.dependencies.sandbox');
  });

  it('shows the first ten and reveals the rest on demand', () => {
    render(
      <RecentEventList
        status={buildStatus({
          recentEvents: Array.from({ length: 12 }, (_, index) =>
            event(index, `event ${index}`, 'error'),
          ),
        })}
      />,
    );

    expect(screen.getAllByTestId('recent-event')).toHaveLength(10);
    fireEvent.click(screen.getByText('system.recentEvents.showAll:{"count":12}'));
    expect(screen.getAllByTestId('recent-event')).toHaveLength(12);
  });

  it('shows an empty state without events', () => {
    render(<RecentEventList status={buildStatus()} />);
    expect(screen.getByText('system.recentEvents.empty')).toBeTruthy();
  });
});
