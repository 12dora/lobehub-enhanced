'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PlatformAvatar } from '../constants';

interface DingTalkLinkBodyProps {
  botUsername?: string | null;
  /** Admin turned the chat half off — the bind instruction cannot work. */
  chatDisabled?: boolean;
  /** Brand-name label (e.g. `"钉钉"`) sourced from the registry. */
  name: string;
}

/**
 * DingTalk has no connect / verify flow — the link is created server-side the
 * first time the employee messages the robot. This body therefore only repeats
 * the "send any message to the robot" instruction shown on the detail page.
 */
const DingTalkLinkBody = memo<DingTalkLinkBodyProps>(({ botUsername, chatDisabled, name }) => {
  const { t } = useTranslation('messenger');
  const robotName = botUsername?.trim() || 'AI 助手';

  return (
    <>
      <PlatformAvatar platform="dingtalk" size={64} />
      <Flexbox align="center" gap={6}>
        <Text strong fontSize={18}>
          {chatDisabled
            ? t('messenger.dingtalk.status.chatUnavailable')
            : t('messenger.linkModal.continueIn', { platform: name })}
        </Text>
        <Text align="center" type="secondary">
          {chatDisabled
            ? t('messenger.dingtalk.capabilities.chatDisabled')
            : t('messenger.dingtalk.status.instructions', { botName: robotName })}
        </Text>
      </Flexbox>
    </>
  );
});

DingTalkLinkBody.displayName = 'MessengerDingTalkLinkBody';

export default DingTalkLinkBody;
