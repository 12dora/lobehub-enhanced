import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
  DingtalkPersonalApiName,
  DingtalkPersonalIdentifier,
  DingtalkPersonalReportBoxes,
  DingtalkPersonalResourceTypes,
  DingtalkPersonalTodoPriorityValues,
  DingtalkPersonalTodoStatuses,
} from './types';

export { DingtalkPersonalIdentifier } from './types';

const isoDateTime = {
  description: 'ISO 8601 时间，例如 2026-09-22T18:00:00+08:00。',
  type: 'string',
} as const;

export const DingtalkPersonalManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        '列出当前用户本人的钉钉待办，包含在钉钉客户端里创建的待办。status 默认 open。不要用本接口查审批。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.listMyTodos,
      parameters: {
        additionalProperties: false,
        properties: {
          page: {
            description: '页码，从 1 开始，最大 40。省略则为第 1 页。',
            maximum: 40,
            minimum: 1,
            type: 'number',
          },
          status: {
            description: 'open 未完成，done 已完成，all 全部。省略视为 open。',
            enum: [...DingtalkPersonalTodoStatuses],
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description: '查看一条本人待办的详情。taskId 来自 listMyTodos。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.getTodo,
      parameters: {
        additionalProperties: false,
        properties: {
          taskId: {
            description: '待办 id，来自 listMyTodos。',
            type: 'string',
          },
        },
        required: ['taskId'],
        type: 'object',
      },
    },
    {
      description: '按群名关键词搜索当前用户所在的群。若返回多个群，先问用户是哪一个，不要猜测。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.searchGroups,
      parameters: {
        additionalProperties: false,
        properties: {
          query: {
            description: '群名关键词（核心词即可），最多 500 字。',
            maxLength: 500,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      description: '列出当前用户加入的群。翻页时传入上一页的 nextCursor。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.listMyGroups,
      parameters: {
        additionalProperties: false,
        properties: {
          cursor: {
            description: '上一页返回的 nextCursor。首页省略。',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        '拉取指定群在时间窗内的消息。startTime 与 endTime 的窗口不得超过 7 天，且 endTime 必须晚于 startTime。单次最多 500 条；更长区间请拆成多次调用。消息里的 files 用 downloadMessageFile 下载后再分析。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.listGroupMessages,
      parameters: {
        additionalProperties: false,
        properties: {
          conversationId: {
            description: '群会话 id，来自 searchGroups 或 listMyGroups。',
            type: 'string',
          },
          endTime: {
            ...isoDateTime,
            description: '窗口结束时间（ISO 8601）。与 startTime 相差不得超过 7 天。',
          },
          maxMessages: {
            description: '最多返回的消息条数，1 到 500。省略时由服务端按默认上限截断。',
            maximum: 500,
            minimum: 1,
            type: 'number',
          },
          startTime: {
            ...isoDateTime,
            description: '窗口开始时间（ISO 8601）。与 endTime 相差不得超过 7 天。',
          },
        },
        required: ['conversationId', 'startTime', 'endTime'],
        type: 'object',
      },
    },
    {
      description:
        '按消息正文关键词搜索，不是按群名搜索。总结某个群请用 searchGroups 再 listGroupMessages，不要把群名当作 query。可选 conversationId 限定一个群。同时给出 startTime 与 endTime 时窗口不得超过 7 天；都不给时默认近 7 天。没有命中会返回 count 0，不是错误。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.searchMessages,
      parameters: {
        additionalProperties: false,
        properties: {
          conversationId: {
            description: '可选。限定在某一个群内搜索。',
            type: 'string',
          },
          endTime: {
            ...isoDateTime,
            description: '可选结束时间。与 startTime 同时给出时，窗口不得超过 7 天。',
          },
          query: {
            description: '消息正文关键词，不是群名。最多 500 字。',
            maxLength: 500,
            minLength: 1,
            type: 'string',
          },
          startTime: {
            ...isoDateTime,
            description: '可选开始时间。与 endTime 同时给出时，窗口不得超过 7 天。',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      description:
        '下载群消息中的文件并读取可解析的文本（如表格、pdf、文档）。resourceId 与 resourceType 来自消息的 files。通常下载最新一份再分析。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.downloadMessageFile,
      parameters: {
        additionalProperties: false,
        properties: {
          conversationId: {
            description: '可选。消息所在群的会话 id。',
            type: 'string',
          },
          fileName: {
            description: '可选。展示用文件名，省略则用消息里的文件名。',
            type: 'string',
          },
          messageId: {
            description: '可选。文件所在消息的 id。',
            type: 'string',
          },
          resourceId: {
            description: '文件资源 id，来自消息 files[].resourceId。',
            type: 'string',
          },
          resourceType: {
            description: '资源类型，必须是 fileId 或 mediaId，与 files[].resourceType 一致。',
            enum: [...DingtalkPersonalResourceTypes],
            type: 'string',
          },
        },
        required: ['resourceId', 'resourceType'],
        type: 'object',
      },
    },
    {
      description:
        '列出当前用户本人的工作日志。box=inbox 为收到的日志，时间窗不超过 180 天；box=outbox 为发出的日志，时间窗不超过 20 天。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.listReports,
      parameters: {
        additionalProperties: false,
        properties: {
          box: {
            description: 'inbox 收件箱（窗口不超过 180 天），outbox 发件箱（窗口不超过 20 天）。',
            enum: [...DingtalkPersonalReportBoxes],
            type: 'string',
          },
          cursor: {
            description: '上一页返回的 nextCursor（整数）。首页省略或传 0。',
            minimum: 0,
            type: 'number',
          },
          endTime: {
            ...isoDateTime,
            description:
              '窗口结束时间（ISO 8601）。inbox 与 startTime 相差不超过 180 天，outbox 不超过 20 天。',
          },
          startTime: {
            ...isoDateTime,
            description:
              '窗口开始时间（ISO 8601）。inbox 与 endTime 相差不超过 180 天，outbox 不超过 20 天。',
          },
        },
        required: ['box', 'startTime', 'endTime'],
        type: 'object',
      },
    },
    {
      description: '按 reportId 查看一条工作日志的详情。reportId 来自 listReports。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.getReport,
      parameters: {
        additionalProperties: false,
        properties: {
          reportId: {
            description: '日志 id，来自 listReports。',
            type: 'string',
          },
        },
        required: ['reportId'],
        type: 'object',
      },
    },
    {
      description: '列出当前用户可提交的工作日志模板。写日报前先调用本接口，再 getReportTemplate。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.listReportTemplates,
      parameters: {
        additionalProperties: false,
        properties: {},
        required: [],
        type: 'object',
      },
    },
    {
      description:
        '按模板名称读取字段定义。随后 submitReport 时，contents 的 key 必须与这里的字段名完全一致，不要自造字段名。',
      humanIntervention: 'never',
      name: DingtalkPersonalApiName.getReportTemplate,
      parameters: {
        additionalProperties: false,
        properties: {
          name: {
            description: '模板名称，必须与 listReportTemplates 返回的 name 一致。',
            minLength: 1,
            type: 'string',
          },
        },
        required: ['name'],
        type: 'object',
      },
    },
    {
      description:
        '修改一条本人待办。taskId 必填，title、dueTime、priority 至少再给一项。priority 只能是 10、20、30、40。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkPersonalApiName.updateTodo,
      parameters: {
        additionalProperties: false,
        minProperties: 2,
        properties: {
          dueTime: {
            ...isoDateTime,
            description: '新的截止时间（ISO 8601）。与 title、priority 至少填一项。',
          },
          priority: {
            description: '优先级，只能是 10、20、30 或 40。',
            enum: [...DingtalkPersonalTodoPriorityValues],
            type: 'number',
          },
          taskId: {
            description: '待办 id，来自 listMyTodos。',
            type: 'string',
          },
          title: {
            description: '新的标题，最多 500 字。与 dueTime、priority 至少填一项。',
            maxLength: 500,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['taskId'],
        type: 'object',
      },
    },
    {
      description:
        '将一条本人待办标记为完成。taskId 来自 listMyTodos。两条及以上必须改用 completeTodos，不要并行或逐条多次调用本接口。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkPersonalApiName.completeTodo,
      parameters: {
        additionalProperties: false,
        properties: {
          taskId: {
            description: '待办 id，来自 listMyTodos。',
            type: 'string',
          },
        },
        required: ['taskId'],
        type: 'object',
      },
    },
    {
      description:
        '一次完成多条本人待办（1 到 20 条）。对多条待办做完成操作时必须调用 completeTodos 一次，不要并行或逐条多次调用 completeTodo。会弹出一张确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkPersonalApiName.completeTodos,
      parameters: {
        additionalProperties: false,
        properties: {
          taskIds: {
            description: '待办 id 列表，来自 listMyTodos。1 到 20 个，不能重复。',
            items: { minLength: 1, type: 'string' },
            maxItems: 20,
            minItems: 1,
            type: 'array',
            uniqueItems: true,
          },
        },
        required: ['taskIds'],
        type: 'object',
      },
    },
    {
      description:
        '按模板提交当前用户本人的工作日志。contents 的 key 必须与 getReportTemplate 的字段名完全一致，不要自造字段；content 只写用户提供的事实。toUserIds 为收件人 staffId（用 lobe-dingtalk-workspace 的 searchDirectory 查询）。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkPersonalApiName.submitReport,
      parameters: {
        additionalProperties: false,
        properties: {
          contents: {
            description:
              '日志正文。每一项的 key 必须与模板字段名完全一致。1 到 20 项，每项 content 最多 5000 字。',
            items: {
              additionalProperties: false,
              properties: {
                content: {
                  description: '该字段的正文，只根据用户给出的事实填写，最多 5000 字。',
                  maxLength: 5000,
                  type: 'string',
                },
                key: {
                  description: '模板字段名，必须与 getReportTemplate 返回的字段名完全一致。',
                  minLength: 1,
                  type: 'string',
                },
              },
              required: ['key', 'content'],
              type: 'object',
            },
            maxItems: 20,
            minItems: 1,
            type: 'array',
          },
          templateName: {
            description: '模板名称，来自 listReportTemplates / getReportTemplate。',
            minLength: 1,
            type: 'string',
          },
          toUserIds: {
            description: '收件人 staffId 列表，1 到 20 个。从 searchDirectory 原样复制，不要改写。',
            items: { minLength: 1, type: 'string' },
            maxItems: 20,
            minItems: 1,
            type: 'array',
          },
        },
        required: ['templateName', 'contents', 'toUserIds'],
        type: 'object',
      },
    },
  ],
  identifier: DingtalkPersonalIdentifier,
  meta: {
    avatar: '👤',
    description: '读取当前用户本人的钉钉待办、群消息和工作日志',
    title: '钉钉个人数据',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
