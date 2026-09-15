import './push';

import { dropStaleDingTalkQueues } from './queue';

void dropStaleDingTalkQueues();

export { tryAutoLinkDingTalk } from './autoLink';
export { MessengerDingTalkBinder } from './binder';
export {
  DINGTALK_ASKER_ONLY_REPLY,
  DINGTALK_CHAT_DISABLED_REPLY,
  DINGTALK_HELP_TEXT,
  DINGTALK_IDENTITY_EMAIL_DOMAIN,
  DINGTALK_IDLE_NEW_TOPIC_NOTICE,
  DINGTALK_INSTALLATION_KEY,
  DINGTALK_QUEUE_FULL_REPLY,
  DINGTALK_QUEUE_JOINED_REPLY,
  DINGTALK_TOPIC_TITLE_PREFIX,
  DINGTALK_UNKNOWN_COMMAND_REPLY,
  DINGTALK_UNKNOWN_USER_REPLY,
  DINGTALK_UNSUPPORTED_MEDIA_REPLY,
} from './const';
export { dingtalk } from './definition';
export { dingtalkMessengerPushProvider, registerDingTalkMessengerPushProvider } from './push';
export { dropStaleDingTalkQueues } from './queue';
