'use client';

import { Tag } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApprovalRuleAction } from './types';

/**
 * Colour carries the stake of the automated decision: rejecting on the user's
 * behalf is the one that cannot be walked back, and a transfer moves the task to
 * a colleague, so neither may look like a neutral chip.
 */
const ACTION_META = {
  agree: { color: 'success', labelKey: 'approvalRule.actionLabel.agree' },
  comment: { color: undefined, labelKey: 'approvalRule.actionLabel.comment' },
  redirect: { color: 'warning', labelKey: 'approvalRule.actionLabel.redirect' },
  refuse: { color: 'error', labelKey: 'approvalRule.actionLabel.refuse' },
} as const satisfies Record<ApprovalRuleAction, { color?: string; labelKey: string }>;

interface RuleActionTagProps {
  action: ApprovalRuleAction;
  /** Resolved name of the transfer target; without it the tag reads 「转交」. */
  redirectToName?: string | null;
}

/** 同意 / 拒绝 / 转交给 <姓名> / 评论 chip of a rule. */
const RuleActionTag = memo<RuleActionTagProps>(({ action, redirectToName }) => {
  const { t } = useTranslation('setting');
  const meta = ACTION_META[action] ?? ACTION_META.comment;

  const label =
    action === 'redirect'
      ? redirectToName
        ? t('approvalRule.actionLabel.redirectTo', { name: redirectToName })
        : t('approvalRule.actionLabel.redirect')
      : t(meta.labelKey as 'approvalRule.actionLabel.agree');

  return (
    <Tag color={meta.color} size={'small'} style={{ flexShrink: 0 }}>
      {label}
    </Tag>
  );
});

RuleActionTag.displayName = 'RuleActionTag';

export default RuleActionTag;
