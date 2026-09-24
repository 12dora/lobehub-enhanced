import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
  DingtalkEventResponseStatuses,
  DingtalkTodoPriorityValues,
  DingtalkWorkspaceApiName,
  DingtalkWorkspaceIdentifier,
} from './types';

export { DingtalkWorkspaceIdentifier } from './types';

const staffTokenArray = {
  description:
    'People as staff:<id> tokens copied verbatim from searchDirectory, or a plain name. Ambiguous names return DINGTALK_AMBIGUOUS — list 「姓名 · 部门」 and ask; never guess.',
  items: { minLength: 1, type: 'string' },
  type: 'array',
} as const;

const isoDateTime = {
  description:
    'ISO 8601 datetime in Asia/Shanghai (e.g. 2026-09-22T18:00:00+08:00). Resolve relative dates against serverNow. All-day events use YYYY-MM-DD with isAllDay=true.',
  type: 'string',
} as const;

export const DingtalkWorkspaceManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Search the DingTalk directory for people or departments. Copy returned staff:<id> tokens verbatim into todo/event APIs. If several users share a name, ambiguous is true — list 「姓名 · 部门」 and ask; do not guess. serverNow is the current Asia/Shanghai time.',
      humanIntervention: 'never',
      name: DingtalkWorkspaceApiName.searchDirectory,
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
        '我的钉钉待办：待我审批 + 本助手创建的待办。已授权钉钉个人数据时另含 personalTodos（含客户端自建待办，此处只读，写入走 lobe-dingtalk-personal 的 updateTodo/completeTodo）；notes 若提示授权，请原样转告',
      humanIntervention: 'never',
      name: DingtalkWorkspaceApiName.listTodos,
      parameters: {
        additionalProperties: false,
        properties: {
          done: {
            description: 'When true, list completed todos; when false or omitted, list open todos.',
            type: 'boolean',
          },
          refresh: {
            description:
              'When true, bypass the 5-minute cache and reload personalTodos when 钉钉个人数据 is authorized. Does not retry the org client-todo read when that permission is unavailable.',
            type: 'boolean',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Create a DingTalk todo. Creator is always the caller. Recipients/executors are staff:<id> tokens or names. dueTime is ISO 8601 Asia/Shanghai. priority is 10/20/30/40. Only todos created here can later be listed or edited.',
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.createTodo,
      parameters: {
        additionalProperties: false,
        properties: {
          description: {
            description: 'Optional body (max 4096 characters). Not shown on third-party todos.',
            maxLength: 4096,
            type: 'string',
          },
          dueTime: isoDateTime,
          executorTokens: { ...staffTokenArray, maxItems: 100 },
          priority: {
            description: 'DingTalk priority value: 10, 20, 30, or 40.',
            enum: [...DingtalkTodoPriorityValues],
            type: 'number',
          },
          subject: {
            description: 'Todo title (max 1024 characters).',
            maxLength: 1024,
            type: 'string',
          },
        },
        required: ['subject'],
        type: 'object',
      },
    },
    {
      description:
        'Update a todo created through this tool. taskId comes from listTodos/createTodo. Omitted fields are left unchanged. executorTokens fully replaces executors.',
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.updateTodo,
      parameters: {
        additionalProperties: false,
        properties: {
          description: { maxLength: 4096, type: 'string' },
          done: {
            description: 'Mark the whole todo done or not done.',
            type: 'boolean',
          },
          dueTime: {
            description:
              'ISO 8601 datetime in Asia/Shanghai. Pass null to clear the due time. Omitted leaves it unchanged.',
            type: ['string', 'null'],
          },
          executorTokens: { ...staffTokenArray, maxItems: 1000 },
          priority: {
            description: 'DingTalk priority value: 10, 20, 30, or 40.',
            enum: [...DingtalkTodoPriorityValues],
            type: 'number',
          },
          subject: { maxLength: 1024, type: 'string' },
          taskId: {
            description: 'Todo id from listTodos or createTodo.',
            type: 'string',
          },
        },
        required: ['taskId'],
        type: 'object',
      },
    },
    {
      description:
        'Mark a todo created through this tool as done. taskId from listTodos/createTodo.',
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.completeTodo,
      parameters: {
        additionalProperties: false,
        properties: {
          taskId: {
            description: 'Todo id from listTodos or createTodo.',
            type: 'string',
          },
        },
        required: ['taskId'],
        type: 'object',
      },
    },
    {
      description: 'Delete a todo created through this tool. taskId from listTodos/createTodo.',
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.deleteTodo,
      parameters: {
        additionalProperties: false,
        properties: {
          taskId: {
            description: 'Todo id from listTodos or createTodo.',
            type: 'string',
          },
        },
        required: ['taskId'],
        type: 'object',
      },
    },
    {
      description:
        "List events on the caller's primary calendar in [from, to] (ISO 8601, Asia/Shanghai). Span at most 1 year. Recurrences are expanded. serverNow is in every result.",
      humanIntervention: 'never',
      name: DingtalkWorkspaceApiName.listEvents,
      parameters: {
        additionalProperties: false,
        properties: {
          from: isoDateTime,
          to: isoDateTime,
        },
        required: ['from', 'to'],
        type: 'object',
      },
    },
    {
      description: 'Get one calendar event by eventId from listEvents or createEvent.',
      humanIntervention: 'never',
      name: DingtalkWorkspaceApiName.getEvent,
      parameters: {
        additionalProperties: false,
        properties: {
          eventId: {
            description: 'Event id from listEvents or createEvent.',
            type: 'string',
          },
        },
        required: ['eventId'],
        type: 'object',
      },
    },
    {
      description:
        'Query free/busy for colleagues. Returns busy/free time blocks only — no event titles or details of other people. staffTokens are staff:<id> tokens or names (max 20). from/to are ISO 8601.',
      humanIntervention: 'never',
      name: DingtalkWorkspaceApiName.queryFreeBusy,
      parameters: {
        additionalProperties: false,
        properties: {
          from: isoDateTime,
          staffTokens: { ...staffTokenArray, maxItems: 20, minItems: 1 },
          to: isoDateTime,
        },
        required: ['staffTokens', 'from', 'to'],
        type: 'object',
      },
    },
    {
      description:
        'List bookable meeting rooms. Use roomId values as roomIds on createEvent. No model-facing filters.',
      humanIntervention: 'never',
      name: DingtalkWorkspaceApiName.listMeetingRooms,
      parameters: {
        additionalProperties: false,
        properties: {},
        required: [],
        type: 'object',
      },
    },
    {
      description:
        "Create an event on the caller's primary calendar. Organizer is always the caller. start/end are ISO 8601; all-day uses YYYY-MM-DD and isAllDay=true (end exclusive, T+1). attendeeTokens are staff:<id> or names. roomIds from listMeetingRooms (max 5). reminders are minutes before start. onlineMeeting=true adds a DingTalk meeting.",
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.createEvent,
      parameters: {
        additionalProperties: false,
        properties: {
          attendeeTokens: { ...staffTokenArray, maxItems: 500 },
          description: { maxLength: 5000, type: 'string' },
          end: isoDateTime,
          isAllDay: { description: 'When true, start/end are YYYY-MM-DD dates.', type: 'boolean' },
          location: { type: 'string' },
          onlineMeeting: {
            description: 'When true, attach a DingTalk video meeting.',
            type: 'boolean',
          },
          reminders: {
            description: 'Minutes before start to send a DingTalk reminder.',
            items: { type: 'number' },
            type: 'array',
          },
          roomIds: {
            description: 'Meeting-room ids from listMeetingRooms (max 5).',
            items: { type: 'string' },
            maxItems: 5,
            type: 'array',
          },
          start: isoDateTime,
          summary: {
            description: 'Event title (max 2048 characters).',
            maxLength: 2048,
            type: 'string',
          },
        },
        required: ['summary', 'start', 'end'],
        type: 'object',
      },
    },
    {
      description:
        'Update an event. Only the organizer can update. eventId from listEvents/createEvent. Omitted fields are left unchanged. attendeeTokens replaces the attendee list. roomIds replaces booked rooms (empty list clears; omitted leaves rooms unchanged).',
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.updateEvent,
      parameters: {
        additionalProperties: false,
        properties: {
          attendeeTokens: { ...staffTokenArray, maxItems: 500 },
          description: { maxLength: 5000, type: 'string' },
          end: isoDateTime,
          eventId: {
            description: 'Event id from listEvents or createEvent.',
            type: 'string',
          },
          isAllDay: { type: 'boolean' },
          location: { type: 'string' },
          onlineMeeting: { type: 'boolean' },
          reminders: {
            description: 'Minutes before start to send a DingTalk reminder.',
            items: { type: 'number' },
            type: 'array',
          },
          roomIds: {
            description:
              'Replacement meeting-room ids from listMeetingRooms (max 5). Empty list clears rooms.',
            items: { type: 'string' },
            maxItems: 5,
            type: 'array',
          },
          start: isoDateTime,
          summary: { maxLength: 2048, type: 'string' },
        },
        required: ['eventId'],
        type: 'object',
      },
    },
    {
      description:
        'Delete (cancel) an event. Only the organizer can delete for everyone. eventId from listEvents/createEvent.',
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.deleteEvent,
      parameters: {
        additionalProperties: false,
        properties: {
          eventId: {
            description: 'Event id from listEvents or createEvent.',
            type: 'string',
          },
        },
        required: ['eventId'],
        type: 'object',
      },
    },
    {
      description:
        'RSVP to an event. responseStatus is accepted, declined, tentative, or needsAction.',
      humanIntervention: 'always',
      name: DingtalkWorkspaceApiName.respondEvent,
      parameters: {
        additionalProperties: false,
        properties: {
          eventId: {
            description: 'Event id from listEvents.',
            type: 'string',
          },
          responseStatus: {
            description: 'accepted | declined | tentative | needsAction.',
            enum: [...DingtalkEventResponseStatuses],
            type: 'string',
          },
        },
        required: ['eventId', 'responseStatus'],
        type: 'object',
      },
    },
  ],
  identifier: DingtalkWorkspaceIdentifier,
  meta: {
    avatar: '📅',
    description: 'Create and manage DingTalk todos and calendar events',
    title: '钉钉日程与待办',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
