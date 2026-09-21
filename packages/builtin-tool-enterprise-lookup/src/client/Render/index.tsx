import type { BuiltinRender } from '@lobechat/types';

import { EnterpriseLookupApiName } from '../../types';
import CompanyProfileRender from './CompanyProfile';
import ListCapabilitiesRender from './ListCapabilities';
import QueryEnterpriseRender from './QueryEnterprise';

export interface EnterpriseLookupRenderProps {
  capability?: string;
  provider?: 'qcc' | 'tianyancha';
  resultText?: string;
  truncated?: boolean;
}

/** Enterprise lookup Render registry: provider tag + capability + the answer as a readable table. */
export const EnterpriseLookupRenders: Record<string, BuiltinRender> = {
  [EnterpriseLookupApiName.companyProfile]: CompanyProfileRender as BuiltinRender,
  [EnterpriseLookupApiName.listCapabilities]: ListCapabilitiesRender as BuiltinRender,
  [EnterpriseLookupApiName.queryEnterprise]: QueryEnterpriseRender as BuiltinRender,
};

export type { CompanyProfileRenderState } from './CompanyProfile';
export { default as CompanyProfileRender } from './CompanyProfile';
export { default as ListCapabilitiesRender } from './ListCapabilities';
export * from './presenter';
export { default as QueryEnterpriseRender } from './QueryEnterprise';
export { EnterpriseResultView } from './ResultView';
