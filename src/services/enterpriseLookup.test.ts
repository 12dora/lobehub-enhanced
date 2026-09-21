import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { enterpriseLookupService } from './enterpriseLookup';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    enterpriseLookup: {
      companyProfile: { mutate: vi.fn() },
      listCapabilities: { query: vi.fn() },
      query: { mutate: vi.fn() },
      status: { query: vi.fn() },
    },
  },
}));

const lookup = (lambdaClient as any).enterpriseLookup;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enterpriseLookupService', () => {
  it('forwards companyProfile to the lambda mutation', async () => {
    lookup.companyProfile.mutate.mockResolvedValueOnce({ match: 'unique', provider: 'qcc' });
    const params = {
      aspects: ['basic' as const],
      name: '华为技术有限公司',
      provider: 'qcc' as const,
    };
    await enterpriseLookupService.companyProfile(params);
    expect(lookup.companyProfile.mutate).toHaveBeenCalledWith(params);
  });

  it('forwards listCapabilities and query', async () => {
    lookup.listCapabilities.query.mockResolvedValueOnce({ categories: [], provider: 'qcc' });
    lookup.query.mutate.mockResolvedValueOnce({ capability: 'search', provider: 'qcc' });
    await enterpriseLookupService.listCapabilities({ provider: 'qcc' });
    await enterpriseLookupService.query({ capability: 'search', arguments: { keyword: '华为' } });
    expect(lookup.listCapabilities.query).toHaveBeenCalledWith({ provider: 'qcc' });
    expect(lookup.query.mutate).toHaveBeenCalledWith({
      arguments: { keyword: '华为' },
      capability: 'search',
    });
  });
});
