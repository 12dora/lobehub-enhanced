'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DingtalkSettingLink from '@/features/DingtalkActionLink/DingtalkSettingLink';

import RuleTable from './RuleTable';
import { useDingTalkApprovalEnabled } from './useDingTalkApprovalEnabled';

/**
 * 自动审批规则 settings page: the rules that act on the user's behalf in DingTalk
 * approval. The nav entry is hidden when the deployment has no DingTalk approval,
 * so this page only sees that case through a stale deep link — it says so instead
 * of rendering an empty table that suggests the feature is merely unused.
 */
const DingTalkApprovalRules = memo(() => {
  const { t } = useTranslation('setting');
  const approvalEnabled = useDingTalkApprovalEnabled();

  if (!approvalEnabled)
    return (
      <Flexbox gap={6}>
        <Text fontSize={13} type={'secondary'}>
          {t('approvalRule.unavailable')}
        </Text>
        <DingtalkSettingLink kind={'adminImConnectors'} />
      </Flexbox>
    );

  return (
    <Flexbox gap={16}>
      <Text fontSize={13} type={'secondary'}>
        {t('approvalRule.desc')}
      </Text>
      <RuleTable />
    </Flexbox>
  );
});

DingTalkApprovalRules.displayName = 'DingTalkApprovalRules';

export default DingTalkApprovalRules;
