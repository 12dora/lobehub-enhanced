import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
  COMPANY_PROFILE_ASPECTS,
  ENTERPRISE_LOOKUP_PROVIDERS,
  EnterpriseLookupApiName,
  EnterpriseLookupIdentifier,
  QCC_CATEGORIES,
} from './types';

export { EnterpriseLookupIdentifier } from './types';

const providerSchema = {
  description:
    'qcc = 企查查; tianyancha = 天眼查. Omit to use the admin default (or the healthy fallback).',
  enum: [...ENTERPRISE_LOOKUP_PROVIDERS],
  type: 'string',
};

const categorySchema = {
  description:
    '企查查 category (company, risk, ipr, operation, executive, regulation, case, tender, history, document). Ignored for 天眼查 (always default). history requires vendor real-name verification.',
  enum: [...QCC_CATEGORIES, 'default'],
  type: 'string',
};

export const EnterpriseLookupManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Search a company by name and, when the match is unique (or the registered name equals the input), fetch 工商基本信息 in the same call. Use this first. If several companies match, the result lists candidates (name · 统一社会信用代码 · 法定代表人 · 状态) and fetches nothing else — ask the user, then retry with the exact name. Do not follow with listCapabilities or queryEnterprise to verify. Each upstream call consumes paid quota.',
      humanIntervention: 'never',
      name: EnterpriseLookupApiName.companyProfile,
      parameters: {
        additionalProperties: false,
        properties: {
          aspects: {
            description:
              'Dimensions of interest: basic (工商), people (股东/高管), risk, ipr. companyProfile always fetches 工商 when unique; extra dimensions still need listCapabilities + queryEnterprise.',
            items: { enum: [...COMPANY_PROFILE_ASPECTS], type: 'string' },
            type: 'array',
          },
          name: {
            description: 'Company name as the user gave it. Do not invent a registered name.',
            minLength: 1,
            type: 'string',
          },
          provider: providerSchema,
        },
        required: ['name'],
        type: 'object',
      },
    },
    {
      description:
        'List enabled enterprise-lookup capabilities and their inputSchema for a data provider. Call this only when companyProfile does not cover the dimension the user asked for, and after a PROVIDER_UNAVAILABLE fallback switch for a long-tail queryEnterprise. Never call twice in one conversation. Do not guess capability names.',
      humanIntervention: 'never',
      name: EnterpriseLookupApiName.listCapabilities,
      parameters: {
        additionalProperties: false,
        properties: {
          category: categorySchema,
          provider: providerSchema,
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Query one long-tail enterprise-lookup capability (风险 / 知识产权 / 招投标, etc.). Prefer companyProfile for 工商/基本信息. capability and argument keys must be copied from listCapabilities. If several companies match, ask the user — never guess. Each call consumes paid quota.',
      humanIntervention: 'never',
      name: EnterpriseLookupApiName.queryEnterprise,
      parameters: {
        additionalProperties: false,
        properties: {
          arguments: {
            additionalProperties: true,
            description:
              'Arguments matching the capability inputSchema from listCapabilities. Copy field names exactly.',
            type: 'object',
          },
          capability: {
            description: 'Capability / tool name copied from listCapabilities.',
            type: 'string',
          },
          category: categorySchema,
          provider: providerSchema,
        },
        required: ['capability'],
        type: 'object',
      },
    },
  ],
  humanIntervention: 'never',
  identifier: EnterpriseLookupIdentifier,
  meta: {
    avatar: '🏢',
    description: 'Look up company registration, risk, intellectual property, and related records',
    title: 'Enterprise Lookup',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
