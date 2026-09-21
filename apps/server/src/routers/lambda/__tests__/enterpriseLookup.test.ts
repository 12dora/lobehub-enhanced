// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListCapabilities = vi.fn();
const mockQuery = vi.fn();
const mockStatus = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/server/enterprise/services/enterpriseLookup', () => {
  class EnterpriseLookupServiceError extends Error {
    readonly code: string;
    readonly fallbackProvider?: 'qcc' | 'tianyancha';
    constructor(code: string, options?: { fallbackProvider?: 'qcc' | 'tianyancha' }) {
      super(code);
      this.name = 'EnterpriseLookupServiceError';
      this.code = code;
      this.fallbackProvider = options?.fallbackProvider;
    }
  }
  return {
    ENTERPRISE_LOOKUP_INTERNAL: 'ENTERPRISE_LOOKUP_INTERNAL',
    ENTERPRISE_LOOKUP_NOT_CONFIGURED: 'ENTERPRISE_LOOKUP_NOT_CONFIGURED',
    ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
    EnterpriseLookupService: vi.fn(() => ({
      listCapabilities: mockListCapabilities,
      query: mockQuery,
      status: mockStatus,
    })),
    EnterpriseLookupServiceError,
    formatEnterpriseLookupClientError: (error: EnterpriseLookupServiceError) =>
      error.fallbackProvider ? `${error.code}:${error.fallbackProvider}` : error.code,
    isEnterpriseLookupErrorCode: (value: unknown) =>
      typeof value === 'string' && value.startsWith('ENTERPRISE_LOOKUP_'),
  };
});

const { enterpriseLookupRouter } = await import('../enterpriseLookup');
const { EnterpriseLookupServiceError } =
  await import('@/server/enterprise/services/enterpriseLookup');

const createCaller = () =>
  enterpriseLookupRouter.createCaller({ serverDB: {}, userId: 'user-1' } as never);

describe('enterpriseLookupRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('status and listCapabilities forward to the domain service', async () => {
    mockStatus.mockResolvedValueOnce({ configured: true, usedToday: 1 });
    mockListCapabilities.mockResolvedValueOnce({ categories: [], provider: 'qcc' });
    await expect(createCaller().status()).resolves.toEqual({ configured: true, usedToday: 1 });
    await expect(createCaller().listCapabilities({ provider: 'qcc' })).resolves.toEqual({
      categories: [],
      provider: 'qcc',
    });
    expect(mockListCapabilities).toHaveBeenCalledWith({ provider: 'qcc' });
  });

  it('query redacts unknown failures to ENTERPRISE_LOOKUP_INTERNAL', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Authorization: Bearer sk-live ECONNREFUSED'));
    await expect(
      createCaller().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'ENTERPRISE_LOOKUP_INTERNAL',
    });
  });

  it('query maps PROVIDER_UNAVAILABLE with fallbackProvider', async () => {
    mockQuery.mockRejectedValueOnce(
      new EnterpriseLookupServiceError('ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE', {
        fallbackProvider: 'tianyancha',
      }),
    );
    await expect(
      createCaller().query({ arguments: { keyword: '华为' }, capability: 'search' }),
    ).rejects.toMatchObject({
      cause: {
        data: {
          code: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE',
          fallbackProvider: 'tianyancha',
        },
      },
      code: 'BAD_REQUEST',
      message: 'ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE:tianyancha',
    });
  });

  it('defaults omitted query arguments to an empty object', async () => {
    mockQuery.mockResolvedValueOnce({ content: '{}', capability: 'search', provider: 'qcc' });
    await expect(createCaller().query({ capability: 'search' })).resolves.toMatchObject({
      capability: 'search',
    });
    expect(mockQuery).toHaveBeenCalledWith({ arguments: {}, capability: 'search' });
  });

  it('rejects a non-enum category', async () => {
    await expect(
      createCaller().query({
        arguments: { keyword: '华为' },
        capability: 'search',
        category: '../other',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a non-enum category on listCapabilities', async () => {
    await expect(
      createCaller().listCapabilities({ category: '../other' } as never),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockListCapabilities).not.toHaveBeenCalled();
  });

  it('does not accept a client-supplied userId', async () => {
    mockQuery.mockResolvedValueOnce({ content: '{}', capability: 'search', provider: 'qcc' });
    await expect(
      createCaller().query({
        arguments: { keyword: '华为' },
        capability: 'search',
        userId: 'other-user',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
