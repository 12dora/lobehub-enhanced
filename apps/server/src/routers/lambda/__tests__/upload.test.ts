import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRouter } from '../upload';

const mocks = vi.hoisted(() => ({
  createFileS3: vi.fn(),
}));

vi.mock('@/server/modules/S3', () => ({
  createFileS3: (...args: unknown[]) => mocks.createFileS3(...args),
}));

const notFoundError = (name: 'NotFound' | 'NoSuchKey' = 'NotFound') =>
  Object.assign(new Error(name), {
    $metadata: { httpStatusCode: 404 },
    name,
  });

describe('uploadRouter.createS3PreSignedUrl', () => {
  const createPreSignedUrl = vi.fn();
  const getFileMetadata = vi.fn();
  const caller = uploadRouter.createCaller({ userId: 'user-1' } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    createPreSignedUrl.mockResolvedValue('https://s3.example/presigned');
    getFileMetadata.mockRejectedValue(notFoundError());
    mocks.createFileS3.mockResolvedValue({
      createPreSignedUrl,
      getFileMetadata,
    });
  });

  it('presigns a missing object under the client upload prefix', async () => {
    await expect(caller.createS3PreSignedUrl({ pathname: 'files/12345/abc.png' })).resolves.toBe(
      'https://s3.example/presigned',
    );

    expect(getFileMetadata).toHaveBeenCalledWith('files/12345/abc.png');
    expect(createPreSignedUrl).toHaveBeenCalledWith('files/12345/abc.png');
  });

  it('presigns when HeadObject reports a genuine 404 / NotFound', async () => {
    getFileMetadata.mockRejectedValue(notFoundError('NoSuchKey'));

    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/generations/images/raw.jpg' }),
    ).resolves.toBe('https://s3.example/presigned');

    expect(createPreSignedUrl).toHaveBeenCalledWith('files/generations/images/raw.jpg');
  });

  it('refuses to presign a key that already exists', async () => {
    getFileMetadata.mockResolvedValue({ contentLength: 12, contentType: 'image/png' });

    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/12345/abc.png' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(createPreSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when HeadObject returns 403', async () => {
    getFileMetadata.mockRejectedValue(
      Object.assign(new Error('AccessDenied'), {
        $metadata: { httpStatusCode: 403 },
        name: 'AccessDenied',
      }),
    );

    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/12345/abc.png' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(createPreSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when HeadObject times out', async () => {
    getFileMetadata.mockRejectedValue(
      Object.assign(new Error('Timeout'), { name: 'TimeoutError' }),
    );

    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/12345/abc.png' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(createPreSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects pathnames outside the client upload prefix', async () => {
    await expect(
      caller.createS3PreSignedUrl({ pathname: 'user/avatar/user_1/photo.png' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mocks.createFileS3).not.toHaveBeenCalled();
  });

  it('rejects parent-directory segments before talking to object storage', async () => {
    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/../secrets/key.txt' }),
    ).rejects.toBeInstanceOf(TRPCError);

    expect(mocks.createFileS3).not.toHaveBeenCalled();
  });
});
