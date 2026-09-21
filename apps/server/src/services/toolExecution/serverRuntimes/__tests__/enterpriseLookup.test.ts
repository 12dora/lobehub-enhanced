// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListCapabilities = vi.fn();
const mockQuery = vi.fn();
const mockCompanyProfile = vi.fn();

vi.mock('@/server/enterprise/services/enterpriseLookup', () => ({
  EnterpriseLookupService: vi.fn(() => ({
    companyProfile: mockCompanyProfile,
    listCapabilities: mockListCapabilities,
    query: mockQuery,
  })),
}));

const { enterpriseLookupRuntime } = await import('../enterpriseLookup');

describe('enterpriseLookupRuntime.factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCapabilities.mockResolvedValue({ categories: [], provider: 'qcc' });
    mockCompanyProfile.mockResolvedValue({
      aspects: ['basic'],
      candidates: [{ name: '华为技术有限公司' }],
      match: 'unique',
      provider: 'qcc',
      queriedAt: '2026-09-21 20:07',
      query: '华为技术有限公司',
    });
  });

  it('requires userId and serverDB', async () => {
    await expect(enterpriseLookupRuntime.factory({} as any)).rejects.toThrow(
      'userId and serverDB are required',
    );
  });

  it('wires companyProfile onto the execution runtime', async () => {
    const runtime = await enterpriseLookupRuntime.factory({
      serverDB: {},
      userId: 'user-1',
    } as any);

    expect(enterpriseLookupRuntime.identifier).toBe('lobe-enterprise-lookup');
    const result = await runtime.companyProfile({ name: '华为技术有限公司' });
    expect(result.success).toBe(true);
    expect(mockCompanyProfile).toHaveBeenCalledWith({ name: '华为技术有限公司' });
    expect(result.state).toMatchObject({ match: 'unique', matched: true });
  });
});
