'use client';

import {
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerPopup,
  DrawerPortal,
  DrawerRoot,
  DrawerTitle,
  Tag,
  Text,
} from '@lobehub/ui/base-ui';
import type { TableColumnsType } from 'antd';
import { Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useReducedMotion } from 'motion/react';
import { memo, useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import { dingtalkApprovalRuleService } from '@/services/dingtalkApprovalRule';

import { formatRuleDateTime } from './formatters';
import RuleActionTag from './RuleActionTag';
import { approvalRuleRunsKey } from './swrKeys';
import {
  type ApprovalRuleRow,
  type ApprovalRuleRunRow,
  type ApprovalRuleRunStatus,
  normalizeApprovalRuleRuns,
} from './types';

/** Dash shown where a run row carries no title or originator. */
const EMPTY_CELL = '-';

/** Space kept inside the clipped popup box for the panel's drop shadow. */
const SHADOW_GUTTER = 48;

/**
 * Pure-CSS width so the panel (and the distance its motion travels) cannot change
 * mid-animation. 720px holds the five run columns without wrapping the titles.
 */
export const RUN_PANEL_WIDTH = 'min(720px, calc(100vw - 48px))';

/**
 * Same glide as the admin slide-in panels (`admin/audit/operationLogs/EventDetailDrawer`):
 * a soft, slightly longer enter and a quicker accelerating exit. Collapsed under
 * reduced motion. Spread after the atom's own config, so `transition` / `exit` replace
 * the library defaults while `initial` / `animate` (off-screen → in place) stay the atom's.
 */
const RUN_PANEL_ENTER_TRANSITION = { duration: 0.56, ease: [0.32, 0.72, 0, 1] } as const;
const RUN_PANEL_EXIT_TRANSITION = { duration: 0.36, ease: [0.4, 0, 0.6, 1] } as const;

export const resolveRunPanelMotion = (reduceMotion: boolean | null) =>
  reduceMotion
    ? {
        exit: { transition: { duration: 0 }, x: '100%' },
        transition: { duration: 0 },
      }
    : {
        exit: { transition: RUN_PANEL_EXIT_TRANSITION, x: '100%' },
        transition: RUN_PANEL_ENTER_TRANSITION,
      };

const styles = createStaticStyles(({ css }) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    width: 100%;
    min-height: 100%;
    padding-block: 12px 24px;
    padding-inline: 20px;
  `,
  /**
   * `body` carries `transform: translateZ(0)` (src/styles/global.ts), which makes it the
   * containing block of this fixed popup. Unclipped, the entering panel (translateX(100%))
   * widens `body.scrollWidth` and the focus trap scrolls the page sideways, so the slide
   * looks like a jump. `overflow: clip` cuts it at the popup box without creating a scroll
   * container; the shadow room comes from padding inside the clipped box. See
   * `admin/users/detail/UserDetailDrawer` for the full write-up.
   */
  popup: css`
    overflow: clip;
    padding-inline-start: ${SHADOW_GUTTER}px;
  `,
}));

const RUN_STATUS_META = {
  failed: { color: 'error', labelKey: 'approvalRule.runs.status.failed' },
  skipped_quota: { color: 'warning', labelKey: 'approvalRule.runs.status.skippedQuota' },
  succeeded: { color: 'success', labelKey: 'approvalRule.runs.status.succeeded' },
} as const satisfies Record<ApprovalRuleRunStatus, { color: string; labelKey: string }>;

interface RunStatusTagProps {
  status: ApprovalRuleRunStatus;
}

const RunStatusTag = memo<RunStatusTagProps>(({ status }) => {
  const { t } = useTranslation('setting');
  const meta = RUN_STATUS_META[status] ?? RUN_STATUS_META.failed;

  return (
    <Tag color={meta.color} size={'small'} style={{ flexShrink: 0 }}>
      {t(meta.labelKey as 'approvalRule.runs.status.failed')}
    </Tag>
  );
});

RunStatusTag.displayName = 'RunStatusTag';

interface RunHistoryDrawerProps {
  onClose: () => void;
  /** The rule whose history is shown; `null` keeps the drawer closed and idle. */
  rule: ApprovalRuleRow | null;
}

/**
 * 执行记录 of one rule: what the automation did, to which request, and whether it
 * went through. This is the only place the user can audit a rule that acted for
 * them, so a failed load must say so rather than read as "never ran".
 *
 * Composed from the base-ui Drawer atoms rather than the packaged `<Drawer>` because
 * that one hard-codes its motion and gives no hook for the clip fix.
 */
const RunHistoryDrawer = memo<RunHistoryDrawerProps>(({ onClose, rule }) => {
  const { t } = useTranslation('setting');
  const reduceMotion = useReducedMotion();

  /**
   * Keep the outgoing rule rendered while the panel slides out (the table clears its
   * selection on close), otherwise the body blanks before the exit animation starts.
   * Written from a layout effect, never during render, and dropped on exit-complete.
   */
  const lastRuleRef = useRef<ApprovalRuleRow | null>(null);
  const [, forceRender] = useReducer((tick: number) => tick + 1, 0);
  const renderedRule = rule ?? lastRuleRef.current;

  useLayoutEffect(() => {
    if (rule) lastRuleRef.current = rule;
  });

  const handleExitComplete = useCallback(() => {
    lastRuleRef.current = null;
    forceRender();
  }, []);

  // ESC, outside press and the close button all arrive here as `nextOpen === false`.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen || !rule) return;
      onClose();
    },
    [onClose, rule],
  );

  const motionProps = useMemo(() => resolveRunPanelMotion(reduceMotion), [reduceMotion]);

  const { data, error, isLoading, mutate } = useClientDataSWR(
    approvalRuleRunsKey(renderedRule?.id),
    () => dingtalkApprovalRuleService.listRuns(renderedRule!.id),
  );

  const runs = useMemo(() => normalizeApprovalRuleRuns(data), [data]);

  const columns: TableColumnsType<ApprovalRuleRunRow> = useMemo(
    () => [
      {
        dataIndex: 'createdAt',
        key: 'createdAt',
        render: (value: ApprovalRuleRunRow['createdAt']) => formatRuleDateTime(value) || EMPTY_CELL,
        title: t('approvalRule.runs.column.time'),
        width: 140,
      },
      {
        dataIndex: 'instanceTitle',
        ellipsis: true,
        key: 'instanceTitle',
        render: (value: ApprovalRuleRunRow['instanceTitle']) => value || EMPTY_CELL,
        title: t('approvalRule.runs.column.instance'),
      },
      {
        dataIndex: 'originatorName',
        key: 'originatorName',
        render: (value: ApprovalRuleRunRow['originatorName']) => value || EMPTY_CELL,
        title: t('approvalRule.runs.column.originator'),
        width: 110,
      },
      {
        dataIndex: 'action',
        key: 'action',
        render: (value: ApprovalRuleRunRow['action']) => <RuleActionTag action={value} />,
        title: t('approvalRule.runs.column.action'),
        width: 90,
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (value: ApprovalRuleRunRow['status']) => <RunStatusTag status={value} />,
        title: t('approvalRule.runs.column.result'),
        width: 110,
      },
    ],
    [t],
  );

  return (
    <DrawerRoot
      modal
      open={Boolean(rule)}
      onExitComplete={handleExitComplete}
      onOpenChange={handleOpenChange}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerPopup
          className={styles.popup}
          motionProps={motionProps}
          placement={'right'}
          popupStyle={{ width: `calc(${RUN_PANEL_WIDTH} + ${SHADOW_GUTTER}px)` }}
          width={RUN_PANEL_WIDTH}
        >
          <DrawerHeader>
            <DrawerTitle>{t('approvalRule.runs.title')}</DrawerTitle>
            <DrawerClose aria-label={t('approvalRule.runs.close')} />
          </DrawerHeader>
          <DrawerContent>
            <div className={styles.body}>
              {renderedRule && (
                <Text fontSize={13} type={'secondary'}>
                  {renderedRule.name}
                </Text>
              )}
              <AsyncBoundary
                data={data}
                empty={<Text type={'secondary'}>{t('approvalRule.runs.empty')}</Text>}
                error={error}
                isEmpty={!error && runs.length === 0}
                isLoading={isLoading}
                onRetry={() => {
                  void mutate();
                }}
              >
                <Table<ApprovalRuleRunRow>
                  columns={columns}
                  dataSource={runs}
                  pagination={{ hideOnSinglePage: true, pageSize: 20, size: 'small' }}
                  rowKey={'id'}
                  scroll={{ x: 640 }}
                  size={'small'}
                />
              </AsyncBoundary>
            </div>
          </DrawerContent>
        </DrawerPopup>
      </DrawerPortal>
    </DrawerRoot>
  );
});

RunHistoryDrawer.displayName = 'RunHistoryDrawer';

export default RunHistoryDrawer;
