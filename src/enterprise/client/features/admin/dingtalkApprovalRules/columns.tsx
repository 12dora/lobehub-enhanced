'use client';

import type {
  ApprovalRuleAction,
  ApprovalRuleConditions,
  ApprovalRuleDisabledReason,
} from '@lobechat/types';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import type { TableColumnsType } from 'antd';
import type { TFunction } from 'i18next';

import { buildRuleConditionSummary } from '@/features/DingTalkApprovalRules/conditionSummary';
import {
  formatRuleDate,
  formatRuleDateTime,
  isRuleExpired,
} from '@/features/DingTalkApprovalRules/formatters';
import type { AdminDingtalkApprovalRuleItem } from '@/server/enterprise/contracts/adminDingtalkApprovalRules';

import StatusBadge from '../primitives/StatusBadge';
import UserNameCell from '../primitives/UserNameCell';

/** Dash shown where a rule has no value for the column yet. */
const EMPTY_CELL = '—';

/**
 * Explicit maps instead of template-literal keys: a renamed or missing key has to
 * fail the type-check, not render a raw key in the console.
 */
const ACTION_META = {
  agree: { color: 'success', labelKey: 'dingtalkApprovalRules.action.agree' },
  comment: { color: undefined, labelKey: 'dingtalkApprovalRules.action.comment' },
  redirect: { color: 'warning', labelKey: 'dingtalkApprovalRules.action.redirect' },
  refuse: { color: 'error', labelKey: 'dingtalkApprovalRules.action.refuse' },
} as const satisfies Record<ApprovalRuleAction, { color?: string; labelKey: string }>;

const REASON_LABEL_KEY = {
  admin: 'dingtalkApprovalRules.disabledReason.admin',
  expired: 'dingtalkApprovalRules.disabledReason.expired',
  identity_invalid: 'dingtalkApprovalRules.disabledReason.identityInvalid',
  tier_off: 'dingtalkApprovalRules.disabledReason.tierOff',
  user: 'dingtalkApprovalRules.disabledReason.user',
} as const satisfies Record<ApprovalRuleDisabledReason, string>;

/**
 * Condition fields of the admin list row. They are read structurally rather than
 * from the contract type so the column renders whether or not a deployment's
 * payload already carries them — an older server simply has no condition to show.
 */
interface AdminRuleConditionFields {
  conditions?: ApprovalRuleConditions | null;
  /** staffId / deptId → display name, resolved server-side. */
  originatorLabels?: Record<string, string> | null;
}

export type AdminApprovalRuleRow = AdminDingtalkApprovalRuleItem & AdminRuleConditionFields;

const withConditions = (row: AdminDingtalkApprovalRuleItem): AdminApprovalRuleRow =>
  row as AdminApprovalRuleRow;

export interface BuildAdminDingtalkApprovalRuleColumnsOptions {
  /** SYSTEM_OPERATE. Without it the list stays readable but nothing can be disabled. */
  canOperate: boolean;
  disablingRuleId: string | null;
  onForceDisable: (row: AdminDingtalkApprovalRuleItem) => void;
  t: TFunction<'admin'>;
  /**
   * The condition summary is the same sentence the rule owner reads in their own
   * settings, so it comes from the `setting` namespace rather than being restated
   * here in slightly different words.
   */
  tSetting: TFunction<'setting'>;
}

export const buildAdminDingtalkApprovalRuleColumns = ({
  canOperate,
  disablingRuleId,
  onForceDisable,
  t,
  tSetting,
}: BuildAdminDingtalkApprovalRuleColumnsOptions): TableColumnsType<AdminDingtalkApprovalRuleItem> => [
  {
    key: 'owner',
    render: (_: unknown, row) => (
      <UserNameCell
        fallbackId={row.userId}
        user={{
          avatar: null,
          email: row.userEmail,
          fullName: row.userDisplayName,
          id: row.userId,
          username: null,
        }}
      />
    ),
    title: t('dingtalkApprovalRules.columns.owner'),
    width: 200,
  },
  {
    dataIndex: 'name',
    ellipsis: true,
    key: 'name',
    render: (name: string) => (
      <Tooltip title={name}>
        <Text ellipsis>{name}</Text>
      </Tooltip>
    ),
    title: t('dingtalkApprovalRules.columns.rule'),
    width: 200,
  },
  {
    dataIndex: 'processName',
    ellipsis: true,
    key: 'processName',
    title: t('dingtalkApprovalRules.columns.template'),
    width: 150,
  },
  {
    ellipsis: true,
    key: 'conditions',
    render: (_: unknown, row) => {
      const { conditions, originatorLabels } = withConditions(row);
      const summary = buildRuleConditionSummary(conditions, tSetting, originatorLabels);

      return (
        <Tooltip title={summary}>
          <Text ellipsis>{summary}</Text>
        </Tooltip>
      );
    },
    title: t('dingtalkApprovalRules.columns.condition'),
    width: 220,
  },
  {
    dataIndex: 'action',
    key: 'action',
    render: (action: ApprovalRuleAction, row) => {
      const meta = ACTION_META[action] ?? ACTION_META.comment;
      const label =
        action === 'redirect' && row.redirectToName
          ? t('dingtalkApprovalRules.action.redirectTo', { name: row.redirectToName })
          : t(meta.labelKey as 'dingtalkApprovalRules.action.agree');

      return (
        <Tag color={meta.color} size="small">
          {label}
        </Tag>
      );
    },
    title: t('dingtalkApprovalRules.columns.action'),
    width: 130,
  },
  {
    dataIndex: 'expiresAt',
    key: 'expiresAt',
    render: (expiresAt: string | null) => {
      if (!expiresAt) return <Text fontSize={13}>{t('dingtalkApprovalRules.expiry.never')}</Text>;
      const expired = isRuleExpired(expiresAt);

      return (
        <Text fontSize={13} type={expired ? 'danger' : undefined}>
          {formatRuleDate(expiresAt) || EMPTY_CELL}
        </Text>
      );
    },
    title: t('dingtalkApprovalRules.columns.expiry'),
    width: 120,
  },
  {
    dataIndex: 'enabled',
    key: 'enabled',
    render: (enabled: boolean, row) => {
      // An expired rule no longer runs, whatever the stored flag says. The recorded
      // reason still wins, though: a rule an administrator stopped stays "disabled by
      // administrator" once its window also lapses.
      const expired = isRuleExpired(row.expiresAt);
      const active = enabled && !expired;
      const reason: ApprovalRuleDisabledReason | undefined = active
        ? undefined
        : (row.disabledReason ?? (expired ? 'expired' : undefined));

      return (
        <Flexbox gap={2}>
          <StatusBadge status={active ? 'active' : 'disabled'} />
          {reason ? (
            <Text fontSize={12} type="secondary">
              {t(REASON_LABEL_KEY[reason] as 'dingtalkApprovalRules.disabledReason.admin')}
            </Text>
          ) : null}
        </Flexbox>
      );
    },
    title: t('dingtalkApprovalRules.columns.status'),
    width: 140,
  },
  {
    dataIndex: 'lastRunAt',
    key: 'lastRunAt',
    render: (lastRunAt: string | null) => (
      <Text fontSize={13}>{formatRuleDateTime(lastRunAt) || EMPTY_CELL}</Text>
    ),
    title: t('dingtalkApprovalRules.columns.lastRun'),
    width: 150,
  },
  {
    fixed: 'right' as const,
    key: 'actions',
    render: (_: unknown, row) => {
      const alreadyStopped = !row.enabled || isRuleExpired(row.expiresAt);
      const disabled = !canOperate || alreadyStopped;
      const button = (
        <Button
          danger
          disabled={disabled}
          loading={disablingRuleId === row.id}
          size="small"
          type="text"
          onClick={() => onForceDisable(row)}
        >
          {t('dingtalkApprovalRules.forceDisable')}
        </Button>
      );

      if (!disabled) return button;

      return (
        <Tooltip
          title={
            canOperate
              ? t('dingtalkApprovalRules.alreadyDisabled')
              : t('dingtalkApprovalRules.noOperatePermission')
          }
        >
          <span>{button}</span>
        </Tooltip>
      );
    },
    title: t('dingtalkApprovalRules.columns.actions'),
    width: 120,
  },
];
