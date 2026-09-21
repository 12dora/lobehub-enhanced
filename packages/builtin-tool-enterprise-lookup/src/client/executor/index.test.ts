/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listCapabilities = vi.fn().mockResolvedValue({
  categories: [],
  provider: 'qcc',
});
const query = vi.fn();
const companyProfile = vi.fn();

vi.mock('@/services/enterpriseLookup', () => ({
  enterpriseLookupService: {
    companyProfile,
    listCapabilities,
    query,
    status: vi.fn(),
  },
}));

const { enterpriseLookupExecutor } = await import('./index');

describe('enterpriseLookupExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCapabilities.mockResolvedValue({
      categories: [],
      provider: 'qcc',
    });
  });

  it('passes provider and category to enterpriseLookupService.listCapabilities', async () => {
    await enterpriseLookupExecutor.listCapabilities({ category: 'risk', provider: 'qcc' });
    expect(listCapabilities).toHaveBeenCalledWith({ category: 'risk', provider: 'qcc' });
  });

  it('forwards queryEnterprise capability and arguments', async () => {
    query.mockResolvedValueOnce({
      capability: 'search',
      provider: 'tianyancha',
      result: { name: '示例' },
    });
    await enterpriseLookupExecutor.queryEnterprise({
      arguments: { keyword: '示例' },
      capability: 'search',
      provider: 'tianyancha',
    });
    expect(query).toHaveBeenCalledWith({
      arguments: { keyword: '示例' },
      capability: 'search',
      provider: 'tianyancha',
    });
  });

  it('forwards companyProfile name and aspects', async () => {
    companyProfile.mockResolvedValueOnce({
      aspects: ['basic'],
      candidates: [{ name: '华为技术有限公司' }],
      match: 'unique',
      provider: 'qcc',
      queriedAt: '2026-09-21 20:07',
      query: '华为技术有限公司',
    });
    await enterpriseLookupExecutor.companyProfile({
      aspects: ['basic'],
      name: '华为技术有限公司',
      provider: 'qcc',
    });
    expect(companyProfile).toHaveBeenCalledWith({
      aspects: ['basic'],
      name: '华为技术有限公司',
      provider: 'qcc',
    });
  });
});
