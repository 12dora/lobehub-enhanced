'use client';

import { memo } from 'react';

import type { MessengerPlatform, MessengerPlatformCapabilities } from '../constants';
import DingTalkDetail from './DingTalk';
import DiscordDetail from './Discord';
import SlackDetail from './Slack';
import TelegramDetail from './Telegram';

interface IntegrationDetailProps {
  appId?: string;
  botUsername?: string;
  /** Per-platform admin switches; only DingTalk publishes them today. */
  capabilities?: MessengerPlatformCapabilities;
  /** Brand-name label (e.g. `"Slack"`) sourced from the registry. */
  name: string;
  onBack: () => void;
  platform: MessengerPlatform;
}

const IntegrationDetail = memo<IntegrationDetailProps>(({ capabilities, platform, ...rest }) => {
  switch (platform) {
    case 'slack': {
      return <SlackDetail {...rest} />;
    }
    case 'discord': {
      return <DiscordDetail {...rest} />;
    }
    case 'telegram': {
      return <TelegramDetail {...rest} />;
    }
    case 'dingtalk': {
      return <DingTalkDetail {...rest} capabilities={capabilities} />;
    }
  }
});

IntegrationDetail.displayName = 'MessengerIntegrationDetail';

export default IntegrationDetail;
