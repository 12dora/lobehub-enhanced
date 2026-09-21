'use client';

import { Empty, Flexbox, toast, Tooltip } from '@lobehub/ui';
import { Button, confirmModal, Text } from '@lobehub/ui/base-ui';
import type { TableColumnsType } from 'antd';
import { Table } from 'antd';
import { ShieldCheckIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useClientDataSWR } from '@/libs/swr';
import { dingtalkApprovalRuleService } from '@/services/dingtalkApprovalRule';

import { buildRuleConditionSummary } from './conditionSummary';
import { enableBlockedReason, formatRuleDate, isRuleExpired, todayRunCount } from './formatters';
import { isDingTalkIdentityMissing } from './identityError';
import RuleActionTag from './RuleActionTag';
import RuleStatusTag, { REASON_LABEL_KEY } from './RuleStatusTag';
import RunHistoryDrawer from './RunHistoryDrawer';
import { approvalRuleListKey, mutateApprovalRuleLists } from './swrKeys';
import {
  type ApprovalRuleDisabledReason,
  type ApprovalRuleRow,
  normalizeApprovalRuleList,
} from './types';

/** Client-side page size — a user's rule count is capped at 20 active rules. */
const PAGE_SIZE = 20;

/**
 * The 自动审批规则 table: every rule the assistant created for this user, what it
 * does, whether it is still running, and its execution history.
 *
 * Rules are authored in chat (the tool's confirm card is the only place the
 * conditions can be composed safely), so this surface deliberately has no create
 * or edit form — it exists to review, stop and delete.
 */
const RuleTable = memo(() => {
  const { t } = useTranslation('setting');
  const isMobile = useIsMobile();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [runsRule, setRunsRule] = useState<ApprovalRuleRow | null>(null);

  // Disabled rules stay listed: the status column is where the user finds out
  // why one stopped, and a hidden rule looks deleted.
  const { data, error, isLoading, mutate } = useClientDataSWR(approvalRuleListKey(), () =>
    dingtalkApprovalRuleService.list({ includeDisabled: true }),
  );

  const rules = useMemo(() => normalizeApprovalRuleList(data), [data]);

  /**
   * A member who has never signed in through DingTalk has no identity for a rule to act as, so the
   * server refuses the read. Nothing is broken and nothing is worth retrying — the page says what
   * would make the feature available and stops there.
   */
  const identityMissing = data === undefined && isDingTalkIdentityMissing(error);

  const handleToggle = useCallback(
    async (row: ApprovalRuleRow) => {
      const next = !row.enabled;
      setPendingId(row.id);
      try {
        await dingtalkApprovalRuleService.setEnabled(row.id, next);
        toast.success(next ? t('approvalRule.toast.enabled') : t('approvalRule.toast.disabled'));
        await mutateApprovalRuleLists();
      } catch {
        toast.error(t('approvalRule.toast.updateFailed'));
      } finally {
        setPendingId(null);
      }
    },
    [t],
  );

  const handleDelete = useCallback(
    async (row: ApprovalRuleRow) => {
      setPendingId(row.id);
      try {
        await dingtalkApprovalRuleService.remove(row.id);
        toast.success(t('approvalRule.toast.deleted'));
        await mutateApprovalRuleLists();
      } catch {
        toast.error(t('approvalRule.toast.deleteFailed'));
      } finally {
        setPendingId(null);
      }
    },
    [t],
  );

  const confirmDelete = useCallback(
    (row: ApprovalRuleRow) => {
      confirmModal({
        cancelText: t('approvalRule.confirm.cancel'),
        content: t('approvalRule.confirm.deleteContent', { name: row.name }),
        okButtonProps: { danger: true },
        okText: t('approvalRule.confirm.deleteOk'),
        // Deleting one rule is atomic and quick: close the dialog at once and
        // show progress on the row instead of holding a spinning modal open.
        onOk: () => {
          void handleDelete(row);
        },
        title: t('approvalRule.confirm.deleteTitle'),
      });
    },
    [handleDelete, t],
  );

  const columns: TableColumnsType<ApprovalRuleRow> = useMemo(
    () => [
      {
        dataIndex: 'name',
        ellipsis: true,
        key: 'name',
        render: (name: string) => (
          <Tooltip title={name}>
            <Text ellipsis>{name}</Text>
          </Tooltip>
        ),
        title: t('approvalRule.column.name'),
        width: 170,
      },
      {
        dataIndex: 'processName',
        ellipsis: true,
        key: 'processName',
        title: t('approvalRule.column.template'),
        width: 130,
      },
      {
        dataIndex: 'conditions',
        ellipsis: true,
        key: 'conditions',
        render: (_: unknown, row) => {
          const summary = buildRuleConditionSummary(row.conditions, t, row.originatorLabels);

          return (
            <Tooltip title={summary}>
              <Text ellipsis>{summary}</Text>
            </Tooltip>
          );
        },
        title: t('approvalRule.column.condition'),
        width: 230,
      },
      {
        dataIndex: 'action',
        key: 'action',
        render: (_: unknown, row) => {
          const tag = <RuleActionTag action={row.action} redirectToName={row.redirectToName} />;

          // The remark is what the automation actually sends to DingTalk (the
          // rejection reason or the comment), so it belongs with the action.
          return row.remark ? (
            <Tooltip title={row.remark}>
              <span>{tag}</span>
            </Tooltip>
          ) : (
            tag
          );
        },
        title: t('approvalRule.column.action'),
        width: 120,
      },
      {
        dataIndex: 'expiresAt',
        key: 'expiresAt',
        render: (_: unknown, row) => {
          if (!row.expiresAt) return <Text fontSize={13}>{t('approvalRule.expiry.never')}</Text>;

          const expired = isRuleExpired(row.expiresAt);

          return (
            <Text fontSize={13} type={expired ? 'danger' : undefined}>
              {formatRuleDate(row.expiresAt)}
            </Text>
          );
        },
        title: t('approvalRule.column.expiry'),
        width: 110,
      },
      {
        dataIndex: 'dailyCount',
        key: 'dailyCount',
        render: (_: unknown, row) => {
          const used = todayRunCount(row);
          if (row.dailyCap === undefined) return <Text fontSize={13}>{used}</Text>;

          return (
            <Text fontSize={13}>
              {row.dailyCap === null
                ? t('approvalRule.dailyUsage.unlimited', { used })
                : t('approvalRule.dailyUsage.limited', { cap: row.dailyCap, used })}
            </Text>
          );
        },
        title: t('approvalRule.column.dailyUsage'),
        width: 90,
      },
      {
        dataIndex: 'enabled',
        key: 'enabled',
        render: (_: unknown, row) => (
          <RuleStatusTag
            disabledReason={row.disabledReason}
            enabled={row.enabled}
            expired={isRuleExpired(row.expiresAt)}
          />
        ),
        title: t('approvalRule.column.status'),
        width: 110,
      },
      {
        fixed: isMobile ? undefined : ('right' as const),
        key: 'actions',
        render: (_: unknown, row) => {
          const isPending = pendingId === row.id;
          const blockedReason = enableBlockedReason(row);
          // Turning the flag back on would not restart a rule an administrator
          // stopped, whose owner's DingTalk identity lapsed, whose tier is off, or
          // whose window has closed — the server refuses it too. Offering the
          // button anyway would promise an automation that cannot run.
          const toggleDisabled = !row.enabled && !!blockedReason;
          const blockedHint = (reason: ApprovalRuleDisabledReason) =>
            t('approvalRule.enableBlocked', {
              reason: t(REASON_LABEL_KEY[reason] as 'approvalRule.disabledReason.admin'),
            });
          const toggleButton = (
            <Button
              disabled={isPending || toggleDisabled}
              size={'small'}
              type={'text'}
              onClick={() => {
                void handleToggle(row);
              }}
            >
              {row.enabled ? t('approvalRule.action.disable') : t('approvalRule.action.enable')}
            </Button>
          );

          return (
            <Flexbox horizontal align={'center'} gap={4}>
              <Button size={'small'} type={'text'} onClick={() => setRunsRule(row)}>
                {t('approvalRule.action.runs')}
              </Button>
              {toggleDisabled && blockedReason ? (
                <Tooltip title={blockedHint(blockedReason)}>
                  <span>{toggleButton}</span>
                </Tooltip>
              ) : (
                toggleButton
              )}
              <Button
                danger
                disabled={isPending}
                size={'small'}
                type={'text'}
                onClick={() => confirmDelete(row)}
              >
                {t('approvalRule.action.delete')}
              </Button>
            </Flexbox>
          );
        },
        title: t('approvalRule.column.actions'),
        width: 190,
      },
    ],
    [confirmDelete, handleToggle, isMobile, pendingId, t],
  );

  if (identityMissing)
    return (
      <Text fontSize={13} type={'secondary'}>
        {t('approvalRule.identityRequired')}
      </Text>
    );

  return (
    <>
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={!error && rules.length === 0}
        isLoading={isLoading}
        empty={
          <Empty
            description={t('approvalRule.empty.desc')}
            icon={ShieldCheckIcon}
            title={t('approvalRule.empty.title')}
          />
        }
        onRetry={() => {
          void mutate();
        }}
      >
        <Table<ApprovalRuleRow>
          columns={columns}
          dataSource={rules}
          rowKey={'id'}
          scroll={{ x: 1150 }}
          size={'small'}
          pagination={{
            hideOnSinglePage: true,
            pageSize: PAGE_SIZE,
            size: 'small',
          }}
        />
      </AsyncBoundary>
      <RunHistoryDrawer rule={runsRule} onClose={() => setRunsRule(null)} />
    </>
  );
});

RuleTable.displayName = 'RuleTable';

export default RuleTable;
