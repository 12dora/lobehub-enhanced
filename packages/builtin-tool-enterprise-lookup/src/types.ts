export const EnterpriseLookupIdentifier = 'lobe-enterprise-lookup';

export const EnterpriseLookupApiName = {
  listCapabilities: 'listCapabilities',
  queryEnterprise: 'queryEnterprise',
} as const;

export type EnterpriseLookupApiNameType =
  (typeof EnterpriseLookupApiName)[keyof typeof EnterpriseLookupApiName];

export const ENTERPRISE_LOOKUP_PROVIDERS = ['qcc', 'tianyancha'] as const;

export type EnterpriseLookupProvider = (typeof ENTERPRISE_LOOKUP_PROVIDERS)[number];

export const QCC_CATEGORIES = [
  'company',
  'risk',
  'ipr',
  'operation',
  'executive',
  'regulation',
  'case',
  'tender',
  'history',
  'document',
] as const;

export type QccCategory = (typeof QCC_CATEGORIES)[number];

export type EnterpriseLookupCategory = QccCategory | 'default';

export interface ListCapabilitiesParams {
  category?: EnterpriseLookupCategory;
  provider?: EnterpriseLookupProvider;
}

export interface EnterpriseLookupToolInfo {
  description?: string;
  inputSchema?: unknown;
  name: string;
}

export interface EnterpriseLookupCategoryInfo {
  category: string;
  tools: EnterpriseLookupToolInfo[];
}

export interface ListCapabilitiesResult {
  categories: EnterpriseLookupCategoryInfo[];
  provider: EnterpriseLookupProvider;
}

export interface ListCapabilitiesState {
  category?: string;
  provider?: EnterpriseLookupProvider;
  resultText?: string;
  success: boolean;
  toolCount?: number;
  truncated?: boolean;
}

export interface QueryEnterpriseParams {
  arguments?: Record<string, unknown>;
  capability: string;
  category?: EnterpriseLookupCategory;
  provider?: EnterpriseLookupProvider;
}

export interface QueryEnterpriseResult {
  capability?: string;
  category?: string;
  provider?: EnterpriseLookupProvider;
  result?: unknown;
}

export interface QueryEnterpriseState {
  capability?: string;
  category?: string;
  provider?: EnterpriseLookupProvider;
  resultText?: string;
  success: boolean;
  truncated?: boolean;
}

export const isEnterpriseLookupProvider = (value: unknown): value is EnterpriseLookupProvider =>
  value === 'qcc' || value === 'tianyancha';
