'use client';

import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApprovalRuleDisabledReason } from './types';

/** Reason → `setting` copy. Shared with the table, whose 启用 tooltip names it too. */
export const REASON_LABEL_KEY = {
  admin: 'approvalRule.disabledReason.admin',
  expired: 'approvalRule.disabledReason.expired',
  identity_invalid: 'approvalRule.disabledReason.identityInvalid',
  tier_off: 'approvalRule.disabledReason.tierOff',
  user: 'approvalRule.disabledReason.user',
} as const satisfies Record<ApprovalRuleDisabledReason, string>;

interface RuleStatusTagProps {
  disabledReason?: ApprovalRuleDisabledReason | null;
  enabled: boolean;
  /** Validity window already closed — the rule cannot run whatever the flag says. */
  expired: boolean;
}

/**
 * 启用 / 已停用 chip plus the reason it stopped, because "disabled" alone leaves
 * the user guessing why a rule no longer runs. The reason is also what the table
 * puts in its tooltip when 启用 is not the owner's to press (see
 * `enableBlockedReason`).
 *
 * An expired rule reads as stopped even before the worker flips the stored flag —
 * the honest state, not the one the row happens to be persisted in.
 *
 * The stored reason wins over the expiry: a rule an administrator stopped stays
 * "disabled by administrator" once its window also lapses, because that is the
 * reason the user has to act on. Expiry only explains a rule whose flag still
 * says enabled (or one stopped without a recorded reason).
 */
const RuleStatusTag = memo<RuleStatusTagProps>(({ disabledReason, enabled, expired }) => {
  const { t } = useTranslation('setting');

  const active = enabled && !expired;
  const reason: ApprovalRuleDisabledReason | undefined = active
    ? undefined
    : (disabledReason ?? (expired ? 'expired' : undefined));

  return (
    <Flexbox gap={2}>
      <Tag color={active ? 'success' : undefined} size={'small'} style={{ flexShrink: 0 }}>
        {active ? t('approvalRule.status.enabled') : t('approvalRule.status.disabled')}
      </Tag>
      {reason && (
        <Text fontSize={12} type={'secondary'}>
          {t(REASON_LABEL_KEY[reason] as 'approvalRule.disabledReason.admin')}
        </Text>
      )}
    </Flexbox>
  );
});

RuleStatusTag.displayName = 'RuleStatusTag';

export default RuleStatusTag;
