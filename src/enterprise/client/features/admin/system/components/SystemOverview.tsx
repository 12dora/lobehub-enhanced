'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Alert, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  Box,
  Boxes,
  CircleAlert,
  Container,
  FileImage,
  KeyRound,
  Mail,
  Network,
  Server,
  Waypoints,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  deriveSsoPresentation,
  type SsoAuthSnapshot,
} from '@/enterprise/client/features/admin/system/controller';
import type { AdminSystemStatus } from '@/enterprise/client/services/adminSystem';

import { formatAbsoluteTime, formatRelativeTime } from '../statusHealth';
import { OperationalStatus } from './OperationalStatus';

const styles = createStaticStyles(({ css }) => ({
  build: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;

    @media (width <= 640px) {
      grid-template-columns: 1fr;
    }
  `,
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  `,
  dependency: css`
    min-width: 0;
    height: 100%;
  `,
  dependencyGrid: css`
    display: grid;
    grid-auto-rows: 1fr;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
  `,
  /** Two fixed-height lines so every tile is the same height whatever the copy says. */
  dependencyLine: css`
    overflow: hidden;

    min-width: 0;

    font-size: ${cssVar.fontSizeSM};
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  dependencyLines: css`
    min-height: 40px;
  `,
  /** Doubled selector so the accent wins over Block's own outlined border. */
  dependencyToneError: css`
    && {
      border-color: ${cssVar.colorErrorBorder};
      box-shadow: inset 3px 0 0 ${cssVar.colorError};
    }
  `,
  dependencyToneWarning: css`
    && {
      border-color: ${cssVar.colorWarningBorder};
      box-shadow: inset 3px 0 0 ${cssVar.colorWarning};
    }
  `,
  flagGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
  `,
  sectionTitle: css`
    margin: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: ${cssVar.fontWeightStrong};
  `,
}));

const DEPENDENCIES = [
  ['database', Boxes],
  ['redis', Network],
  ['objectStorage', Box],
  ['mail', Mail],
  ['keyManagement', KeyRound],
] as const;

type DependencyHealth = AdminSystemStatus['dependencies']['database'];

/**
 * `image` is read when the server reports it; older builds only name the image
 * inside `lastError` (「沙箱镜像 … 不存在（拉取策略 never）」).
 */
type SandboxHealth = NonNullable<AdminSystemStatus['dependencies']['sandbox']> & {
  image?: string;
};

const ELLIPSIS = { tooltip: true, tooltipWhenOverflow: true } as const;

interface DependencyTileProps {
  /** When the probe last ran; shown relative to the snapshot. */
  checkedAt: Date | null;
  icon: LucideIcon;
  /** Snapshot time the relative "checked" time is measured from. */
  now: Date;
  /** What this dependency is — provider / engine / target, plus version when known. */
  primary: ReactNode;
  /** How it is doing — error, latency, or the workload it is carrying. */
  secondary: ReactNode;
  /** Set when line 2 is an error, so it renders in the status colour. */
  secondaryIsError?: boolean;
  status: string;
  title: string;
}

const dependencyToneClassName = (status: string): string =>
  status === 'unavailable'
    ? `${styles.dependency} ${styles.dependencyToneError}`
    : status === 'degraded'
      ? `${styles.dependency} ${styles.dependencyToneWarning}`
      : styles.dependency;

/**
 * Every dependency renders the exact same shape: a header row, exactly two
 * single-line info rows and one "checked" row, so the grid never gets stretched
 * by one chatty tile. A failed probe keeps its tile, in red, with its error.
 */
const DependencyTile = memo<DependencyTileProps>(
  ({ checkedAt, icon, now, primary, secondary, secondaryIsError, status, title }) => {
    const { t } = useTranslation('admin');
    const checked = formatRelativeTime(checkedAt, now, t as never);
    const secondaryType = !secondaryIsError
      ? 'secondary'
      : status === 'unavailable'
        ? 'danger'
        : status === 'degraded'
          ? 'warning'
          : 'secondary';

    return (
      <Block
        className={dependencyToneClassName(status)}
        data-status={status}
        data-testid="dependency-tile"
        padding={12}
        variant="outlined"
      >
        <Flexbox gap={8}>
          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <Icon icon={icon} size={16} />
              <Text strong ellipsis={ELLIPSIS}>
                {title}
              </Text>
            </Flexbox>
            <OperationalStatus status={status} />
          </Flexbox>
          <Flexbox className={styles.dependencyLines} gap={0}>
            <Text
              className={styles.dependencyLine}
              data-testid="dependency-line"
              ellipsis={ELLIPSIS}
              type="secondary"
            >
              {primary}
            </Text>
            <Text
              className={styles.dependencyLine}
              data-testid="dependency-line"
              ellipsis={ELLIPSIS}
              type={secondaryType}
            >
              {secondary}
            </Text>
          </Flexbox>
          <Text
            className={styles.dependencyLine}
            data-testid="dependency-checked-at"
            title={formatAbsoluteTime(checkedAt) || undefined}
            type="secondary"
          >
            {checked
              ? t('system.dependencies.checkedAt', { time: checked })
              : t('system.dependencies.neverChecked')}
          </Text>
        </Flexbox>
      </Block>
    );
  },
);

DependencyTile.displayName = 'AdminSystemDependencyTile';

interface SectionTitleProps {
  children: ReactNode;
}

const SectionTitle = ({ children }: SectionTitleProps) => (
  <Text as="h2" className={styles.sectionTitle}>
    {children}
  </Text>
);

export const BuildSummary = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  return (
    <Block className={styles.build} padding={16} variant="outlined">
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={Server} size={18} />
          <Text strong>{t('system.build.title')}</Text>
        </Flexbox>
        <Text className={styles.code}>{status.build.version}</Text>
      </Flexbox>
      <Flexbox gap={4}>
        <Text type="secondary">{t('system.snapshotAt')}</Text>
        <Text>{status.snapshotAt.toLocaleString()}</Text>
      </Flexbox>
    </Block>
  );
});

BuildSummary.displayName = 'AdminSystemBuildSummary';

export const DependencyGrid = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const documentRender = status.dependencies.documentRender;
  const sandbox = status.dependencies.sandbox;

  /** Line 1 — what is configured. Falls back to the plain state when nothing is reported. */
  const describe = (dependency: DependencyHealth, fallback: string): string => {
    if (dependency.detail)
      return dependency.version ? `${dependency.detail} ${dependency.version}` : dependency.detail;
    if (dependency.status === 'disabled') return t('system.dependencies.notEnabled');
    if (dependency.status === 'unknown') return t('system.dependencies.notConfigured');
    return fallback;
  };

  /** Line 2 — how it is doing. Errors first, then the measured round trip. */
  const diagnose = (dependency: DependencyHealth, lastError?: string): string => {
    if (lastError) return lastError;
    if (dependency.errorCategory)
      return t(`system.values.dependencyError.${dependency.errorCategory}` as never);
    if (typeof dependency.latencyMs === 'number')
      return t('system.dependencies.latency', { ms: dependency.latencyMs });
    if (dependency.status === 'healthy') return t('system.dependencies.noLiveCheck');
    return '—';
  };

  /**
   * Line 1 for the sandbox — daemon, image and pull policy. A missing image is
   * the red part; while the daemon is unreachable the image state is unknown.
   */
  const describeSandbox = (value: SandboxHealth): ReactNode => {
    const policy = value.pullPolicy
      ? t('system.sandbox.pullPolicy', {
          policy: t(`systemGeneral.sandbox.pullPolicy.${value.pullPolicy}` as never),
        })
      : null;
    if (!value.daemonReachable) {
      return (
        <>
          <Text as="span" type="danger">
            {t('system.sandbox.daemonDown')}
          </Text>
          {policy ? ` · ${policy}` : null}
        </>
      );
    }
    const image = value.image
      ? t(
          value.imagePresent
            ? 'system.sandbox.imageNamedReady'
            : 'system.sandbox.imageNamedMissing',
          {
            image: value.image,
          },
        )
      : t(value.imagePresent ? 'system.sandbox.imageReady' : 'system.sandbox.imageMissing');
    if (value.imagePresent) {
      return [t('system.sandbox.daemonUp'), image, policy].filter(Boolean).join(' · ');
    }
    return (
      <>
        {`${t('system.sandbox.daemonUp')} · `}
        <Text as="span" data-testid="sandbox-image-missing" type="danger">
          {image}
        </Text>
        {policy ? ` · ${policy}` : null}
      </>
    );
  };

  /** Healthy render sidecar can still have failed jobs; append them in amber. */
  const withFailedRenders = (queue: string, failed24h: number | undefined): ReactNode =>
    failed24h && failed24h > 0 ? (
      <>
        {`${queue} · `}
        <Text as="span" type="warning">
          {t('system.documentRender.failed24h', { count: failed24h })}
        </Text>
      </>
    ) : (
      queue
    );

  return (
    <Flexbox gap={8}>
      <SectionTitle>{t('system.dependencies.title')}</SectionTitle>
      <div className={styles.dependencyGrid}>
        {DEPENDENCIES.map(([key, icon]) => {
          const dependency = status.dependencies[key];
          const title = t(`system.dependencies.${key}` as never);
          return (
            <DependencyTile
              checkedAt={dependency.lastCheckedAt}
              icon={icon}
              key={key}
              now={status.snapshotAt}
              primary={describe(dependency, title)}
              secondary={diagnose(dependency)}
              secondaryIsError={Boolean(dependency.errorCategory)}
              status={dependency.status}
              title={title}
            />
          );
        })}
        {sandbox ? (
          <DependencyTile
            checkedAt={sandbox.lastCheckedAt}
            icon={Container}
            key="sandbox"
            now={status.snapshotAt}
            primary={describeSandbox(sandbox)}
            secondaryIsError={Boolean(sandbox.lastError || sandbox.errorCategory)}
            status={sandbox.status}
            title={t('system.dependencies.sandbox')}
            secondary={
              sandbox.lastError || sandbox.errorCategory
                ? diagnose(sandbox, sandbox.lastError)
                : t('system.sandbox.containersInUse', {
                    active: sandbox.activeContainers,
                    max: sandbox.maxContainers,
                  })
            }
          />
        ) : null}
        {documentRender ? (
          <DependencyTile
            checkedAt={documentRender.lastCheckedAt}
            icon={FileImage}
            key="documentRender"
            now={status.snapshotAt}
            secondaryIsError={Boolean(documentRender.lastError || documentRender.errorCategory)}
            status={documentRender.status}
            title={t('system.dependencies.documentRender')}
            primary={
              documentRender.configured
                ? describe(documentRender, t('system.dependencies.documentRender'))
                : t('system.documentRender.notConfigured')
            }
            secondary={
              !documentRender.lastError &&
              !documentRender.errorCategory &&
              documentRender.status === 'healthy'
                ? withFailedRenders(
                    t('system.documentRender.queue', {
                      pending: documentRender.queuePending,
                      running: documentRender.queueRunning,
                    }),
                    documentRender.failed24h,
                  )
                : diagnose(documentRender, documentRender.lastError)
            }
          />
        ) : null}
      </div>
      {status.instanceStatus.status === 'unavailable' ||
      status.instanceStatus.status === 'degraded' ? (
        <Alert
          showIcon
          title={t('system.instances.partialUnavailable')}
          type="warning"
          description={
            status.instanceStatus.errorCategory
              ? t(`system.values.dependencyError.${status.instanceStatus.errorCategory}` as never)
              : undefined
          }
        />
      ) : null}
    </Flexbox>
  );
});

DependencyGrid.displayName = 'AdminSystemDependencyGrid';

export const OidcSummary = memo<{
  snapshot?: SsoAuthSnapshot | null;
  status: AdminSystemStatus;
}>(({ snapshot, status }) => {
  const { t } = useTranslation('admin');
  const presentation = deriveSsoPresentation({ oidc: status.oidc, snapshot });
  const description =
    presentation.kind === 'attention' && presentation.degradedCategory
      ? t(`identityProviders.values.degraded.${presentation.degradedCategory}` as never)
      : t(presentation.descriptionKey);

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={Waypoints} size={18} />
        <SectionTitle>{t('system.oidc.title')}</SectionTitle>
      </Flexbox>
      <Block padding={16} variant="outlined">
        <Flexbox gap={8}>
          <Tag color={presentation.tone} size="small">
            {t(presentation.labelKey)}
          </Tag>
          <Text type="secondary">{description}</Text>
          {presentation.showSource ? (
            <Text type="secondary">
              {t('system.oidc.source', {
                source: t(`system.values.oidcSource.${status.oidc.source}` as never),
              })}
            </Text>
          ) : null}
        </Flexbox>
      </Block>
    </Flexbox>
  );
});

OidcSummary.displayName = 'AdminSystemOidcSummary';

export const JobsSummary = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const jobs = status.jobs;
  return (
    <Flexbox gap={8}>
      {/* 「后台任务」 now names the worker section; these are admin job-queue totals. */}
      <SectionTitle>{t('system.jobs.summaryCountsTitle')}</SectionTitle>
      {jobs.status === 'unavailable' ? (
        <Alert
          showIcon
          title={t('system.jobs.summaryUnavailable')}
          type="error"
          description={
            jobs.errorCategory
              ? t(`system.values.availabilityError.${jobs.errorCategory}` as never)
              : undefined
          }
        />
      ) : (
        <div className={styles.flagGrid}>
          {(['total', 'active', 'completed', 'failed'] as const).map((key) => (
            <Block key={key} padding={12} variant="outlined">
              <Flexbox horizontal align="baseline" gap={8} justify="space-between">
                <Text type="secondary">{t(`system.jobs.summary.${key}` as never)}</Text>
                <Text strong className={styles.code}>
                  {jobs[key]}
                </Text>
              </Flexbox>
            </Block>
          ))}
        </div>
      )}
    </Flexbox>
  );
});

JobsSummary.displayName = 'AdminSystemJobsSummary';

export const PublishFailures = memo<{ status: AdminSystemStatus }>(({ status }) => {
  const { t } = useTranslation('admin');
  const failures = status.recentPublishFailures;
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={CircleAlert} size={18} />
        <SectionTitle>{t('system.publishFailures.title')}</SectionTitle>
      </Flexbox>
      {failures.status === 'unavailable' ? (
        <Alert
          showIcon
          title={t('system.publishFailures.unavailable')}
          type="error"
          description={
            failures.errorCategory
              ? t(`system.values.availabilityError.${failures.errorCategory}` as never)
              : undefined
          }
        />
      ) : failures.items.length === 0 ? (
        <Block padding={16} variant="outlined">
          <Text type="secondary">{t('system.publishFailures.empty')}</Text>
        </Block>
      ) : (
        <Flexbox gap={8}>
          <Text type="secondary">
            {t('system.publishFailures.count', { count: failures.count })}
          </Text>
          {failures.items.map((failure, index) => (
            <Block
              key={`${failure.domain}:${failure.occurredAt.toISOString()}:${index}`}
              padding={12}
              variant="outlined"
            >
              <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
                <Flexbox horizontal align="center" gap={8}>
                  <Text strong>{t(`system.values.domain.${failure.domain}` as never)}</Text>
                  <Tag color="error" size="small">
                    {t(`system.values.publishFailure.${failure.category}` as never)}
                  </Tag>
                </Flexbox>
                <Text className={styles.code} type="secondary">
                  {failure.occurredAt.toLocaleString()}
                </Text>
              </Flexbox>
            </Block>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

PublishFailures.displayName = 'AdminSystemPublishFailures';
