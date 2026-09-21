import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
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
        'List enabled enterprise-lookup capabilities and their inputSchema for a data provider. Call this before a new kind of query, and after a PROVIDER_UNAVAILABLE fallback switch. Do not guess capability names.',
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
        'Query one enterprise-lookup capability (工商 / 风险 / 知识产权, etc.). capability and argument keys must be copied from listCapabilities. Anchor the company with the provider search first; if several companies match, ask the user — never guess. Each call consumes paid quota.',
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
