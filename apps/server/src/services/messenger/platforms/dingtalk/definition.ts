import type { MessengerPlatformDefinition } from '../types';
import { MessengerDingTalkBinder } from './binder';

export const dingtalk: MessengerPlatformDefinition = {
  // Enterprise-internal robot. Stream mode is owned by dingtalkStreamWorker
  // (in-process WS); inbound frames are forwarded to the generic messenger webhook.
  connectionMode: 'websocket',
  createBinder: () => new MessengerDingTalkBinder(),
  id: 'dingtalk',
  name: '钉钉',
};
