import type { BuiltinRender } from '@lobechat/types';

import { EnterpriseLookupApiName } from '../../types';
import ListCapabilitiesRender from './ListCapabilities';
import QueryEnterpriseRender from './QueryEnterprise';

export interface EnterpriseLookupRenderProps {
  capability?: string;
  provider?: 'qcc' | 'tianyancha';
  resultText?: string;
  truncated?: boolean;
}

/**
 * Enterprise lookup Render registry: provider tag + capability + collapsible result.
 */
export const EnterpriseLookupRenders: Record<string, BuiltinRender> = {
  [EnterpriseLookupApiName.listCapabilities]: ListCapabilitiesRender as BuiltinRender,
  [EnterpriseLookupApiName.queryEnterprise]: QueryEnterpriseRender as BuiltinRender,
};

export { default as ListCapabilitiesRender } from './ListCapabilities';
export { default as QueryEnterpriseRender } from './QueryEnterprise';
