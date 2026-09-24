'use client';

import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminLoadingSurface } from '@/enterprise/client/features/admin/pages/AdminStateSurfaces';
import type {
  AdminImConnectorsReadService,
  AdminImConnectorView,
} from '@/enterprise/client/services/adminImConnectors';
import { adminImConnectorsService } from '@/enterprise/client/services/adminImConnectors';

import { useAdminImConnectors } from '../hooks';
import { DingTalkConnectorCard } from './DingTalkConnectorCard';
import type { ImConnectorBindingsService, ImConnectorMutationService } from './service';
import { imConnectorStyles as styles } from './styles';

export interface ImConnectorsTabProps {
  /** Injectable for tests. */
  bindingsService?: ImConnectorBindingsService;
  /** SYSTEM_OPERATE — the cards stay readable without it, but nothing can be written. */
  canOperate: boolean;
  /** SYSTEM_READ and the tab being the active one: an unseen tab asks the server for nothing. */
  enabled: boolean;
  /** Injectable for tests. */
  mutationService?: ImConnectorMutationService;
  readService?: AdminImConnectorsReadService;
}

const renderCard = (
  item: AdminImConnectorView,
  canOperate: boolean,
  onSaved: () => Promise<void>,
  mutationService?: ImConnectorMutationService,
  bindingsService?: ImConnectorBindingsService,
) => {
  switch (item.platform) {
    case 'dingtalk': {
      return (
        <DingTalkConnectorCard
          bindingsService={bindingsService}
          canOperate={canOperate}
          key={item.platform}
          service={mutationService}
          view={item}
          onSaved={onSaved}
        />
      );
    }
    default: {
      return null;
    }
  }
};

/**
 * IM 连接器 tab body — one card per supported platform.
 *
 * The list always answers with every platform the deployment knows about, configured or not, so an
 * admin provisioning the robot for the first time finds the same card an operator later edits. The
 * page only offers this tab while the `dingtalk` module is installed.
 */
export const ImConnectorsTab = memo<ImConnectorsTabProps>(
  ({
    bindingsService,
    canOperate,
    enabled,
    mutationService,
    readService = adminImConnectorsService,
  }) => {
    const { t } = useTranslation('admin');
    const connectors = useAdminImConnectors(enabled, readService);
    const { mutate } = connectors;

    // The saved row comes back from the write, but the status, the stats and the fingerprint are
    // the server's to report — so the list is re-read rather than patched in place.
    const onSaved = useCallback(async () => {
      await mutate();
    }, [mutate]);

    const items = connectors.data?.items ?? [];

    if (connectors.error && !connectors.data)
      return (
        <Alert
          showIcon
          description={t('systemGeneral.loadFailedDescription')}
          title={t('systemGeneral.loadFailed')}
          type="error"
          action={
            <Button size="small" type="primary" onClick={() => void mutate()}>
              {t('systemGeneral.retry')}
            </Button>
          }
        />
      );

    if (connectors.isLoading && !connectors.data) return <AdminLoadingSurface />;

    if (items.length === 0)
      return <Text type="secondary">{t('systemGeneral.imConnectors.empty')}</Text>;

    return (
      <div className={styles.tab}>
        {items.map((item) =>
          renderCard(item, canOperate, onSaved, mutationService, bindingsService),
        )}
      </div>
    );
  },
);

ImConnectorsTab.displayName = 'AdminImConnectorsTab';
