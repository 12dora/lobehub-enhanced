'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/BrandTextLoading';
import { ManagedResourceTransition, useManagedResource } from '@/features/ManagedResources';
import SettingContainer from '@/features/Setting/SettingContainer';

import ConnectorCard from './ConnectorCard';
import PlatformConnectorAuthorization from './PlatformConnectorAuthorization';
import { useConnectorAuthorizationActions } from './useConnectorAuthorizationActions';
import { useFetchManagedConnectors } from './useManagedConnectors';

/**
 * Enough to cover any realistic org catalog on this secondary strip. Browsing a
 * longer one belongs on the managed page, which has search and pagination.
 */
const PUBLISHED_STRIP_LIMIT = 20;

const styles = createStaticStyles(({ css }) => ({
  cards: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  catalog: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  shell: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  `,
  stripDescription: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  stripHeader: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-block-end: 12px;
  `,
  stripScroller: css`
    overflow-y: auto;
    flex-shrink: 0;

    max-height: 45%;
    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  stripTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface ManagedConnectorSettingsProps {
  fallback: ReactNode;
}

/**
 * Unmanaged deployments keep the ordinary catalog, but the organization may
 * still have published Connectors — until now those were reachable only from the
 * admin pages, so nobody could authorize one.
 *
 * They are shown as a bounded strip above the catalog, with its own scroller.
 * When nothing is published (the common case) — or the list cannot be read at
 * all — the strip renders nothing and the fallback stays exactly where it was:
 * the master-detail catalog only scrolls while its height chain is unbroken, so
 * an unconditional wrapper would silently clip it. No empty state and no error
 * box for the same reason: this is a secondary surface, not the page.
 */
const UnmanagedConnectorSettings = memo<ManagedConnectorSettingsProps>(({ fallback }) => {
  const { t } = useTranslation('setting');
  const location = useLocation();
  const { data } = useFetchManagedConnectors({ limit: PUBLISHED_STRIP_LIMIT });
  const { authorize, busyAction, busyConnectorId, cancelAuthorization, disconnect, feedback } =
    useConnectorAuthorizationActions();

  const publishedConnectors = data?.items ?? [];
  if (publishedConnectors.length === 0) return <>{fallback}</>;

  return (
    <div className={styles.shell}>
      <section className={styles.stripScroller}>
        <div className={styles.stripHeader}>
          <span className={styles.stripTitle}>{t('platformConnectors.title')}</span>
          <span className={styles.stripDescription}>{t('platformConnectors.description')}</span>
        </div>
        <div className={styles.cards}>
          {publishedConnectors.map((connector) => (
            <ConnectorCard
              actionsDisabled={Boolean(busyConnectorId)}
              authorizing={busyAction === 'authorize' && busyConnectorId === connector.id}
              busy={busyConnectorId === connector.id}
              connector={connector}
              feedback={feedback}
              key={connector.id}
              onAuthorize={(id) => void authorize(id, location.pathname)}
              onCancelAuthorization={cancelAuthorization}
              onDisconnect={(id) => void disconnect(id)}
            />
          ))}
        </div>
      </section>
      <div className={styles.catalog}>{fallback}</div>
    </div>
  );
});

UnmanagedConnectorSettings.displayName = 'UnmanagedConnectorSettings';

/**
 * Managed Connectors still require each user to authorize per-user OAuth credentials.
 * Keep that authorization surface on the canonical Connector settings route while
 * preserving the ordinary Tool settings fallback for unmanaged deployments.
 */
const ManagedConnectorSettings = memo<ManagedConnectorSettingsProps>(({ fallback }) => {
  const { error, loading, managed, refresh } = useManagedResource('connectors');

  const state = error ? 'error' : loading ? 'loading' : managed ? 'managed' : 'content';
  const content = error ? (
    <AsyncError error={error} variant="page" onRetry={() => void refresh()} />
  ) : loading ? (
    <Loading debugId="ManagedConnectorSettings" />
  ) : managed ? (
    // Document-flow page, not the master-detail catalog the unmanaged fallback
    // renders: it needs its own scroller because the settings pane is
    // `overflow: hidden`.
    <SettingContainer flex={1} maxWidth={1024} paddingInline={24} style={{ minHeight: 0 }}>
      <PlatformConnectorAuthorization />
    </SettingContainer>
  ) : (
    <UnmanagedConnectorSettings fallback={fallback} />
  );

  return <ManagedResourceTransition state={state}>{content}</ManagedResourceTransition>;
});

ManagedConnectorSettings.displayName = 'ManagedConnectorSettings';

export default ManagedConnectorSettings;
