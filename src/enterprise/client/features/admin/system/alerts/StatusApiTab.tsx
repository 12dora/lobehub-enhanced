'use client';

import { CopyButton, Flexbox } from '@lobehub/ui';
import { Alert, Button, Input, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminLoadingSurface } from '@/enterprise/client/features/admin/pages/AdminStateSurfaces';
import { openDangerConfirm } from '@/enterprise/client/features/admin/primitives/DangerConfirm';
import { runAdminMutation } from '@/enterprise/client/features/admin/primitives/runAdminMutation';
import {
  AdminReauthBlockedError,
  AdminReauthCancelledError,
} from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import { InfraHelpButton } from '@/enterprise/client/features/admin/systemGeneral/infra/InfraField';
import { formatAdminDateTime } from '@/enterprise/client/features/admin/users/utils';
import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type {
  AdminStatusApiService,
  AdminStatusApiView,
} from '@/enterprise/client/services/adminSystem';
import { useClientDataSWR } from '@/libs/swr';

import { invalidateAdminSystemAlerts } from '../invalidate';
import { buildAdminSystemStatusApiKey } from '../swrKeys';
import { alertSettingsStyles as styles } from './styles';

const ENDPOINT_KEYS = ['summary', 'events', 'health'] as const;

export interface StatusApiTabProps {
  canOperate: boolean;
  /** Drawer open and SYSTEM_READ granted. */
  enabled: boolean;
  /** Drawer session a request started in; results from an ended session are dropped. */
  getSession: () => number;
  /** Plaintext of a token generated in this drawer session — shown once, never refetched. */
  onRevealedTokenChange: (token: string | null, session: number) => void;
  revealedToken: string | null;
  service: AdminStatusApiService;
}

type TokenAction = 'revoke' | 'rotate';

/** 告警设置 → 状态 API: endpoints for an external status dashboard and its bearer token. */
export const StatusApiTab = memo<StatusApiTabProps>(
  ({ canOperate, enabled, getSession, onRevealedTokenChange, revealedToken, service }) => {
    const { t } = useTranslation('admin');
    const { authMethod } = useAdminAccess();
    const query = useClientDataSWR(
      buildAdminSystemStatusApiKey(enabled),
      () => service.getStatusApi(),
      { revalidateOnFocus: false },
    );
    const view = query.data as AdminStatusApiView | undefined;
    const [busy, setBusy] = useState<TokenAction | null>(null);
    const mutateQuery = query.mutate;

    const execute = useCallback(
      async (action: TokenAction) => {
        setBusy(action);
        const session = getSession();
        await runAdminMutation({
          authMethod,
          onError: (error) => {
            if (error instanceof AdminReauthCancelledError) {
              toast.error(t('system.actions.reauthCancelled'));
            } else if (error instanceof AdminReauthBlockedError) {
              toast.error(t('users.errors.reauthBlocked'));
            } else {
              console.error(`[admin.system] status API token ${action} failed`, error);
              toast.error(t('system.statusApi.toast.failed'));
            }
          },
          run: async () => {
            if (action === 'rotate') {
              const result = await service.rotateStatusApiToken();
              onRevealedTokenChange(result.token, session);
              await mutateQuery(result.view, { revalidate: false });
              void invalidateAdminSystemAlerts();
              toast.success(t('system.statusApi.toast.rotated'));
              return;
            }
            const next = await service.revokeStatusApiToken();
            onRevealedTokenChange(null, session);
            await mutateQuery(next, { revalidate: false });
            void invalidateAdminSystemAlerts();
            toast.success(t('system.statusApi.toast.revoked'));
          },
        });
        setBusy(null);
      },
      [authMethod, getSession, mutateQuery, onRevealedTokenChange, service, t],
    );

    const confirm = useCallback(
      (action: TokenAction) => {
        if (busy) return;
        openDangerConfirm({
          confirmText: t(
            action === 'rotate' ? 'system.statusApi.token.rotate' : 'system.statusApi.token.revoke',
          ),
          content: t(`system.statusApi.modal.${action}.description` as never),
          title: t(`system.statusApi.modal.${action}.title` as never),
          onConfirm: () => execute(action),
        });
      },
      [busy, execute, t],
    );

    if (!view) {
      return query.error ? (
        <Alert
          showIcon
          title={t('system.statusApi.loadFailed')}
          type="error"
          action={
            <Button size="small" onClick={() => void mutateQuery()}>
              {t('system.actions.retry')}
            </Button>
          }
        />
      ) : (
        <AdminLoadingSurface />
      );
    }

    return (
      <div className={styles.panel}>
        <section className={styles.section}>
          <span className={styles.channelTitle}>
            <Text as="h3" className={styles.groupTitle}>
              {t('system.statusApi.endpoints')}
            </Text>
            <InfraHelpButton
              hint={t('system.statusApi.help')}
              label={t('system.statusApi.endpoints')}
            />
          </span>
          {ENDPOINT_KEYS.map((key) => (
            <div className={styles.endpointRow} data-testid="status-api-endpoint" key={key}>
              <span className={styles.endpointLabel}>
                {t(`system.statusApi.endpoint.${key}` as never)}
                {key === 'health' ? (
                  <>
                    {' '}
                    <Tag size="small">{t('system.statusApi.healthNoAuth')}</Tag>
                  </>
                ) : null}
              </span>
              <span className={styles.code}>{view.endpoints[key]}</span>
              <CopyButton
                content={view.endpoints[key]}
                size="small"
                title={t('system.statusApi.token.copy')}
              />
            </div>
          ))}
        </section>

        <section className={styles.section}>
          <Text as="h3" className={styles.groupTitle}>
            {t('system.statusApi.token.title')}
          </Text>
          <Text data-testid="status-api-token-state" type="secondary">
            {view.tokenSet
              ? t('system.statusApi.token.set', {
                  hint: view.tokenHint ?? '',
                  time: formatAdminDateTime(view.createdAt),
                })
              : t('system.statusApi.token.notSet')}
          </Text>
          {view.envTokenConfigured ? (
            <span className={styles.muted}>{t('system.statusApi.token.envConfigured')}</span>
          ) : null}

          {revealedToken ? (
            <div className={styles.tokenBox} data-testid="status-api-revealed-token">
              <span className={styles.warning} role="alert">
                {t('system.statusApi.token.once')}
              </span>
              <Flexbox horizontal align="center" gap={8}>
                <Input
                  readOnly
                  aria-label={t('system.statusApi.token.title')}
                  className={styles.code}
                  style={{ flex: 1, minWidth: 0 }}
                  value={revealedToken}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton
                  content={revealedToken}
                  size="small"
                  title={t('system.statusApi.token.copy')}
                />
              </Flexbox>
            </div>
          ) : null}

          {canOperate ? (
            <div className={styles.inlineRow}>
              {view.tokenSet ? (
                <>
                  <Button
                    disabled={busy !== null}
                    loading={busy === 'rotate'}
                    onClick={() => confirm('rotate')}
                  >
                    {t('system.statusApi.token.rotate')}
                  </Button>
                  <Button
                    danger
                    disabled={busy !== null}
                    loading={busy === 'revoke'}
                    onClick={() => confirm('revoke')}
                  >
                    {t('system.statusApi.token.revoke')}
                  </Button>
                </>
              ) : (
                // Nothing to invalidate yet, so the first token needs no confirmation.
                <Button
                  disabled={busy !== null}
                  loading={busy === 'rotate'}
                  type="primary"
                  onClick={() => void execute('rotate')}
                >
                  {t('system.statusApi.token.generate')}
                </Button>
              )}
            </div>
          ) : null}
        </section>
      </div>
    );
  },
);

StatusApiTab.displayName = 'AdminSystemStatusApiTab';
