import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ReminderApiName, ReminderIdentifier } from './types';

export { ReminderIdentifier } from './types';

const recipientItemSchema = {
  additionalProperties: false,
  properties: {
    deptId: {
      description: 'Department id from searchDirectory. Required when kind is department.',
      type: 'string',
    },
    kind: {
      description: 'Recipient kind. Use user for a person and department for a whole department.',
      enum: ['user', 'department'],
      type: 'string',
    },
    staffId: {
      description: 'DingTalk staff id from searchDirectory. Required when kind is user.',
      type: 'string',
    },
  },
  required: ['kind'],
  type: 'object',
};

const repeatRuleSchema = {
  additionalProperties: false,
  properties: {
    freq: {
      description: 'Repeat frequency.',
      enum: ['daily', 'weekly', 'monthly'],
      type: 'string',
    },
    monthDays: {
      description: 'Day-of-month numbers 1-31. Used when freq is monthly.',
      items: { type: 'number' },
      type: 'array',
    },
    time: {
      description: 'Send time in HH:mm, Asia/Shanghai.',
      type: 'string',
    },
    until: {
      description: 'Inclusive end date YYYY-MM-DD. Omit to repeat indefinitely.',
      type: 'string',
    },
    weekdays: {
      description: 'Weekdays 1-7 (Monday=1). Used when freq is weekly.',
      items: { type: 'number' },
      type: 'array',
    },
  },
  required: ['freq', 'time'],
  type: 'object',
};

export const ReminderManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Search the DingTalk directory for people or departments. Always call this before createReminder. If several users share the same name, ambiguous is true — list "姓名 · 最小部门" and ask the user; do not guess. serverNow is the current Asia/Shanghai time.',
      name: ReminderApiName.searchDirectory,
      parameters: {
        additionalProperties: false,
        properties: {
          kind: {
            description: 'Optional filter. Omit to search both people and departments.',
            enum: ['user', 'department'],
            type: 'string',
          },
          q: {
            description: 'Name, pinyin, or department keyword to search.',
            type: 'string',
          },
        },
        required: ['q'],
        type: 'object',
      },
    },
    {
      description:
        'Create a timed reminder for resolved directory ids. Recipients must come from searchDirectory (staffId / deptId), never raw names. fireAt is ISO 8601 with offset, interpreted in Asia/Shanghai. If a department subtree has more than 30 members, the tool returns needsConfirmation and does not create — ask the user, then retry with confirmLargeAudience=true.',
      name: ReminderApiName.createReminder,
      parameters: {
        additionalProperties: false,
        properties: {
          confirmLargeAudience: {
            description:
              'Set true only after the user confirms a department audience larger than 30 people.',
            type: 'boolean',
          },
          content: {
            description: 'Reminder body shown to recipients.',
            type: 'string',
          },
          fireAt: {
            description:
              'Next send time as ISO 8601 with offset, e.g. 2026-09-17T09:00:00+08:00. Default timezone Asia/Shanghai.',
            type: 'string',
          },
          recipients: {
            description: 'Resolved people and/or departments from searchDirectory.',
            items: recipientItemSchema,
            type: 'array',
          },
          repeat: {
            description:
              'Optional repeat rule. Omit for a one-shot reminder at fireAt. Use when the user says 每天 / 每周 / 每月.',
            ...repeatRuleSchema,
          },
        },
        required: ['recipients', 'fireAt', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'List reminders. scope=created lists reminders I created; scope=received lists reminders delivered to me. Defaults to created.',
      name: ReminderApiName.listReminders,
      parameters: {
        additionalProperties: false,
        properties: {
          scope: {
            description: 'created = reminders I set; received = reminders sent to me.',
            enum: ['created', 'received'],
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description: 'Cancel a reminder I created. Recipients will not be notified after cancel.',
      name: ReminderApiName.cancelReminder,
      parameters: {
        additionalProperties: false,
        properties: {
          id: {
            description: 'Reminder id returned by createReminder or listReminders.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
  ],
  identifier: ReminderIdentifier,
  meta: {
    avatar: '⏰',
    description: 'Create timed reminders for DingTalk people and departments',
    title: 'Reminders',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
