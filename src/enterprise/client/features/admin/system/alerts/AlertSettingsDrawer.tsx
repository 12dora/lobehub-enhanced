'use client';

import { Alert, Button, Drawer, Tabs } from '@lobehub/ui/base-ui';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminLoadingSurface } from '@/enterprise/client/features/admin/pages/AdminStateSurfaces';
import type {
  AdminStatusAlertsService,
  AdminStatusApiService,
} from '@/enterprise/client/services/adminSystem';

import { AlertsTab } from './AlertsTab';
import { StatusApiTab } from './StatusApiTab';
import { alertSettingsStyles as styles } from './styles';
import { useAlertSettingsEditor } from './useAlertSettingsEditor';

export type AlertSettingsTab = 'alerts' | 'statusApi';

export interface AlertSettingsDrawerProps {
  /** SYSTEM_OPERATE — without it every control is shown disabled. */
  canOperate: boolean;
  /** SYSTEM_READ — gates the drawer's own queries. */
  canRead: boolean;
  onClose: () => void;
  open: boolean;
  service: AdminStatusAlertsService & AdminStatusApiService;
}

/** Fits a two-column field grid on desktop; never wider than a phone screen. */
const DRAWER_WIDTH = 'min(560px, 100vw)';

/**
 * 状态监控 → 告警设置: a right-side drawer with two tabs, 告警 (who gets told about what) and
 * 状态 API (endpoints + bearer token for an external status dashboard).
 *
 * Both tab bodies stay mounted while the drawer is open, so switching tabs keeps unsaved alert
 * edits and a just-generated token. Closing drops both: the draft is re-seeded from the server and
 * the plaintext token is gone for good.
 */
export const AlertSettingsDrawer = memo<AlertSettingsDrawerProps>(
  ({ canOperate, canRead, onClose, open, service }) => {
    const { t } = useTranslation('admin');
    const [tab, setTab] = useState<AlertSettingsTab>('alerts');
    const [revealedToken, setRevealedToken] = useState<string | null>(null);
    /**
     * Bumped every time the drawer closes. A token request that resolves after its session ended
     * must not put the plaintext back on screen the next time the drawer opens.
     */
    const sessionRef = useRef(0);
    const enabled = open && canRead;
    const editor = useAlertSettingsEditor({ canOperate, enabled, service });
    const { reset } = editor;

    const close = useCallback(() => {
      sessionRef.current += 1;
      reset();
      setRevealedToken(null);
      setTab('alerts');
      onClose();
    }, [onClose, reset]);

    // Closed from outside (route change, parent state): end the session the same way.
    useEffect(() => {
      if (open) return;
      sessionRef.current += 1;
      setRevealedToken(null);
    }, [open]);

    const currentSession = useCallback(() => sessionRef.current, []);
    const revealToken = useCallback((token: string | null, session: number) => {
      if (session !== sessionRef.current) return;
      setRevealedToken(token);
    }, []);

    const footer =
      tab !== 'alerts' ? undefined : canOperate ? (
        <div className={styles.footer}>
          <Button disabled={editor.saving} onClick={close}>
            {t('system.alerts.cancel')}
          </Button>
          <Button
            disabled={!editor.draft || !editor.dirty}
            loading={editor.saving}
            type="primary"
            onClick={() => void editor.save()}
          >
            {t('system.alerts.save')}
          </Button>
        </div>
      ) : (
        // Nothing to cancel for a read-only viewer.
        <div className={styles.footer}>
          <Button onClick={close}>{t('system.alerts.close')}</Button>
        </div>
      );

    const renderAlerts = () => {
      if (editor.view && editor.draft) {
        return (
          <AlertsTab
            canOperate={canOperate}
            draft={editor.draft}
            editor={editor}
            view={editor.view}
          />
        );
      }
      if (editor.loadError) {
        return (
          <div className={styles.panel}>
            <Alert
              showIcon
              title={t('system.alerts.loadFailed')}
              type="error"
              action={
                <Button size="small" onClick={() => void editor.reload()}>
                  {t('system.actions.retry')}
                </Button>
              }
            />
          </div>
        );
      }
      return <AdminLoadingSurface />;
    };

    return (
      <Drawer
        footer={footer}
        open={open}
        placement="right"
        title={t('system.actions.alertSettings')}
        width={DRAWER_WIDTH}
        onClose={close}
      >
        <Tabs
          activeKey={tab}
          items={[
            { key: 'alerts', label: t('system.alerts.tabs.alerts') },
            { key: 'statusApi', label: t('system.alerts.tabs.statusApi') },
          ]}
          onChange={(key) => setTab(key === 'statusApi' ? 'statusApi' : 'alerts')}
        />
        <div data-testid="alert-settings-panel-alerts" hidden={tab !== 'alerts'}>
          {renderAlerts()}
        </div>
        <div data-testid="alert-settings-panel-statusApi" hidden={tab !== 'statusApi'}>
          <StatusApiTab
            canOperate={canOperate}
            enabled={enabled}
            getSession={currentSession}
            revealedToken={revealedToken}
            service={service}
            onRevealedTokenChange={revealToken}
          />
        </div>
      </Drawer>
    );
  },
);

AlertSettingsDrawer.displayName = 'AdminSystemAlertSettingsDrawer';
