import { DEFAULT_BOT_DEBOUNCE_MS, MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import {
  allowFromField,
  displayToolCallsField,
  makeDmPolicyField,
  makeGroupPolicyFields,
  watchKeywordsField,
} from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.dingtalk.clientIdHint',
    label: 'channel.dingtalk.clientId',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'clientSecret',
        description: 'channel.dingtalk.clientSecretHint',
        label: 'channel.dingtalk.clientSecret',
        required: true,
        type: 'password',
      },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      {
        key: 'userId',
        description: 'channel.userIdHint',
        label: 'channel.userId',
        tooltip: 'channel.userIdHint.dingtalk',
        type: 'string',
      },
      {
        key: 'robotCode',
        description: 'channel.dingtalk.robotCodeHint',
        label: 'channel.dingtalk.robotCode',
        required: true,
        type: 'string',
      },
      {
        key: 'aiCardTemplateId',
        description: 'channel.dingtalk.aiCardTemplateIdHint',
        label: 'channel.dingtalk.aiCardTemplateId',
        required: false,
        type: 'string',
      },
      {
        key: 'selectCardTemplateId',
        description: 'channel.dingtalk.selectCardTemplateIdHint',
        label: 'channel.dingtalk.selectCardTemplateId',
        required: false,
        type: 'string',
      },
      {
        key: 'charLimit',
        default: 18_000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 18_432,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'concurrency',
        default: 'queue',
        description: 'channel.concurrencyHint',
        enum: ['queue', 'debounce'],
        enumDescriptions: ['channel.concurrencyQueueHint', 'channel.concurrencyDebounceHint'],
        enumLabels: ['channel.concurrencyQueue', 'channel.concurrencyDebounce'],
        label: 'channel.concurrency',
        type: 'string',
      },
      {
        key: 'debounceMs',
        default: DEFAULT_BOT_DEBOUNCE_MS,
        description: 'channel.debounceMsHint',
        label: 'channel.debounceMs',
        maximum: MAX_BOT_DEBOUNCE_MS,
        minimum: 100,
        type: 'number',
        visibleWhen: { field: 'concurrency', value: 'debounce' },
      },
      {
        key: 'showUsageStats',
        default: false,
        description: 'channel.showUsageStatsHint',
        label: 'channel.showUsageStats',
        type: 'boolean',
      },
      displayToolCallsField,
      makeDmPolicyField({ policy: 'open' }),
      ...makeGroupPolicyFields({ policy: 'open' }),
      allowFromField,
      watchKeywordsField,
    ],
    type: 'object',
  },
];
