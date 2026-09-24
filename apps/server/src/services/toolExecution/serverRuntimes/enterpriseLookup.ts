import type { IEnterpriseLookupService } from '@lobechat/builtin-tool-enterprise-lookup/executionRuntime';
import {
  createEnterpriseLookupRuntime,
  EnterpriseLookupExecutionRuntime,
} from '@lobechat/builtin-tool-enterprise-lookup/executionRuntime';
import { EnterpriseLookupIdentifier } from '@lobechat/builtin-tool-enterprise-lookup/manifest';

import { serverAppLinkResolver } from '@/server/utils/appLinks';

import type { ServerRuntimeRegistration } from './types';

export { createEnterpriseLookupRuntime, EnterpriseLookupExecutionRuntime };
export type { IEnterpriseLookupService };

export const enterpriseLookupRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { serverDB, userId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for Enterprise Lookup execution');
    }

    // EL-A2 owns EnterpriseLookupService. Loaded lazily so unit tests can inject
    // a mock via createEnterpriseLookupRuntime without requiring the service module.
    const { EnterpriseLookupService } =
      await import('@/server/enterprise/services/enterpriseLookup');
    const lookup = new EnterpriseLookupService(serverDB, userId);

    return createEnterpriseLookupRuntime(
      {
        companyProfile: (params) => lookup.companyProfile(params),
        listCapabilities: (params) => lookup.listCapabilities(params),
        query: (params) => lookup.query(params),
      },
      { resolveLink: serverAppLinkResolver(context.botPlatform) },
    );
  },
  identifier: EnterpriseLookupIdentifier,
};
