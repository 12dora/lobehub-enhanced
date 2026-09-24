'use client';

import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ActionLink from '@/components/ActionLink';

import { DINGTALK_ACTION_HREF, type DingtalkActionKind } from './index';

export type DingtalkSettingLinkKind = Extract<
  DingtalkActionKind,
  'adminImConnectors' | 'binding' | 'cliSettings'
>;

const LABEL_KEY = {
  adminImConnectors: 'dingtalkLink.adminImConnectors',
  binding: 'dingtalkLink.binding',
  cliSettings: 'dingtalkLink.cliSettings',
} as const satisfies Record<DingtalkSettingLinkKind, string>;

/**
 * The page that clears what a settings screen just said (label from the `setting` namespace): the
 * member's DingTalk binding, the admin IM connector tab, or the DingTalk developer console. Shown to
 * everyone — it is only a link.
 */
const DingtalkSettingLink = memo<{ kind: DingtalkSettingLinkKind }>(({ kind }) => {
  const { t } = useTranslation('setting');

  return (
    <Text fontSize={13}>
      <ActionLink href={DINGTALK_ACTION_HREF[kind]}>{t(LABEL_KEY[kind])}</ActionLink>
    </Text>
  );
});

DingtalkSettingLink.displayName = 'DingtalkSettingLink';

export default DingtalkSettingLink;
