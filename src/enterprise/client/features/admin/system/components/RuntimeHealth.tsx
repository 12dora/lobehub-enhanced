'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Bot,
  Brain,
  Bug,
  CheckCircle2,
  Clock,
  Container,
  Gauge,
  MessageSquare,
  Timer,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminSystemStatus } from '@/enterprise/client/services/adminSystem';

import type {
  AdminSystemCapabilityRow,
  AdminSystemRecentEventRow,
  AdminSystemRuntimeErrorRow,
  AdminSystemWorkerRow,
  StatusProblemSeverity,
  Translate,
} from '../statusHealth';
import {
  describeCapabilityReason,
  describeEventSource,
  describeProblem,
  formatAbsoluteTime,
  formatInterval,
  formatRelativeTime,
  runtimeErrorSeverity,
  sortRecentEvents,
  subsystemLabel,
  summarizeStatus,
  workerLabel,
} from '../statusHealth';
import { OperationalStatus } from './OperationalStatus';
import { SectionHeader } from './SectionHeader';

const styles = createStaticStyles(({ css }) => ({
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  eventList: css`
    display: flex;
    flex-direction: column;
  `,
  eventRow: css`
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 4px 12px;
    align-items: baseline;

    padding-block: 8px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    @media (width <= 640px) {
      grid-template-columns: auto minmax(0, 1fr);
    }
  `,
  eventTime: css`
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;

    @media (width <= 640px) {
      grid-column: 2;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 8px;
  `,
  small: css`
    font-size: ${cssVar.fontSizeSM};
  `,
  tile: css`
    min-width: 0;
    height: 100%;
  `,
  /** Doubled selector so the accent wins over Block's own outlined border. */
  toneError: css`
    && {
      border-color: ${cssVar.colorErrorBorder};
      box-shadow: inset 3px 0 0 ${cssVar.colorError};
    }
  `,
  toneWarning: css`
    && {
      border-color: ${cssVar.colorWarningBorder};
      box-shadow: inset 3px 0 0 ${cssVar.colorWarning};
    }
  `,
}));

const toneClassName = (severity: StatusProblemSeverity | null): string =>
  severity === 'error'
    ? `${styles.tile} ${styles.toneError}`
    : severity === 'warning'
      ? `${styles.tile} ${styles.toneWarning}`
      : styles.tile;

const statusSeverity = (status: string): StatusProblemSeverity | null =>
  status === 'unavailable' ? 'error' : status === 'degraded' ? 'warning' : null;

const textTypeOf = (severity: StatusProblemSeverity | null) =>
  severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'secondary';

const EmptyBlock = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <Block data-testid={testId} padding={16} variant="outlined">
    <Text type="secondary">{children}</Text>
  </Block>
);

/** Relative time with the absolute timestamp on hover. */
const TimeAgo = ({
  at,
  className,
  now,
  template,
}: {
  at: Date | null | undefined;
  className?: string;
  now: Date;
  /** Wraps the relative time, e.g. 「上次心跳 {{time}}」. */
  template?: (time: string) => string;
}) => {
  const { t } = useTranslation('admin');
  const relative = formatRelativeTime(at, now, t as never);
  if (!relative) return null;
  return (
    <Text className={className} title={formatAbsoluteTime(at)} type="secondary">
      {template ? template(relative) : relative}
    </Text>
  );
};

/** Error text is clipped to two lines; long ones get an expand toggle. */
const EXPANDABLE_ERROR_MIN_LENGTH = 140;

export const ExpandableError = memo<{ text: string }>(({ text }) => {
  const { t } = useTranslation('admin');
  const [expanded, setExpanded] = useState(false);
  const expandable = text.length > EXPANDABLE_ERROR_MIN_LENGTH || text.includes('\n');
  const clamped = expandable && !expanded;

  return (
    <Flexbox align="flex-start" gap={2}>
      <Text
        className={styles.code}
        data-testid="runtime-error-text"
        lineClamp={clamped ? 2 : undefined}
        title={clamped ? text : undefined}
        type="danger"
      >
        {text}
      </Text>
      {expandable ? (
        <Button
          outdent
          aria-expanded={expanded}
          size="small"
          type="text"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('system.runtimeErrors.collapse') : t('system.runtimeErrors.expand')}
        </Button>
      ) : null}
    </Flexbox>
  );
});

ExpandableError.displayName = 'AdminSystemExpandableError';

// ─── Header summary ─────────────────────────────────────────────────────────

const SUMMARY_NAME_LIMIT = 5;

const SUMMARY_ICON = { error: XCircle, success: CheckCircle2, warning: AlertTriangle } as const;

/**
 * 「全部正常」 only when every dependency, capability and worker is healthy and no
 * runtime error was recorded in 24h. Gray (未配置 / 已禁用) items never count.
 */
export const StatusSummaryBadge = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const translate = t as never as Translate;
  const { problems, tone } = summarizeStatus(status);
  const names = problems.map((problem) => describeProblem(problem, translate));
  const shown = names.slice(0, SUMMARY_NAME_LIMIT).join(t('system.summary.separator'));
  const hidden = names.length - SUMMARY_NAME_LIMIT;

  return (
    <Flexbox horizontal align="center" data-testid="system-status-summary" gap={8} wrap="wrap">
      <Tag color={tone} icon={<Icon icon={SUMMARY_ICON[tone]} size={12} />}>
        {problems.length === 0
          ? t('system.summary.allHealthy')
          : t('system.summary.problems', { count: problems.length })}
      </Tag>
      {problems.length > 0 ? (
        <Text type="secondary">
          {hidden > 0 ? `${shown} ${t('system.summary.more', { count: hidden })}` : shown}
        </Text>
      ) : null}
    </Flexbox>
  );
});

StatusSummaryBadge.displayName = 'AdminSystemStatusSummaryBadge';

// ─── Capabilities ───────────────────────────────────────────────────────────

const CAPABILITY_ICON: Record<AdminSystemCapabilityRow['key'], LucideIcon> = {
  dingtalk_connector: MessageSquare,
  dingtalk_personal: UserRoundCheck,
  memory_embedding: Brain,
  sandbox: Container,
  system_agent_models: Bot,
};

/** Off-but-unconfigured capabilities whose hint says where to configure them. */
const HINT_WHEN_DISABLED = new Set<AdminSystemCapabilityRow['key']>([
  'dingtalk_connector',
  'dingtalk_personal',
  'memory_embedding',
]);

const CapabilityTile = memo<{ capability: AdminSystemCapabilityRow }>(({ capability }) => {
  const { t } = useTranslation('admin');
  const severity = statusSeverity(capability.status);
  const showHint =
    severity !== null ||
    (capability.status === 'disabled' && HINT_WHEN_DISABLED.has(capability.key));
  const reason = describeCapabilityReason(capability.reason, t as never);

  return (
    <Block
      className={toneClassName(severity)}
      data-status={capability.status}
      data-testid="capability-tile"
      padding={12}
      variant="outlined"
    >
      <Flexbox gap={6}>
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
            <Icon icon={CAPABILITY_ICON[capability.key] ?? Gauge} size={16} />
            <Text strong ellipsis={{ tooltip: true, tooltipWhenOverflow: true }}>
              {t(`system.capabilities.${capability.key}` as never)}
            </Text>
          </Flexbox>
          <OperationalStatus status={capability.status} />
        </Flexbox>
        {reason ? <Text type={textTypeOf(severity)}>{reason}</Text> : null}
        {capability.detail ? (
          <Text
            className={styles.small}
            lineClamp={3}
            title={capability.detail}
            type="secondary"
            wordBreak="break-word"
          >
            {capability.detail}
          </Text>
        ) : null}
        {showHint ? (
          <Text className={styles.small} type="secondary">
            {t(`system.capabilities.hint.${capability.key}` as never)}
          </Text>
        ) : null}
      </Flexbox>
    </Block>
  );
});

CapabilityTile.displayName = 'AdminSystemCapabilityTile';

export const CapabilityReadiness = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const capabilities = status.capabilities ?? [];

  return (
    <Flexbox gap={8}>
      <SectionHeader
        help={t('system.capabilities.help')}
        icon={Gauge}
        title={t('system.capabilities.title')}
      />
      {capabilities.length === 0 ? (
        <EmptyBlock>{t('system.capabilities.empty')}</EmptyBlock>
      ) : (
        <div className={styles.grid}>
          {capabilities.map((capability) => (
            <CapabilityTile capability={capability} key={capability.key} />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

CapabilityReadiness.displayName = 'AdminSystemCapabilityReadiness';

// ─── Background workers ─────────────────────────────────────────────────────

const WorkerTile = memo<{ now: Date; worker: AdminSystemWorkerRow }>(({ now, worker }) => {
  const { t } = useTranslation('admin');
  const severity = statusSeverity(worker.status);
  const note = !worker.started
    ? t('system.workers.notStarted')
    : worker.status === 'degraded'
      ? t('system.workers.stale')
      : null;

  return (
    <Block
      className={toneClassName(severity)}
      data-status={worker.status}
      data-testid="worker-tile"
      padding={12}
      variant="outlined"
    >
      <Flexbox gap={6}>
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Text strong ellipsis={{ tooltip: true, tooltipWhenOverflow: true }}>
            {workerLabel(worker.name, t as never)}
          </Text>
          <OperationalStatus status={worker.status} />
        </Flexbox>
        <Flexbox horizontal className={styles.small} gap={8} wrap="wrap">
          {worker.lastTickAt ? (
            <TimeAgo
              at={worker.lastTickAt}
              now={now}
              template={(time) => t('system.workers.lastTick', { time })}
            />
          ) : (
            <Text type="secondary">{t('system.workers.noTick')}</Text>
          )}
          <Text type="secondary">{formatInterval(worker.intervalMs, t as never)}</Text>
        </Flexbox>
        {note ? <Text type={textTypeOf(severity ?? 'warning')}>{note}</Text> : null}
        {worker.lastError ? <ExpandableError text={worker.lastError} /> : null}
      </Flexbox>
    </Block>
  );
});

WorkerTile.displayName = 'AdminSystemWorkerTile';

export const WorkerHealthList = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const workers = status.workers ?? [];

  return (
    <Flexbox gap={8}>
      <SectionHeader
        help={t('system.workers.help')}
        icon={Timer}
        title={t('system.workers.title')}
      />
      {workers.length === 0 ? (
        <EmptyBlock>{t('system.workers.empty')}</EmptyBlock>
      ) : (
        <div className={styles.grid}>
          {workers.map((worker) => (
            <WorkerTile key={worker.name} now={status.snapshotAt} worker={worker} />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

WorkerHealthList.displayName = 'AdminSystemWorkerHealthList';

// ─── Runtime errors (24h) ───────────────────────────────────────────────────

const RuntimeErrorRow = memo<{ now: Date; row: AdminSystemRuntimeErrorRow }>(({ now, row }) => {
  const { t } = useTranslation('admin');
  const severity = runtimeErrorSeverity(row, now);

  return (
    <Block
      className={toneClassName(severity)}
      data-severity={severity}
      data-testid="runtime-error-row"
      padding={12}
      variant="outlined"
    >
      <Flexbox gap={6}>
        <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
          <Flexbox horizontal align="center" gap={8}>
            <Text strong>{subsystemLabel(row.subsystem, t as never)}</Text>
            <Tag color={severity} size="small">
              {t('system.runtimeErrors.count', { count: row.count24h })}
            </Tag>
          </Flexbox>
          <TimeAgo
            at={row.lastAt}
            className={styles.small}
            now={now}
            template={(time) => t('system.runtimeErrors.lastAt', { time })}
          />
        </Flexbox>
        {row.lastError ? <ExpandableError text={row.lastError} /> : null}
      </Flexbox>
    </Block>
  );
});

RuntimeErrorRow.displayName = 'AdminSystemRuntimeErrorRow';

export const RuntimeErrorList = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const rows = (status.runtimeErrors ?? [])
    .filter((row) => row.count24h > 0)
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  return (
    <Flexbox gap={8}>
      <SectionHeader icon={Bug} title={t('system.runtimeErrors.title')} />
      {rows.length === 0 ? (
        <EmptyBlock testId="runtime-errors-empty">{t('system.runtimeErrors.empty')}</EmptyBlock>
      ) : (
        <Flexbox gap={8}>
          {rows.map((row) => (
            <RuntimeErrorRow key={row.subsystem} now={status.snapshotAt} row={row} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

RuntimeErrorList.displayName = 'AdminSystemRuntimeErrorList';

// ─── Recent events ──────────────────────────────────────────────────────────

const RECENT_EVENTS_PREVIEW = 10;

const EVENT_LEVEL_COLOR: Record<AdminSystemRecentEventRow['level'], string> = {
  error: 'error',
  info: 'success',
  warning: 'warning',
};

export const RecentEventList = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const [showAll, setShowAll] = useState(false);
  const events = sortRecentEvents(status.recentEvents ?? []);
  const visible = showAll ? events : events.slice(0, RECENT_EVENTS_PREVIEW);

  return (
    <Flexbox gap={8}>
      <SectionHeader icon={Clock} title={t('system.recentEvents.title')} />
      {events.length === 0 ? (
        <EmptyBlock>{t('system.recentEvents.empty')}</EmptyBlock>
      ) : (
        <Block paddingBlock={4} paddingInline={12} variant="outlined">
          <div className={styles.eventList}>
            {visible.map((event, index) => (
              <div
                className={styles.eventRow}
                data-testid="recent-event"
                key={`${new Date(event.at).getTime()}:${event.subsystem}:${index}`}
              >
                <Tag color={EVENT_LEVEL_COLOR[event.level]} size="small">
                  {t(`system.recentEvents.level.${event.level}` as never)}
                </Tag>
                <Flexbox gap={2} style={{ minWidth: 0 }}>
                  <Text strong className={styles.small}>
                    {describeEventSource(event.subsystem, t as never)}
                  </Text>
                  <Text wordBreak="break-word">{event.message}</Text>
                </Flexbox>
                <TimeAgo at={event.at} className={styles.eventTime} now={status.snapshotAt} />
              </div>
            ))}
          </div>
          {events.length > RECENT_EVENTS_PREVIEW ? (
            <Flexbox paddingBlock={4}>
              <Button outdent size="small" type="text" onClick={() => setShowAll((v) => !v)}>
                {showAll
                  ? t('system.recentEvents.showLess')
                  : t('system.recentEvents.showAll', { count: events.length })}
              </Button>
            </Flexbox>
          ) : null}
        </Block>
      )}
    </Flexbox>
  );
});

RecentEventList.displayName = 'AdminSystemRecentEventList';
