'use client';

import { Button, Input, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type {
  AdminImConnectorBindingItem,
  ImConnectorPlatform,
} from '@/enterprise/client/services/adminImConnectors';

import { openDangerConfirm } from '../../primitives/DangerConfirm';
import { runAdminMutation } from '../../primitives/runAdminMutation';
import { useAdminImConnectorBindings } from '../hooks';
import { infraFormStyles as formStyles } from '../infra/styles';
import { displayBindingUserLabel } from './bindings';
import { BindUserModal } from './BindUserModal';
import { formatConnectorTime } from './draft';
import { invalidateAdminImConnectorBindings } from './invalidate';
import { type ImConnectorBindingsService, imConnectorBindingsService } from './service';
import { imConnectorStyles as styles } from './styles';

/** Typing a search term must not fire a request per keystroke; the list is server-filtered. */
const SEARCH_DEBOUNCE_MS = 300;

export interface BindingsSectionProps {
  /** SYSTEM_OPERATE. Without it the list is still readable, but nothing can be bound or unbound. */
  canOperate: boolean;
  /** Refresh the connector list so the 已绑定员工 counter follows a bind or an unbind. */
  onChanged?: () => Promise<void> | void;
  platform: ImConnectorPlatform;
  /** Injectable for tests. */
  service?: ImConnectorBindingsService;
}

const userCell = (item: AdminImConnectorBindingItem) => ({
  primary: item.userName ?? item.userEmail ?? item.userId,
  secondary: item.userName && item.userEmail ? item.userEmail : null,
});

/**
 * 绑定用户 — which AIHub account each DingTalk user pushes to.
 *
 * Sits under the connector's counters because that is the number it explains: 已绑定员工 is this
 * list's length, and an admin who wonders why a reminder never arrived comes here to find out
 * whether the account is in it at all.
 */
export const BindingsSection = memo<BindingsSectionProps>(
  ({ canOperate, onChanged, platform, service = imConnectorBindingsService }) => {
    const { t } = useTranslation('admin');
    const { authMethod } = useAdminAccess();
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [removingUserId, setRemovingUserId] = useState<string | null>(null);

    useEffect(() => {
      const trimmed = search.trim();
      if (trimmed === query) return;
      const timer = setTimeout(() => setQuery(trimmed), SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }, [query, search]);

    const bindings = useAdminImConnectorBindings(true, platform, query, service);

    // Every `q` is its own cache entry, so a write has to drop them all — not just the filter on
    // screen. `onChanged` is what carries the 已绑定员工 counter along.
    const refresh = useCallback(async () => {
      await invalidateAdminImConnectorBindings();
      await onChanged?.();
    }, [onChanged]);

    const unbind = useCallback(
      (item: AdminImConnectorBindingItem) => {
        const label = displayBindingUserLabel(item.userName, item.userEmail, item.userId);
        openDangerConfirm({
          confirmText: t('systemGeneral.imConnectors.bindings.unbind'),
          content: t('systemGeneral.imConnectors.bindings.unbindConfirm', {
            platformUser: item.platformUsername ?? item.platformUserId,
            user: label,
          }),
          onConfirm: async () => {
            setRemovingUserId(item.userId);
            try {
              const committed = await runAdminMutation({
                authMethod,
                mapErrorKey: () => 'systemGeneral.imConnectors.bindings.unbindFailed',
                run: () => service.removeBinding({ platform, userId: item.userId }).then(() => {}),
              });
              if (!committed) return;
              toast.success(t('systemGeneral.imConnectors.bindings.unbound'));
              await refresh();
            } finally {
              setRemovingUserId(null);
            }
          },
          title: t('systemGeneral.imConnectors.bindings.unbindTitle'),
        });
      },
      [authMethod, platform, refresh, service, t],
    );

    const items = bindings.data?.items ?? [];
    const total = bindings.data?.total ?? items.length;
    const hasMore = bindings.data?.hasMore ?? false;

    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>
          {t('systemGeneral.imConnectors.bindings.title')}
        </span>
        <span className={formStyles.hint}>{t('systemGeneral.imConnectors.bindings.hint')}</span>

        <div className={styles.bindingsToolbar}>
          <Input
            aria-label={t('systemGeneral.imConnectors.bindings.search')}
            placeholder={t('systemGeneral.imConnectors.bindings.search')}
            style={{ maxWidth: 280 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {canOperate ? (
            <Button size="small" type="primary" onClick={() => setModalOpen(true)}>
              {t('systemGeneral.imConnectors.bindings.bind')}
            </Button>
          ) : null}
        </div>

        {/* Not gated on `!data`: with `keepPreviousData` a failed search still holds the previous
            filter's rows, and silently showing them under a new search term is the worse lie. */}
        {bindings.error ? (
          <Text type="danger">{t('systemGeneral.imConnectors.bindings.loadFailed')}</Text>
        ) : null}

        {bindings.isLoading && !bindings.data ? (
          <Text type="secondary">{t('systemGeneral.imConnectors.bindings.loading')}</Text>
        ) : items.length === 0 ? (
          bindings.error ? null : (
            <Text type="secondary">
              {query.length > 0
                ? t('systemGeneral.imConnectors.bindings.emptySearch')
                : t('systemGeneral.imConnectors.bindings.empty')}
            </Text>
          )
        ) : (
          <div className={styles.bindingsScroll}>
            <table className={styles.bindingsTable}>
              <thead>
                <tr>
                  <th scope="col">{t('systemGeneral.imConnectors.bindings.columns.user')}</th>
                  <th scope="col">
                    {t('systemGeneral.imConnectors.bindings.columns.platformUser')}
                  </th>
                  <th scope="col">{t('systemGeneral.imConnectors.bindings.columns.source')}</th>
                  <th scope="col">{t('systemGeneral.imConnectors.bindings.columns.createdAt')}</th>
                  {canOperate ? (
                    <th scope="col">{t('systemGeneral.imConnectors.bindings.columns.actions')}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const cell = userCell(item);
                  return (
                    <tr key={item.userId}>
                      <td>
                        <div>{cell.primary}</div>
                        {cell.secondary ? (
                          <div className={styles.bindingSecondary}>{cell.secondary}</div>
                        ) : null}
                      </td>
                      <td>
                        <div className={styles.code}>{item.platformUserId}</div>
                        {item.platformUsername ? (
                          <div className={styles.bindingSecondary}>{item.platformUsername}</div>
                        ) : null}
                      </td>
                      <td>
                        <Tag size="small">
                          {t(`systemGeneral.imConnectors.bindings.source.${item.source}` as never)}
                        </Tag>
                      </td>
                      <td className={styles.code}>{formatConnectorTime(item.createdAt)}</td>
                      {canOperate ? (
                        <td>
                          <Button
                            danger
                            loading={removingUserId === item.userId}
                            size="small"
                            onClick={() => unbind(item)}
                          >
                            {t('systemGeneral.imConnectors.bindings.unbind')}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* The list is capped server-side; without the count a truncated answer looks complete. */}
        {items.length > 0 ? (
          <Text type="secondary">
            {hasMore
              ? t('systemGeneral.imConnectors.bindings.truncated', {
                  shown: items.length,
                  total,
                })
              : t('systemGeneral.imConnectors.bindings.total', { total })}
          </Text>
        ) : null}

        {canOperate ? (
          <BindUserModal
            open={modalOpen}
            platform={platform}
            service={service}
            onBound={refresh}
            onClose={() => setModalOpen(false)}
          />
        ) : null}
      </div>
    );
  },
);

BindingsSection.displayName = 'AdminImConnectorBindingsSection';
