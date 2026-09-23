import type { EnterpriseLookupProvider, QccCategory } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

type EnterpriseLookupCategory = QccCategory | 'default';

type CompanyProfileAspect = 'basic' | 'people' | 'risk';

/**
 * Client access to the 企业查询 (enterprise lookup) lambda router.
 * Mirrors `src/services/reminder.ts`: thin wrappers over `lambdaClient`.
 */
class EnterpriseLookupService {
  status = async () => {
    return lambdaClient.enterpriseLookup.status.query();
  };

  listCapabilities = async (params?: {
    category?: EnterpriseLookupCategory;
    provider?: EnterpriseLookupProvider;
  }) => {
    return lambdaClient.enterpriseLookup.listCapabilities.query(params ?? {});
  };

  companyProfile = async (params: {
    aspects?: CompanyProfileAspect[];
    name: string;
    provider?: EnterpriseLookupProvider;
  }) => {
    return lambdaClient.enterpriseLookup.companyProfile.mutate(params);
  };

  query = async (params: {
    arguments?: Record<string, unknown>;
    capability: string;
    category?: EnterpriseLookupCategory;
    provider?: EnterpriseLookupProvider;
  }) => {
    return lambdaClient.enterpriseLookup.query.mutate(params);
  };
}

export const enterpriseLookupService = new EnterpriseLookupService();
