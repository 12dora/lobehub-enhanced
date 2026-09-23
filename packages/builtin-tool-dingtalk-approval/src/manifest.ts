import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
  DingtalkApprovalIdentifier,
  DingtalkApprovalReadApiName,
  DingtalkApprovalWriteApiName,
  SAVE_TEMPLATE_COMPONENT_TYPES,
} from './types';

export { DingtalkApprovalIdentifier } from './types';

const SAVE_TEMPLATE_LEAF_TYPES = SAVE_TEMPLATE_COMPONENT_TYPES.filter(
  (type) => type !== 'TableField',
);

const saveTemplateLeafFieldSchema = {
  additionalProperties: false,
  properties: {
    bizAlias: { type: 'string' },
    componentId: { type: 'string' },
    componentType: {
      description: 'Column control. TableField cannot be nested inside a table.',
      enum: [...SAVE_TEMPLATE_LEAF_TYPES],
      type: 'string',
    },
    format: { type: 'string' },
    label: { type: 'string' },
    options: { items: { type: 'string' }, type: 'array' },
    placeholder: { type: 'string' },
    required: { type: 'boolean' },
    unit: { type: 'string' },
  },
  required: ['componentType', 'label'],
  type: 'object',
};

const staffTokenDescription =
  'staff:<id> copied verbatim from searchDirectory, or a person name the server resolves. Never invent ids. Ambiguous names return DINGTALK_AMBIGUOUS.';

const staffTokenSchema = {
  description: staffTokenDescription,
  minLength: 1,
  type: 'string',
};

const formValuesSchema = {
  description:
    'Form values as strings. Provide componentId or label for each item. Numbers/money as "100"; multi-select as a JSON array string; dates as YYYY-MM-DD. Do not invent required values.',
  items: {
    additionalProperties: false,
    properties: {
      componentId: {
        description: 'Schema component id. Provide this or label.',
        type: 'string',
      },
      label: {
        description: 'Control label. Provide this or componentId.',
        type: 'string',
      },
      value: {
        description: 'Stringified value for this control.',
        type: 'string',
      },
    },
    required: ['value'],
    type: 'object',
  },
  minItems: 1,
  type: 'array',
};

const approvalRuleConditionsSchema = {
  additionalProperties: false,
  description:
    'Structured match conditions. match is always all. originators.staffIds are staff:<id> tokens or the literal "me" for the caller (server-resolved; do not searchDirectory for the current user). fields[].componentId must exist on the template schema; numeric ops only on NumberField/MoneyField.',
  properties: {
    fields: {
      items: {
        additionalProperties: false,
        properties: {
          componentId: { description: 'Template schema component id.', type: 'string' },
          label: { description: 'Field label for the confirm card.', type: 'string' },
          op: {
            description: 'eq/ne/lt/lte/gt/gte for numbers; contains/in/eq/ne for text and selects.',
            enum: ['contains', 'eq', 'gt', 'gte', 'in', 'lt', 'lte', 'ne'],
            type: 'string',
          },
          value: {
            description: 'Comparison value. Use a string array for in/contains on multi-select.',
            oneOf: [
              { type: 'string' },
              { type: 'number' },
              { items: { type: 'string' }, type: 'array' },
            ],
          },
        },
        required: ['componentId', 'label', 'op', 'value'],
        type: 'object',
      },
      type: 'array',
    },
    match: {
      description: 'All listed originator and field conditions must match.',
      enum: ['all'],
      type: 'string',
    },
    originators: {
      additionalProperties: false,
      properties: {
        deptIds: {
          description: 'Originator department ids (includes sub-departments).',
          items: { type: 'string' },
          type: 'array',
        },
        staffIds: {
          description:
            'Originator staff:<id> tokens, or the literal "me" for the caller. Do not call searchDirectory to resolve the current user.',
          items: { type: 'string' },
          type: 'array',
        },
      },
      type: 'object',
    },
  },
  required: ['match'],
  type: 'object',
};

const ruleActionSchema = {
  description: 'agree / refuse (needs remark) / redirect (needs redirectToStaffToken) / comment.',
  enum: ['agree', 'comment', 'redirect', 'refuse'],
  type: 'string',
};

const never = 'never' as const;
const always = 'always' as const;

export const DingtalkApprovalManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'List OA approval templates visible to the current user. Optional q filters by name. Use processCode from the result in later calls.',
      humanIntervention: never,
      name: DingtalkApprovalReadApiName.listTemplates,
      parameters: {
        additionalProperties: false,
        properties: {
          q: { description: 'Optional template name keyword.', type: 'string' },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Get the form schema for a template (labels, componentId, type, required, options, format, unit, bizAlias). Call this before submitApproval or compiling rule field conditions. Preserve format/unit/bizAlias when calling saveTemplate. Does not include the approval flow.',
      humanIntervention: never,
      name: DingtalkApprovalReadApiName.getTemplateSchema,
      parameters: {
        additionalProperties: false,
        properties: {
          processCode: { description: 'Template processCode from listTemplates.', type: 'string' },
        },
        required: ['processCode'],
        type: 'object',
      },
    },
    {
      description:
        'List tasks currently waiting on the user (待我审批). Use this — and only this — for 「没审批的 / 待我审批」. Do not also call listMyApplications. Identical queries are cached for about 5 minutes; pass refresh:true only when the user asks to refresh. May be truncated on the standard edition (truncated=true). Each row has processInstanceId and taskId for write APIs.',
      humanIntervention: never,
      name: DingtalkApprovalReadApiName.listPendingApprovals,
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description: 'Max rows to return (1–50). Never pass more than 50.',
            maximum: 50,
            minimum: 1,
            type: 'integer',
          },
          refresh: {
            description:
              'Bypass the 5-minute cache and scan again. Use only when the user asks to refresh. Default false.',
            type: 'boolean',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'List approval instances the current user started (我发起的). Use only when they ask about requests they submitted. Never combine with listPendingApprovals for 「待我审批」. Optional status filter: RUNNING, COMPLETED, TERMINATED.',
      humanIntervention: never,
      name: DingtalkApprovalReadApiName.listMyApplications,
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description: 'Max rows to return (1–50). Never pass more than 50.',
            maximum: 50,
            minimum: 1,
            type: 'integer',
          },
          status: {
            description: 'Instance status filter. Omit for all.',
            enum: ['COMPLETED', 'RUNNING', 'TERMINATED'],
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Get one instance: form values, tasks, and operation records. Allowed if the user is originator, a task handler, or CC.',
      humanIntervention: never,
      name: DingtalkApprovalReadApiName.getApprovalDetail,
      parameters: {
        additionalProperties: false,
        properties: {
          processInstanceId: { description: 'Instance id.', type: 'string' },
        },
        required: ['processInstanceId'],
        type: 'object',
      },
    },
    {
      description:
        'Search the DingTalk directory. Copy returned staff:<id> tokens verbatim into write APIs. If several people share a name, ambiguous is true — list 「姓名 · 部门」 and ask; do not guess.',
      humanIntervention: never,
      name: DingtalkApprovalReadApiName.searchDirectory,
      parameters: {
        additionalProperties: false,
        properties: {
          kind: {
            description: 'Optional filter. Omit to search both people and departments.',
            enum: ['department', 'user'],
            type: 'string',
          },
          q: { description: 'Name, pinyin, or department keyword.', type: 'string' },
        },
        required: ['q'],
        type: 'object',
      },
    },
    {
      description:
        "List the current user's automatic approval rules. includeDisabled=true also returns stopped rules.",
      humanIntervention: never,
      name: DingtalkApprovalReadApiName.listApprovalRules,
      parameters: {
        additionalProperties: false,
        properties: {
          includeDisabled: {
            description: 'When true, include disabled rules.',
            type: 'boolean',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Submit a new approval as the current user. Originator is always the caller. Validate required fields against getTemplateSchema first. Suite templates are rejected. Pass staff:<id> tokens for approvers/CC/target-select; names are resolved server-side.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.submitApproval,
      parameters: {
        additionalProperties: false,
        properties: {
          approverStaffTokens: {
            description:
              'Optional sequential approver nodes (overrides the console flow). Each token is one person. Max 20 nodes.',
            items: staffTokenSchema,
            maxItems: 20,
            type: 'array',
          },
          ccStaffTokens: {
            description:
              'CC list. Only applied when approverStaffTokens is also passed; otherwise the console CC config is used. Max 50.',
            items: staffTokenSchema,
            maxItems: 50,
            type: 'array',
          },
          deptId: {
            description:
              'Originator dept id. Required when approverStaffTokens is omitted (root = -1).',
            type: 'number',
          },
          formValues: formValuesSchema,
          processCode: { description: 'Template processCode.', type: 'string' },
          targetSelectActioners: {
            description:
              'Required when the console flow has 发起人自选 nodes. actionerKey comes from forecast.',
            items: {
              additionalProperties: false,
              properties: {
                actionerKey: { type: 'string' },
                actionerStaffTokens: { items: staffTokenSchema, type: 'array' },
              },
              required: ['actionerKey', 'actionerStaffTokens'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['processCode', 'formValues'],
        type: 'object',
      },
    },
    {
      description:
        'Agree a pending task. Caller must be the current RUNNING handler. One call per task; never parallel.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.approveTask,
      parameters: {
        additionalProperties: false,
        properties: {
          processInstanceId: { type: 'string' },
          remark: { description: 'Optional comment.', type: 'string' },
          taskId: { description: 'Pending task id.', type: 'string' },
        },
        required: ['processInstanceId', 'taskId'],
        type: 'object',
      },
    },
    {
      description:
        'Refuse a pending task. A reason from the user is required (remark). One refuse ends the instance. One call per task; never parallel.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.refuseTask,
      parameters: {
        additionalProperties: false,
        properties: {
          processInstanceId: { type: 'string' },
          remark: {
            description: 'Required refusal reason from the user.',
            minLength: 1,
            type: 'string',
          },
          taskId: { type: 'string' },
        },
        required: ['processInstanceId', 'taskId', 'remark'],
        type: 'object',
      },
    },
    {
      description:
        'Transfer a pending task to another person. Caller must be the current handler. toStaffToken is staff:<id> or a name.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.transferTask,
      parameters: {
        additionalProperties: false,
        properties: {
          processInstanceId: { type: 'string' },
          remark: { type: 'string' },
          taskId: { type: 'string' },
          toStaffToken: staffTokenSchema,
        },
        required: ['processInstanceId', 'taskId', 'toStaffToken'],
        type: 'object',
      },
    },
    {
      description: 'Add a comment on an approval instance.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.commentApproval,
      parameters: {
        additionalProperties: false,
        properties: {
          processInstanceId: { type: 'string' },
          text: { description: 'Comment body.', minLength: 1, type: 'string' },
        },
        required: ['processInstanceId', 'text'],
        type: 'object',
      },
    },
    {
      description:
        'Withdraw (terminate) an in-progress instance. Caller must be the originator. Cannot run within 15s of creation. Does not withdraw an already-approved decision (no such OpenAPI).',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.withdrawApplication,
      parameters: {
        additionalProperties: false,
        properties: {
          processInstanceId: { type: 'string' },
          remark: { type: 'string' },
        },
        required: ['processInstanceId'],
        type: 'object',
      },
    },
    {
      description:
        'Return a task to an approver node or to the originator. OA premium only. Needs a reason from the user. For REVERT_FOR_RESUBMIT use targetActivityId sid-startevent.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.returnTask,
      parameters: {
        additionalProperties: false,
        properties: {
          processInstanceId: { type: 'string' },
          remark: {
            description: 'Required return reason from the user.',
            minLength: 1,
            type: 'string',
          },
          revertAction: {
            enum: ['REVERT_FOR_APPROVAL', 'REVERT_FOR_RESUBMIT'],
            type: 'string',
          },
          targetActivityId: {
            description: 'activityId from forecast; sid-startevent when reverting to originator.',
            type: 'string',
          },
          taskId: { type: 'string' },
        },
        required: ['processInstanceId', 'taskId', 'revertAction', 'targetActivityId', 'remark'],
        type: 'object',
      },
    },
    {
      description:
        'Add approvers before or after the current node (加签). OA premium only. appenderStaffTokens are staff:<id> or names.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.addApprover,
      parameters: {
        additionalProperties: false,
        properties: {
          activateType: {
            description:
              'ALL = parallel (会签/或签); ONE_BY_ONE = sequential (only if the node is sequential).',
            enum: ['ALL', 'ONE_BY_ONE'],
            type: 'string',
          },
          agreeAll: {
            description: 'true = 会签/依次; false = 或签.',
            type: 'boolean',
          },
          appenderStaffTokens: {
            items: staffTokenSchema,
            minItems: 1,
            type: 'array',
          },
          processInstanceId: { type: 'string' },
          remark: { type: 'string' },
          taskId: { type: 'string' },
          type: { enum: ['after', 'before'], type: 'string' },
        },
        required: ['processInstanceId', 'taskId', 'appenderStaffTokens', 'type', 'activateType'],
        type: 'object',
      },
    },
    {
      description:
        'Create or update an official approval form template. Omit processCode to create. Caller must be an OA approval admin. The result is authoritative (processCode, fields, adminUrl, notes) — do not listTemplates or getTemplateSchema to verify. Flow nodes, visibility, and CC cannot be set via API; use the returned adminUrl and remaining steps. Do not add a 流水号/编号 field — DingTalk generates it.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.saveTemplate,
      parameters: {
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          fields: {
            description:
              'Form controls in display order. Types: AddressField address; DDAttachment files; DDDateField date (unit 天|小时); DDDateRangeField start/end (label is a JSON string of two labels; unit 天|小时); DDMultiSelectField multi-choice (≥2 options); DDPhotoField photos; DDSelectField single choice (≥2 options); DepartmentField department; IdCardField ID number; InnerContactField people (single person; default and read-only are not supported); MoneyField amount (set unit to 元 when the amount is in 元); NumberField number (unit optional); PhoneField phone; StarRatingField 1–5 stars; TableField one detail table (children are the columns, one level, same types except TableField); TextareaField long text; TextField short text; TextNote static note (needs content). 流水号/编号 needs no field. Not available via API: SeqNumberField; CalculateField — formulas are not available via API, use MoneyField or NumberField and set the formula in the DingTalk designer; RelateField — not available via API, use a TextField "关联立项单号" and tell the user to switch it to 关联审批单 in the DingTalk designer; RecipientAccountField.',
            items: {
              additionalProperties: false,
              properties: {
                bizAlias: { type: 'string' },
                children: {
                  description:
                    'TableField columns only. One level. Same controls as the parent except TableField.',
                  items: saveTemplateLeafFieldSchema,
                  type: 'array',
                },
                componentId: { type: 'string' },
                componentType: {
                  description:
                    'Verified OA control. 流水号/编号 needs no field (DingTalk generates it). TableField needs children.',
                  enum: [...SAVE_TEMPLATE_COMPONENT_TYPES],
                  type: 'string',
                },
                format: { type: 'string' },
                label: { type: 'string' },
                options: { items: { type: 'string' }, type: 'array' },
                placeholder: { type: 'string' },
                required: { type: 'boolean' },
                unit: { type: 'string' },
              },
              required: ['componentType', 'label'],
              type: 'object',
            },
            minItems: 1,
            type: 'array',
          },
          name: { type: 'string' },
          processCode: {
            description: 'Present = update; omit = create.',
            type: 'string',
          },
        },
        required: ['name', 'fields'],
        type: 'object',
      },
    },
    {
      description: 'Delete an approval template. Caller must be an OA approval admin.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.deleteTemplate,
      parameters: {
        additionalProperties: false,
        properties: {
          processCode: { type: 'string' },
        },
        required: ['processCode'],
        type: 'object',
      },
    },
    {
      description:
        'Create an automatic approval rule. Compile the user\'s request into structured conditions after reading getTemplateSchema. originators.staffIds may be staff:<id> or "me" for the caller — do not searchDirectory for the current user. redirect needs redirectToStaffToken; refuse needs remark. Strict tier may require expiresAt.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.createApprovalRule,
      parameters: {
        additionalProperties: false,
        properties: {
          action: ruleActionSchema,
          conditions: approvalRuleConditionsSchema,
          expiresAt: {
            description:
              'ISO 8601 expiry. Required on strict tier (default 30d, max 90d). Omit for no expiry when the tier allows it.',
            type: 'string',
          },
          name: { type: 'string' },
          processCode: { type: 'string' },
          processName: { description: 'Template display name.', type: 'string' },
          redirectToStaffToken: {
            ...staffTokenSchema,
            description: `Required when action is redirect. ${staffTokenDescription}`,
          },
          remark: {
            description: 'Required when action is refuse. Used as the auto-action comment.',
            type: 'string',
          },
        },
        required: ['name', 'processCode', 'processName', 'conditions', 'action'],
        type: 'object',
      },
    },
    {
      description:
        'Update an automatic approval rule, including enable/disable (enabled=true/false). Omit unchanged fields.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.updateApprovalRule,
      parameters: {
        additionalProperties: false,
        properties: {
          action: ruleActionSchema,
          conditions: approvalRuleConditionsSchema,
          enabled: {
            description: 'true = enable; false = disable. This is how stop/start is done.',
            type: 'boolean',
          },
          expiresAt: {
            description: 'ISO 8601 expiry, or null to clear when the tier allows it.',
            type: ['string', 'null'],
          },
          id: { description: 'Rule id from listApprovalRules.', type: 'string' },
          name: { type: 'string' },
          processCode: { type: 'string' },
          processName: { type: 'string' },
          redirectToStaffToken: staffTokenSchema,
          remark: { type: 'string' },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description: 'Delete an automatic approval rule.',
      humanIntervention: always,
      name: DingtalkApprovalWriteApiName.deleteApprovalRule,
      parameters: {
        additionalProperties: false,
        properties: {
          id: { description: 'Rule id from listApprovalRules.', type: 'string' },
        },
        required: ['id'],
        type: 'object',
      },
    },
  ],
  identifier: DingtalkApprovalIdentifier,
  meta: {
    avatar: '📋',
    description: 'View and handle DingTalk approvals, and manage automation rules',
    title: 'DingTalk Approval',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
