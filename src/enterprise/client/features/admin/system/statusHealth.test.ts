import { describe, expect, it } from 'vitest';

import type { AdminSystemStatus } from '@/enterprise/client/services/adminSystem';

import {
  collectStatusProblems,
  describeCapabilityReason,
  describeEventSource,
  describeProblem,
  formatInterval,
  formatRelativeTime,
  runtimeErrorSeverity,
  sortRecentEvents,
  summarizeStatus,
} from './statusHealth';

const t = (key: string, values?: Record<string, unknown>) => {
  const rest = { ...values };
  delete rest.defaultValue;
  return Object.keys(rest).length > 0 ? `${key}:${JSON.stringify(rest)}` : key;
};

const SNAPSHOT = new Date('2026-09-23T08:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(SNAPSHOT.getTime() - minutes * 60_000);

const healthy = { errorCategory: null, lastCheckedAt: SNAPSHOT, status: 'healthy' as const };

type Dependencies = AdminSystemStatus['dependencies'];

const buildStatus = (overrides: {
  capabilities?: AdminSystemStatus['capabilities'];
  dependencies?: Partial<Dependencies>;
  runtimeErrors?: AdminSystemStatus['runtimeErrors'];
  workers?: AdminSystemStatus['workers'];
}): AdminSystemStatus =>
  ({
    capabilities: overrides.capabilities ?? [
      { key: 'memory_embedding', status: 'healthy' },
      { key: 'system_agent_models', status: 'healthy' },
      { key: 'dingtalk_connector', status: 'healthy' },
      { key: 'sandbox', status: 'disabled' },
    ],
    dependencies: {
      database: healthy,
      keyManagement: healthy,
      mail: healthy,
      objectStorage: healthy,
      redis: healthy,
      ...overrides.dependencies,
    },
    recentEvents: [],
    runtimeErrors: overrides.runtimeErrors ?? [],
    snapshotAt: SNAPSHOT,
    workers: overrides.workers ?? [
      {
        intervalMs: 60_000,
        lastTickAt: minutesAgo(0.5),
        name: 'reminder',
        started: true,
        startedAt: minutesAgo(60),
        status: 'healthy',
      },
    ],
  }) as unknown as AdminSystemStatus;

const sandboxTile = (status: 'healthy' | 'unavailable'): Dependencies['sandbox'] => ({
  activeContainers: 0,
  daemonReachable: true,
  errorCategory: status === 'healthy' ? null : 'operation_unavailable',
  imagePresent: status === 'healthy',
  lastCheckedAt: SNAPSHOT,
  maxContainers: 4,
  status,
});

describe('summarizeStatus', () => {
  it('reports 全部正常 only when everything is healthy and no runtime error was recorded', () => {
    expect(summarizeStatus(buildStatus({}))).toEqual({ problems: [], tone: 'success' });
  });

  it('does not count gray 未配置 / 已禁用 items as problems', () => {
    const summary = summarizeStatus(
      buildStatus({
        capabilities: [
          { key: 'memory_embedding', reason: '未配置记忆向量模型', status: 'disabled' },
          { key: 'system_agent_models', status: 'unknown' },
          { key: 'dingtalk_connector', status: 'disabled' },
          { key: 'sandbox', status: 'disabled' },
        ],
        dependencies: {
          documentRender: {
            configured: false,
            errorCategory: null,
            lastCheckedAt: null,
            queuePending: 0,
            queueRunning: 0,
            status: 'disabled',
          },
          mail: { errorCategory: 'passive_check_only', lastCheckedAt: null, status: 'unknown' },
        },
      }),
    );

    expect(summary).toEqual({ problems: [], tone: 'success' });
  });

  it('counts a capability the server marks unavailable (required but missing)', () => {
    const summary = summarizeStatus(
      buildStatus({
        capabilities: [
          { key: 'memory_embedding', reason: '记忆向量缺少可用密钥', status: 'unavailable' },
        ],
      }),
    );

    expect(summary.tone).toBe('error');
    expect(summary.problems).toEqual([
      { key: 'memory_embedding', severity: 'error', source: 'capability' },
    ]);
  });

  it('counts a missing sandbox image once, not once per surface', () => {
    const summary = summarizeStatus(
      buildStatus({
        capabilities: [{ key: 'sandbox', status: 'unavailable' }],
        dependencies: { sandbox: sandboxTile('unavailable') },
      }),
    );

    expect(summary.problems).toEqual([{ key: 'sandbox', severity: 'error', source: 'dependency' }]);
  });

  it('counts dependencies, capabilities, workers and runtime errors together', () => {
    const summary = summarizeStatus(
      buildStatus({
        capabilities: [{ key: 'system_agent_models', status: 'degraded' }],
        dependencies: {
          redis: { errorCategory: 'timeout', lastCheckedAt: SNAPSHOT, status: 'degraded' },
        },
        runtimeErrors: [
          {
            count24h: 4,
            lastAt: minutesAgo(3),
            lastError: '400 Bad Request',
            subsystem: 'system_agent',
          },
        ],
        workers: [
          {
            intervalMs: 60_000,
            lastTickAt: null,
            name: 'task_scheduler',
            started: false,
            startedAt: null,
            status: 'unavailable',
          },
        ],
      }),
    );

    expect(summary.tone).toBe('error');
    expect(summary.problems).toEqual([
      { key: 'redis', severity: 'warning', source: 'dependency' },
      { key: 'system_agent_models', severity: 'warning', source: 'capability' },
      { key: 'task_scheduler', severity: 'error', source: 'worker' },
      { key: 'system_agent', severity: 'error', source: 'runtime' },
    ]);
  });

  it('is amber, not red, when only warnings remain', () => {
    const summary = summarizeStatus(
      buildStatus({
        runtimeErrors: [
          { count24h: 1, lastAt: minutesAgo(300), lastError: 'boom', subsystem: 'memory' },
        ],
      }),
    );

    expect(summary.tone).toBe('warning');
    expect(summary.problems).toHaveLength(1);
  });

  it('tolerates an older server that omits the monitoring arrays', () => {
    const status = buildStatus({});
    const legacy = { ...status } as Partial<AdminSystemStatus>;
    delete legacy.capabilities;
    delete legacy.runtimeErrors;
    delete legacy.workers;

    expect(collectStatusProblems(legacy as AdminSystemStatus)).toEqual([]);
  });
});

describe('describeProblem', () => {
  it('labels each source with its own catalog', () => {
    expect(describeProblem({ key: 'sandbox', severity: 'error', source: 'dependency' }, t)).toBe(
      'system.dependencies.sandbox',
    );
    expect(
      describeProblem({ key: 'memory_embedding', severity: 'error', source: 'capability' }, t),
    ).toBe('system.capabilities.memory_embedding');
    expect(describeProblem({ key: 'reminder', severity: 'error', source: 'worker' }, t)).toBe(
      'system.workers.reminder',
    );
    expect(describeProblem({ key: 'memory', severity: 'error', source: 'runtime' }, t)).toBe(
      'system.summary.runtimeLabel:{"name":"system.subsystems.memory"}',
    );
  });
});

describe('runtimeErrorSeverity', () => {
  it('is red while the last failure is within the hour, amber after', () => {
    expect(runtimeErrorSeverity({ lastAt: minutesAgo(59) }, SNAPSHOT)).toBe('error');
    expect(runtimeErrorSeverity({ lastAt: minutesAgo(61) }, SNAPSHOT)).toBe('warning');
  });
});

describe('formatRelativeTime', () => {
  it('measures from the snapshot and picks the largest whole unit', () => {
    expect(formatRelativeTime(SNAPSHOT, SNAPSHOT, t)).toBe('system.relative.justNow');
    expect(formatRelativeTime(new Date(SNAPSHOT.getTime() - 45_000), SNAPSHOT, t)).toBe(
      'system.relative.seconds:{"count":45}',
    );
    expect(formatRelativeTime(minutesAgo(5), SNAPSHOT, t)).toBe(
      'system.relative.minutes:{"count":5}',
    );
    expect(formatRelativeTime(minutesAgo(125), SNAPSHOT, t)).toBe(
      'system.relative.hours:{"count":2}',
    );
    expect(formatRelativeTime(minutesAgo(60 * 50), SNAPSHOT, t)).toBe(
      'system.relative.days:{"count":2}',
    );
  });

  it('treats a time slightly after the snapshot as just now and a missing time as null', () => {
    expect(formatRelativeTime(new Date(SNAPSHOT.getTime() + 5000), SNAPSHOT, t)).toBe(
      'system.relative.justNow',
    );
    expect(formatRelativeTime(null, SNAPSHOT, t)).toBeNull();
    expect(formatRelativeTime('not a date', SNAPSHOT, t)).toBeNull();
  });
});

describe('formatInterval', () => {
  it('uses the largest unit that divides the interval', () => {
    expect(formatInterval(30_000, t)).toBe('system.interval.seconds:{"count":30}');
    expect(formatInterval(90_000, t)).toBe('system.interval.seconds:{"count":90}');
    expect(formatInterval(60_000, t)).toBe('system.interval.minutes:{"count":1}');
    expect(formatInterval(180_000, t)).toBe('system.interval.minutes:{"count":3}');
    expect(formatInterval(12 * 3_600_000, t)).toBe('system.interval.hours:{"count":12}');
  });
});

describe('describeEventSource', () => {
  it('maps alert ids to their catalog and plain names to subsystems', () => {
    expect(describeEventSource('dependency:sandbox', t)).toBe('system.dependencies.sandbox');
    expect(describeEventSource('worker:reminder', t)).toBe('system.workers.reminder');
    expect(describeEventSource('capability:memory_embedding', t)).toBe(
      'system.capabilities.memory_embedding',
    );
    expect(describeEventSource('spike:system_agent', t)).toBe('system.subsystems.system_agent');
    expect(describeEventSource('memory', t)).toBe('system.subsystems.memory');
    expect(describeEventSource('other:thing', t)).toBe('system.subsystems.other:thing');
  });
});

describe('describeCapabilityReason', () => {
  it('translates error categories and passes server sentences through', () => {
    expect(describeCapabilityReason('operation_unavailable', t)).toBe(
      'system.values.dependencyError.operation_unavailable',
    );
    expect(describeCapabilityReason('未配置记忆向量模型', t)).toBe('未配置记忆向量模型');
    expect(describeCapabilityReason(undefined, t)).toBeUndefined();
  });
});

describe('sortRecentEvents', () => {
  it('puts the newest event first without mutating the input', () => {
    const events = [
      { at: minutesAgo(10), level: 'info' as const, message: 'old', subsystem: 'memory' },
      { at: minutesAgo(1), level: 'error' as const, message: 'new', subsystem: 'memory' },
    ];

    expect(sortRecentEvents(events).map((event) => event.message)).toEqual(['new', 'old']);
    expect(events[0].message).toBe('old');
  });
});
