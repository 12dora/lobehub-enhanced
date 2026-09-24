'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ActionLink from '@/components/ActionLink';

import { DINGTALK_ACTION_PLUGIN_LABEL_KEY, type DingtalkAction } from './index';

/** The one-click way out under a DingTalk tool failure (label from the `plugin` namespace). */
const DingtalkErrorAction = memo<{ action: DingtalkAction }>(({ action }) => {
  const { t } = useTranslation('plugin');

  return (
    <ActionLink href={action.href}>{t(DINGTALK_ACTION_PLUGIN_LABEL_KEY[action.kind])}</ActionLink>
  );
});

DingtalkErrorAction.displayName = 'DingtalkErrorAction';

export default DingtalkErrorAction;
