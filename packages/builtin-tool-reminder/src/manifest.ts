import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ReminderApiName, ReminderIdentifier } from './types';

export { ReminderIdentifier } from './types';

const scheduleSchema = {
  additionalProperties: false,
  properties: {
    date: {
      description: 'YYYY-MM-DD in Asia/Shanghai. Required when kind is once.',
      type: 'string',
    },
    kind: {
      description: 'once = one-shot at date+time; daily/weekly/monthly for repeats.',
      enum: ['daily', 'monthly', 'once', 'weekly'],
      type: 'string',
    },
    monthDays: {
      description: 'Day-of-month numbers 1-31. Used when kind is monthly.',
      items: { type: 'number' },
      type: 'array',
    },
    time: {
      description: 'Send time HH:mm in Asia/Shanghai.',
      type: 'string',
    },
    until: {
      description: 'Inclusive end date YYYY-MM-DD for repeating reminders.',
      type: 'string',
    },
    weekdays: {
      description: 'Weekdays 1-7 (Monday=1). Used when kind is weekly.',
      items: { type: 'number' },
      type: 'array',
    },
  },
  required: ['kind', 'time'],
  type: 'object',
};

export const ReminderManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a timed reminder in one call. Recipients are names, "姓名·部门", department names, or staff:<id>/dept:<id> from searchDirectory. Returns created, needs_clarification (list 「姓名 · 部门」 and retry), or needs_confirmation (ask, then retry with confirmLargeAudience=true). Times are Asia/Shanghai; serverNow is in every result.',
      name: ReminderApiName.createReminder,
      parameters: {
        additionalProperties: false,
        properties: {
          confirmLargeAudience: {
            description: 'Set true only after the user confirms a large department audience.',
            type: 'boolean',
          },
          content: {
            description: 'Reminder body shown to recipients (without mention tokens).',
            type: 'string',
          },
          recipients: {
            description:
              'People or departments: name, "姓名·部门", department name, or staff:<id>/dept:<id>.',
            items: { minLength: 1, type: 'string' },
            maxItems: 50,
            minItems: 1,
            type: 'array',
          },
          schedule: {
            description:
              'once requires date+time; daily/weekly/monthly for 每天/每周/每月. Otherwise once at the next occurrence.',
            ...scheduleSchema,
          },
        },
        required: ['recipients', 'content', 'schedule'],
        type: 'object',
      },
    },
    {
      description:
        'Search the DingTalk directory for people or departments. Use only for disambiguation or browsing. If several users share a name, ambiguous is true — list "姓名 · 最小部门" and ask; do not guess. serverNow is the current Asia/Shanghai time.',
      name: ReminderApiName.searchDirectory,
      parameters: {
        additionalProperties: false,
        properties: {
          kind: {
            description: 'Optional filter. Omit to search both people and departments.',
            enum: ['department', 'user'],
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
        'List reminders. scope=created lists reminder tasks I created; scope=received lists reminders delivered to me. Defaults to created.',
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
      description:
        'Cancel a reminder task I created. Recipients will not be notified after cancel.',
      name: ReminderApiName.cancelReminder,
      parameters: {
        additionalProperties: false,
        properties: {
          taskId: {
            description:
              '任务编号 from createReminder / listReminders (e.g. T-12). Not the task uuid.',
            type: 'string',
          },
        },
        required: ['taskId'],
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
