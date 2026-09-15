import type { PlatformDefinition } from '../types';
import { DingTalkClientFactory } from './client';
import { DEFAULT_DINGTALK_CONNECTION_MODE } from './const';
import { schema } from './schema';

export const dingtalk: PlatformDefinition = {
  id: 'dingtalk',
  name: '钉钉',
  connectionMode: DEFAULT_DINGTALK_CONNECTION_MODE,
  description: 'Connect a DingTalk bot',
  documentation: {
    portalUrl: 'https://open.dingtalk.com/document/orgapp/stream-mode-overview',
    setupGuideUrl: 'https://open.dingtalk.com/document/orgapp/robot-overview',
  },
  schema,
  supportsMarkdown: true,
  supportsMessageEdit: false,
  clientFactory: new DingTalkClientFactory(),
};
