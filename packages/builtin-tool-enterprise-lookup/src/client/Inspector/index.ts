import type { BuiltinInspector } from '@lobechat/types';

import { EnterpriseLookupApiName } from '../../types';
import { ListCapabilitiesInspector } from './ListCapabilities';
import { QueryEnterpriseInspector } from './QueryEnterprise';

/**
 * Enterprise lookup Inspector components registry.
 *
 * Inspector title is 「企业查询 · <capability>」.
 */
export const EnterpriseLookupInspectors: Record<string, BuiltinInspector> = {
  [EnterpriseLookupApiName.listCapabilities]: ListCapabilitiesInspector as BuiltinInspector,
  [EnterpriseLookupApiName.queryEnterprise]: QueryEnterpriseInspector as BuiltinInspector,
};

export { ListCapabilitiesInspector } from './ListCapabilities';
export { QueryEnterpriseInspector } from './QueryEnterprise';
