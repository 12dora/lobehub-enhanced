// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentFetchError, imageUrlToBase64 } from './imageToBase64';
import { setOwnDeploymentOriginsBinding } from './ownDeploymentOriginsBinding';
import { buildOwnDeploymentOrigins } from './url';

const ssrfSafeFetch = vi.fn();

vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (...args: unknown[]) => ssrfSafeFetch(...args),
}));

describe('imageUrlToBase64 (server)', () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pathStyleOrigins = buildOwnDeploymentOrigins({
    appUrl: 'https://app.example.com',
    bucket: 'bucket',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
    internalAppUrl: 'http://127.0.0.1:3010',
  });
  const virtualHostOrigins = buildOwnDeploymentOrigins({
    appUrl: 'https://app.example.com',
    bucket: 'mybucket',
    endpoint: 'https://s3.example.net',
    forcePathStyle: false,
    internalAppUrl: 'http://127.0.0.1:3010',
  });

  const publicDomainOrigins = buildOwnDeploymentOrigins({
    appUrl: 'https://chat.jiefakj.com',
    bucket: 'lobe',
    endpoint: 'https://chat.jiefakj.com',
    forcePathStyle: true,
    publicDomain: 'https://chat.jiefakj.com',
  });
  const ownPresignedUrl =
    'https://chat.jiefakj.com/lobe/files/cat.png?X-Amz-Signature=super-secret-signature';

  beforeEach(() => {
    ssrfSafeFetch.mockReset();
    ssrfSafeFetch.mockResolvedValue({
      blob: () => Promise.resolve(new Blob([pngBytes], { type: 'image/png' })),
      ok: true,
      status: 200,
    });
    setOwnDeploymentOriginsBinding(undefined);
  });

  afterEach(() => {
    setOwnDeploymentOriginsBinding(undefined);
    vi.restoreAllMocks();
  });

  it('does not override SSRF_ALLOW_PRIVATE_IP_ADDRESS for default callers', async () => {
    await imageUrlToBase64('https://cdn.example.com/cat.png');

    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://cdn.example.com/cat.png', {}, undefined);
  });

  it('allows private IPs only for allowlisted file origins when ownOriginOnly is set', async () => {
    await imageUrlToBase64('http://localhost:9000/bucket/cat.png', {
      maxBytes: 20 * 1024 * 1024,
      ownOriginOnly: true,
      ownOrigins: pathStyleOrigins,
    });

    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      'http://localhost:9000/bucket/cat.png',
      { redirect: 'manual' },
      expect.objectContaining({
        allowPrivateIPAddress: true,
        maxContentLength: 20 * 1024 * 1024 + 1,
        maxRedirects: 0,
        redactErrors: true,
      }),
    );
  });

  it('does not fetch generic loopback when ownOriginOnly is set', async () => {
    await expect(
      imageUrlToBase64('http://127.0.0.1:3000/internal', {
        ownOriginOnly: true,
        ownOrigins: pathStyleOrigins,
      }),
    ).rejects.toThrow(AttachmentFetchError);
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it('follows a /f/ redirect onto a path-style S3 object URL', async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce({
        headers: {
          get: (name: string) =>
            name === 'location'
              ? 'http://localhost:9000/bucket/cat.png?X-Amz-Signature=secret'
              : null,
        },
        ok: false,
        status: 302,
      })
      .mockResolvedValueOnce({
        blob: () => Promise.resolve(new Blob([pngBytes], { type: 'image/png' })),
        ok: true,
        status: 200,
      });

    await imageUrlToBase64('https://app.example.com/f/abc', {
      ownOriginOnly: true,
      ownOrigins: pathStyleOrigins,
    });

    expect(ssrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(ssrfSafeFetch.mock.calls[0][0]).toBe('http://127.0.0.1:3010/f/abc');
    expect(ssrfSafeFetch.mock.calls[1][0]).toBe(
      'http://localhost:9000/bucket/cat.png?X-Amz-Signature=secret',
    );
  });

  it('follows a /f/ redirect onto a virtual-host S3 object URL', async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce({
        headers: {
          get: (name: string) =>
            name === 'location'
              ? 'https://mybucket.s3.example.net/file.png?X-Amz-Signature=secret'
              : null,
        },
        ok: false,
        status: 302,
      })
      .mockResolvedValueOnce({
        blob: () => Promise.resolve(new Blob([pngBytes], { type: 'image/png' })),
        ok: true,
        status: 200,
      });

    await imageUrlToBase64('https://app.example.com/f/abc', {
      ownOriginOnly: true,
      ownOrigins: virtualHostOrigins,
    });

    expect(ssrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(ssrfSafeFetch.mock.calls[1][0]).toBe(
      'https://mybucket.s3.example.net/file.png?X-Amz-Signature=secret',
    );
  });

  it('rejects a redirect off the allowlist', async () => {
    ssrfSafeFetch.mockResolvedValueOnce({
      headers: {
        get: (name: string) => (name === 'location' ? 'http://127.0.0.1:3000/internal' : null),
      },
      ok: false,
      status: 302,
    });

    await expect(
      imageUrlToBase64('http://localhost:9000/bucket/cat.png', {
        ownOriginOnly: true,
        ownOrigins: pathStyleOrigins,
      }),
    ).rejects.toThrow(AttachmentFetchError);
    expect(ssrfSafeFetch).toHaveBeenCalledTimes(1);
  });

  it('wraps signed-URL fetch failures into a host-only AttachmentFetchError', async () => {
    const signed = 'http://localhost:9000/bucket/cat.png?X-Amz-Signature=super-secret-signature';
    ssrfSafeFetch.mockRejectedValueOnce(
      new Error(`request to ${signed} failed, reason: connect ECONNREFUSED`),
    );

    const error = await imageUrlToBase64(signed, {
      ownOriginOnly: true,
      ownOrigins: pathStyleOrigins,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AttachmentFetchError);
    expect((error as Error).message).toBe('failed to download attachment from localhost:9000');
    expect((error as Error).message).not.toContain('X-Amz-Signature');
    expect((error as Error).message).not.toContain('super-secret-signature');
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      signed,
      { redirect: 'manual' },
      expect.objectContaining({ redactErrors: true }),
    );
  });

  describe('own-deployment origins binding', () => {
    it('fetches an own S3 presigned URL with allowPrivateIPAddress when the binding is set', async () => {
      setOwnDeploymentOriginsBinding({ get: () => publicDomainOrigins });

      await imageUrlToBase64(ownPresignedUrl);

      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        ownPresignedUrl,
        { redirect: 'manual' },
        expect.objectContaining({
          allowPrivateIPAddress: true,
          maxRedirects: 0,
          redactErrors: true,
        }),
      );
    });

    it('does not grant the private-address allowance to app routes when the public domain equals APP_URL', async () => {
      setOwnDeploymentOriginsBinding({ get: () => publicDomainOrigins });

      for (const url of [
        'https://chat.jiefakj.com/api/auth/get-session',
        'https://chat.jiefakj.com/trpc/lambda/admin.stats.totals',
        'https://chat.jiefakj.com/oidc/token',
        'https://chat.jiefakj.com/f/file_1',
      ]) {
        vi.mocked(ssrfSafeFetch).mockClear();
        await imageUrlToBase64(url).catch(() => undefined);
        const call = vi.mocked(ssrfSafeFetch).mock.calls[0];
        expect(call?.[0]).toBe(url);
        expect(call?.[2]?.allowPrivateIPAddress).toBeUndefined();
      }
    });

    it('still allows the bucket path on the shared domain', async () => {
      setOwnDeploymentOriginsBinding({ get: () => publicDomainOrigins });

      await imageUrlToBase64('https://chat.jiefakj.com/lobe/generations/x.png?X-Amz-Signature=s');

      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        'https://chat.jiefakj.com/lobe/generations/x.png?X-Amz-Signature=s',
        { redirect: 'manual' },
        expect.objectContaining({ allowPrivateIPAddress: true }),
      );
    });

    it('allows a dedicated public domain that is not an app origin', async () => {
      const cdnOrigins = buildOwnDeploymentOrigins({
        appUrl: 'https://app.example.com',
        bucket: 'lobe',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        publicDomain: 'https://cdn.example.com',
      });
      setOwnDeploymentOriginsBinding({ get: () => cdnOrigins });

      await imageUrlToBase64('https://cdn.example.com/files/cat.png');

      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        'https://cdn.example.com/files/cat.png',
        { redirect: 'manual' },
        expect.objectContaining({ allowPrivateIPAddress: true }),
      );
    });

    it('does not change fetch options for a foreign URL when the binding is set', async () => {
      setOwnDeploymentOriginsBinding({ get: () => publicDomainOrigins });

      await imageUrlToBase64('https://cdn.example.com/cat.png');

      expect(ssrfSafeFetch).toHaveBeenCalledWith('https://cdn.example.com/cat.png', {}, undefined);
    });

    it('does not change fetch options for an own URL when the binding is missing', async () => {
      await imageUrlToBase64(ownPresignedUrl);

      expect(ssrfSafeFetch).toHaveBeenCalledWith(ownPresignedUrl, {}, undefined);
    });

    it('rejects an own URL that redirects to a foreign host', async () => {
      setOwnDeploymentOriginsBinding({ get: () => publicDomainOrigins });
      ssrfSafeFetch.mockResolvedValueOnce({
        headers: {
          get: (name: string) =>
            name === 'location' ? 'https://evil.example.com/steal?token=1' : null,
        },
        ok: false,
        status: 302,
      });

      await expect(imageUrlToBase64(ownPresignedUrl)).rejects.toThrow(AttachmentFetchError);
      expect(ssrfSafeFetch).toHaveBeenCalledTimes(1);
    });

    it('does not widen allowPrivateIPAddress to an arbitrary private host', async () => {
      setOwnDeploymentOriginsBinding({ get: () => publicDomainOrigins });

      await imageUrlToBase64('http://127.0.0.1:3000/internal');

      expect(ssrfSafeFetch).toHaveBeenCalledWith('http://127.0.0.1:3000/internal', {}, undefined);
    });

    it('uses explicit ownOrigins without reading the binding', async () => {
      const get = vi.fn(() => publicDomainOrigins);
      setOwnDeploymentOriginsBinding({ get });

      await imageUrlToBase64('http://localhost:9000/bucket/cat.png', {
        ownOrigins: pathStyleOrigins,
      });

      expect(get).not.toHaveBeenCalled();
      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        'http://localhost:9000/bucket/cat.png',
        { redirect: 'manual' },
        expect.objectContaining({ allowPrivateIPAddress: true }),
      );
    });
  });
});
