import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasMarketSdkAuth,
  isMarketConnectionsAuthError,
  isMarketConnectionsTimeoutError,
  listMarketConnectionsWithTimeout,
  listOptionalMarketConnectionsWithTimeout,
  MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS,
} from './marketConnections';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('marketConnections helpers', () => {
  it('passes an abort signal to the Market SDK listConnections request', async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const listConnections = vi.fn().mockResolvedValue({ connections: [] });

    await expect(listMarketConnectionsWithTimeout({ listConnections })).resolves.toEqual({
      connections: [],
    });

    expect(timeoutSpy).toHaveBeenCalledWith(MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS);
    expect(listConnections).toHaveBeenCalledWith({ signal: controller.signal });
  });

  it('detects AbortSignal timeout errors', () => {
    expect(isMarketConnectionsTimeoutError(new DOMException('Timed out', 'TimeoutError'))).toBe(
      true,
    );
    expect(isMarketConnectionsTimeoutError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isMarketConnectionsTimeoutError(new Error('market failed'))).toBe(false);
  });

  it('detects Market auth failures', () => {
    expect(
      isMarketConnectionsAuthError({
        errorBody: { error: 'unauthorized', error_description: 'Missing bearer token' },
        status: 401,
      }),
    ).toBe(true);
    expect(isMarketConnectionsAuthError(new Error('Network error'))).toBe(false);
  });

  it('skips the market call when the client has no access token', async () => {
    const listConnections = vi.fn();

    await expect(listOptionalMarketConnectionsWithTimeout({ listConnections })).resolves.toEqual({
      connections: [],
      success: true,
    });
    expect(listConnections).not.toHaveBeenCalled();
  });

  it('skips the market call when bearer, trust token, and client credentials are all absent', async () => {
    const listConnections = vi.fn();

    await expect(
      listOptionalMarketConnectionsWithTimeout({
        clientId: '   ',
        headers: { 'Authorization': 'Bearer   ', 'x-lobe-trust-token': '  ' },
        listConnections,
      }),
    ).resolves.toEqual({ connections: [], success: true });
    expect(hasMarketSdkAuth({ clientId: 'client-id' })).toBe(false);
    expect(listConnections).not.toHaveBeenCalled();
  });

  it('calls the SDK when only a trusted-client token is configured', async () => {
    const listConnections = vi.fn().mockResolvedValue({
      connections: [{ id: 'trusted' }],
      success: true,
    });

    await expect(
      listOptionalMarketConnectionsWithTimeout({
        headers: { 'x-lobe-trust-token': 'trust-token' },
        listConnections,
      }),
    ).resolves.toEqual({
      connections: [{ id: 'trusted' }],
      success: true,
    });
    expect(listConnections).toHaveBeenCalledOnce();
  });

  it('calls the SDK when only client credentials are configured', async () => {
    const listConnections = vi.fn().mockResolvedValue({
      connections: [{ id: 'm2m' }],
      success: true,
    });

    await expect(
      listOptionalMarketConnectionsWithTimeout({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        listConnections,
      }),
    ).resolves.toEqual({
      connections: [{ id: 'm2m' }],
      success: true,
    });
    expect(listConnections).toHaveBeenCalledOnce();
  });

  it('returns empty connections for optional auth failures', async () => {
    const listConnections = vi.fn().mockRejectedValue({
      errorBody: { error: 'unauthorized', error_description: 'Missing bearer token' },
      status: 401,
    });

    await expect(
      listOptionalMarketConnectionsWithTimeout({
        headers: { Authorization: 'Bearer market-token' },
        listConnections,
      }),
    ).resolves.toEqual({
      connections: [],
      success: true,
    });
    expect(listConnections).toHaveBeenCalledOnce();
  });

  it('rethrows non-auth failures for optional connections', async () => {
    const error = new Error('Market API unavailable');
    const listConnections = vi.fn().mockRejectedValue(error);

    await expect(
      listOptionalMarketConnectionsWithTimeout({
        headers: { Authorization: 'Bearer market-token' },
        listConnections,
      }),
    ).rejects.toBe(error);
  });
});
