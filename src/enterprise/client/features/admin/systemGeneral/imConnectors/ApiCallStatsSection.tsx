'use client';

import { Text } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminImConnectorApiCallStats } from '@/enterprise/client/services/adminImConnectors';
import { adminImConnectorsService } from '@/enterprise/client/services/adminImConnectors';
import { useClientDataSWR } from '@/libs/swr';

import { infraFormStyles as formStyles } from '../infra/styles';
import { imConnectorStyles as styles } from './styles';

/** The window the block reports on. Fixed: this is a reading, not a report builder. */
export const IM_CONNECTOR_API_STATS_DAYS = 30;

/** Today's busiest APIs; past this the tail is noise an administrator cannot act on. */
export const IM_CONNECTOR_API_STATS_TOP = 8;

/** The counters as the contract defines them (`adminImConnectorApiCallStatsOutputSchema`). */
export type ImConnectorApiCallStats = AdminImConnectorApiCallStats;

export type ImConnectorApiCallDay = ImConnectorApiCallStats['days'][number];

/**
 * `admin.imConnectors.apiCallStats`, narrowed to the one call this block makes, so a test can inject
 * a stub without standing up the whole client service.
 */
export interface ImConnectorApiStatsService {
  apiCallStats: (input: { days: number }) => Promise<ImConnectorApiCallStats>;
}

const defaultApiStatsService: ImConnectorApiStatsService = adminImConnectorsService;

const ADMIN_IM_CONNECTOR_API_STATS_KEY = 'admin:imConnectors:apiCallStats';

/**
 * Newest day first.
 *
 * The dates are `YYYY-MM-DD`, which sorts correctly as text, so the order is derived rather than
 * assumed: a server that answers oldest-first — or skips a silent day — still reads right.
 */
const byDateDescending = (days: ImConnectorApiCallDay[]): ImConnectorApiCallDay[] =>
  [...days].sort((left, right) => right.date.localeCompare(left.date));

export interface ApiCallStatsSectionProps {
  /** Injectable for tests. */
  service?: ImConnectorApiStatsService;
}

/**
 * 接口调用量 — how much the 工作台能力 above are actually being used.
 *
 * Read-only by design: DingTalk meters these calls per app, so an administrator comes here to find
 * out whether a capability is worth leaving on and which API is spending the quota. Today's top
 * APIs answer that at a glance; the 30-day breakdown sits behind a disclosure because it is only
 * read when one day looks wrong.
 */
export const ApiCallStatsSection = memo<ApiCallStatsSectionProps>(
  ({ service = defaultApiStatsService }) => {
    const { t } = useTranslation('admin');

    const { data, error, isLoading } = useClientDataSWR(
      [ADMIN_IM_CONNECTOR_API_STATS_KEY, IM_CONNECTOR_API_STATS_DAYS] as const,
      () => service.apiCallStats({ days: IM_CONNECTOR_API_STATS_DAYS }),
      { keepPreviousData: true, revalidateOnFocus: false },
    );

    const days = useMemo(() => byDateDescending(data?.days ?? []), [data]);
    const today = days[0];
    const topApis = (today?.byApi ?? []).slice(0, IM_CONNECTOR_API_STATS_TOP);

    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>
          {t('systemGeneral.imConnectors.apiStats.title')}
        </span>
        <span className={formStyles.hint}>
          {t('systemGeneral.imConnectors.apiStats.description')}
        </span>

        {/* A failed read must never read as zero calls: the quota decision would then be made on a
            number the server never gave. A reading that HAS settled survives a failed refresh, the
            same precedence `AsyncBoundary` applies elsewhere. */}
        {error && !data ? (
          <Text type="danger">{t('systemGeneral.imConnectors.apiStats.loadFailed')}</Text>
        ) : null}

        {!data && !error ? (
          <Text type="secondary">
            {isLoading
              ? t('systemGeneral.imConnectors.apiStats.loading')
              : t('systemGeneral.imConnectors.apiStats.empty')}
          </Text>
        ) : null}

        {data && data.total === 0 ? (
          <Text type="secondary">{t('systemGeneral.imConnectors.apiStats.empty')}</Text>
        ) : null}

        {data && data.total > 0 ? (
          <>
            <span className={styles.stats}>
              {[
                t('systemGeneral.imConnectors.apiStats.total', {
                  days: IM_CONNECTOR_API_STATS_DAYS,
                  value: data.total,
                }),
                t('systemGeneral.imConnectors.apiStats.today', { value: today?.total ?? 0 }),
              ].join(' · ')}
            </span>

            {topApis.length > 0 ? (
              <table className={styles.bindingsTable}>
                <thead>
                  <tr>
                    <th scope="col">{t('systemGeneral.imConnectors.apiStats.column.api')}</th>
                    <th scope="col">{t('systemGeneral.imConnectors.apiStats.column.count')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topApis.map((row) => (
                    <tr key={row.api}>
                      <td>{row.api}</td>
                      <td className={styles.code}>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Text type="secondary">{t('systemGeneral.imConnectors.apiStats.emptyToday')}</Text>
            )}

            <details className={styles.statsDetails}>
              <summary>
                {t('systemGeneral.imConnectors.apiStats.expand', {
                  days: IM_CONNECTOR_API_STATS_DAYS,
                })}
              </summary>
              <div className={styles.bindingsScroll}>
                <table className={styles.bindingsTable}>
                  <thead>
                    <tr>
                      <th scope="col">{t('systemGeneral.imConnectors.apiStats.column.date')}</th>
                      <th scope="col">{t('systemGeneral.imConnectors.apiStats.column.count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day.date}>
                        <td className={styles.code}>{day.date}</td>
                        <td className={styles.code}>{day.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : null}
      </div>
    );
  },
);

ApiCallStatsSection.displayName = 'AdminImConnectorApiCallStatsSection';
