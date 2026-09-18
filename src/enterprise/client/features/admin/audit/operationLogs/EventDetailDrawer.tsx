'use client';

import { Flexbox } from '@lobehub/ui';
import {
  Button,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerPopup,
  DrawerPortal,
  DrawerRoot,
  DrawerTitle,
  Text,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useReducedMotion } from 'motion/react';
import { memo, useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import UserNameCell from '../../primitives/UserNameCell';
import { useFetchAuditEventDetail } from '../hooks/useAdminAudit';
import AuditStatusTag from '../shared/AuditStatusTag';
import {
  auditActionLabel,
  auditReasonLabel,
  auditTargetDisplay,
  formatAdminDateTime,
} from '../shared/format';
import JsonDiffView from '../shared/JsonDiffView';
import { toIsoOrUndefined } from '../shared/timeWindow';

/** Space kept inside the clipped popup box for the panel's drop shadow. */
const SHADOW_GUTTER = 48;
/**
 * Pure-CSS width: stable across renders and window resizes. The old
 * `window.innerWidth - 48` was re-read on every render, so the panel's width (and the
 * distance the motion travelled) could change mid-animation.
 */
export const EVENT_PANEL_WIDTH = 'min(720px, calc(100vw - 48px))';

/**
 * Same glide as the users slide-in panel (`users/detail/UserDetailDrawer`): a soft,
 * slightly longer enter and a quicker accelerating exit. Collapsed under reduced motion.
 * Spread after the atom's own config, so `transition` / `exit` replace the library
 * defaults while `initial` / `animate` (off-screen → in place) stay the atom's.
 */
const EVENT_PANEL_ENTER_TRANSITION = { duration: 0.56, ease: [0.32, 0.72, 0, 1] } as const;
const EVENT_PANEL_EXIT_TRANSITION = { duration: 0.36, ease: [0.4, 0, 0.6, 1] } as const;

export const resolveEventPanelMotion = (reduceMotion: boolean | null) =>
  reduceMotion
    ? {
        exit: { transition: { duration: 0 }, x: '100%' },
        transition: { duration: 0 },
      }
    : {
        exit: { transition: EVENT_PANEL_EXIT_TRANSITION, x: '100%' },
        transition: EVENT_PANEL_ENTER_TRANSITION,
      };

const styles = createStaticStyles(({ css }) => ({
  body: css`
    display: flex;
    flex-direction: column;

    width: 100%;
    min-height: 100%;
    padding-block: 12px 24px;
    padding-inline: 20px;
  `,
  label: css`
    color: ${cssVar.colorTextSecondary};
  `,
  /**
   * `body` carries `transform: translateZ(0)` (src/styles/global.ts), which makes it the
   * containing block of this fixed popup. Unclipped, the entering panel (translateX(100%))
   * widens `body.scrollWidth` and the focus trap scrolls the page sideways, so the slide
   * looks like a jump. `overflow: clip` cuts it at the popup box without creating a scroll
   * container; the shadow room comes from padding inside the clipped box. See
   * `users/detail/UserDetailDrawer` for the full write-up.
   */
  popup: css`
    overflow: clip;
    padding-inline-start: ${SHADOW_GUTTER}px;
  `,
  row: css`
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px;
    align-items: start;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-block-end: 20px;
  `,
  targetId: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
  targetName: css`
    word-break: break-word;
  `,
}));

export interface EventDetailDrawerProps {
  eventId: string | null;
  filterWindow?: { from?: Date; to?: Date };
  onClose: () => void;
  open: boolean;
}

const Field = ({ label, children }: { children: React.ReactNode; label: string }) => (
  <div className={styles.row}>
    <Text className={styles.label}>{label}</Text>
    <div>{children}</div>
  </div>
);

/**
 * Slide-in event detail. Composed from the base-ui Drawer atoms rather than the packaged
 * `<Drawer>` because that one hard-codes its motion and gives no hook for the clip fix.
 */
const EventDetailDrawer = memo<EventDetailDrawerProps>(
  ({ eventId, open, onClose, filterWindow }) => {
    const { t } = useTranslation('admin');
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();

    /**
     * Keep the outgoing event rendered while the panel slides out (the page clears
     * `eventId` on close), otherwise the body blanks before the exit animation starts.
     * Written from a layout effect, not during render, and dropped on exit-complete.
     */
    const lastCommittedEventIdRef = useRef<string | null>(null);
    const [, forceRender] = useReducer((tick: number) => tick + 1, 0);
    const renderedEventId = eventId ?? (open ? null : lastCommittedEventIdRef.current);

    useLayoutEffect(() => {
      if (eventId) lastCommittedEventIdRef.current = eventId;
    });

    const handleExitComplete = useCallback(() => {
      lastCommittedEventIdRef.current = null;
      forceRender();
    }, []);

    // ESC, outside press and the close button all arrive here as `nextOpen === false`.
    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        if (nextOpen || !open) return;
        onClose();
      },
      [onClose, open],
    );

    const motionProps = useMemo(() => resolveEventPanelMotion(reduceMotion), [reduceMotion]);

    const { data, isLoading, error } = useFetchAuditEventDetail(
      renderedEventId ?? undefined,
      !!renderedEventId,
    );

    const goExport = () => {
      if (!data) return;
      const params = new URLSearchParams();
      params.set('kind', 'operation_logs');
      params.set('create', '1');
      if (data.action) params.set('action', data.action);
      const from = toIsoOrUndefined(filterWindow?.from);
      const to = toIsoOrUndefined(filterWindow?.to);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (data.actorUserId) params.set('actorUserId', data.actorUserId);
      navigate(`/admin/audit/exports?${params.toString()}`);
      onClose();
    };

    const target = data ? auditTargetDisplay(t, data) : null;

    return (
      <DrawerRoot
        modal
        open={open}
        onExitComplete={handleExitComplete}
        onOpenChange={handleOpenChange}
      >
        <DrawerPortal>
          <DrawerBackdrop />
          <DrawerPopup
            className={styles.popup}
            motionProps={motionProps}
            placement="right"
            popupStyle={{ width: `calc(${EVENT_PANEL_WIDTH} + ${SHADOW_GUTTER}px)` }}
            width={EVENT_PANEL_WIDTH}
          >
            <DrawerHeader>
              <DrawerTitle>{t('audit.logs.detail.title')}</DrawerTitle>
              <Flexbox horizontal align="center" gap={4}>
                {data ? (
                  <Button size="small" type="default" onClick={goExport}>
                    {t('audit.logs.detail.createExport')}
                  </Button>
                ) : null}
                <DrawerClose aria-label={t('audit.logs.detail.close')} />
              </Flexbox>
            </DrawerHeader>
            <DrawerContent>
              <div className={styles.body}>
                {isLoading && !data ? (
                  <Flexbox align="center" justify="center" style={{ minHeight: 200 }}>
                    <NeuralNetworkLoading size={28} />
                  </Flexbox>
                ) : null}
                {error && !data ? (
                  <Text type="danger">{t('audit.logs.detail.loadError')}</Text>
                ) : null}
                {data && target ? (
                  <>
                    <div className={styles.section}>
                      <Field label={t('audit.logs.columns.time')}>
                        {formatAdminDateTime(data.createdAt)}
                      </Field>
                      <Field label={t('audit.logs.columns.action')}>
                        {auditActionLabel(t, data.action)}
                      </Field>
                      <Field label={t('audit.logs.columns.actor')}>
                        <UserNameCell fallbackId={data.actorUserId} user={data.actorUser} />
                      </Field>
                      <Field label={t('audit.logs.columns.result')}>
                        <AuditStatusTag kind="result" value={data.result} />
                      </Field>
                      <Field label={t('audit.logs.columns.target')}>
                        <Flexbox gap={2}>
                          <span className={styles.targetName} data-testid="event-target">
                            {target.text}
                          </span>
                          {target.rawId && target.rawId !== target.displayName ? (
                            <span className={styles.targetId}>{target.rawId}</span>
                          ) : null}
                        </Flexbox>
                      </Field>
                      <Field label={t('audit.logs.columns.reason')}>
                        {auditReasonLabel(t, data.reason) ?? '—'}
                      </Field>
                    </div>
                    <div className={styles.section}>
                      <Text style={{ fontWeight: 600 }}>{t('audit.logs.diff.title')}</Text>
                      <JsonDiffView after={data.afterDiff} before={data.beforeDiff} />
                    </div>
                  </>
                ) : null}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerPortal>
      </DrawerRoot>
    );
  },
);

EventDetailDrawer.displayName = 'AuditEventDetailDrawer';

export default EventDetailDrawer;
