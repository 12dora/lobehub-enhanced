// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { FileModel } from '@/database/models/file';
import type { FileItem } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { FileService } from '@/server/services/file';

import { GET } from './route';

const fileServiceMocks = vi.hoisted(() => {
  const instance = {
    createCachedPreSignedUrlForPreview: vi.fn(),
    getFullFileUrl: vi.fn(),
  };

  return {
    FileService: vi.fn(() => instance),
    instance,
  };
});

const platformStorageMocks = vi.hoisted(() => ({
  createCachedPreSignedUrlForPreview: vi.fn(),
}));

const fileAccessMocks = vi.hoisted(() => ({
  recordAuditorFileOpen: vi.fn(),
  resolveFileAccess: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/libs/oidc-provider/userActiveCache', () => ({
  assertUserActiveCached: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: {
    getFileById: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: fileServiceMocks.FileService,
}));

vi.mock('@/server/services/file/fileAccess', () => ({
  recordAuditorFileOpen: fileAccessMocks.recordAuditorFileOpen,
  resolveFileAccess: fileAccessMocks.resolveFileAccess,
}));

vi.mock('@/server/services/file/impls', () => ({
  createFileServiceModule: vi.fn(() => platformStorageMocks),
}));

const sessionOf = (userId: string) => ({
  session: { createdAt: new Date('2024-01-01T00:00:00.000Z'), id: 'sess-1' },
  user: { id: userId },
});

describe('file proxy route', () => {
  const platformAssetRows: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => platformAssetRows) })),
      })),
    })),
  } as unknown as LobeChatDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    platformAssetRows.length = 0;

    vi.mocked(getServerDB).mockResolvedValue(db);
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionOf('owner-user-id') as never);
    vi.mocked(FileModel.getFileById).mockResolvedValue({
      fileType: 'image/png',
      id: 'file-id',
      url: 'files/user-id/image.png',
      userId: 'owner-user-id',
      visibility: 'public',
      workspaceId: null,
    } as FileItem);
    fileAccessMocks.resolveFileAccess.mockResolvedValue({ allowed: true, reason: 'owner' });
    fileAccessMocks.recordAuditorFileOpen.mockResolvedValue(undefined);
    fileServiceMocks.instance.createCachedPreSignedUrlForPreview.mockResolvedValue(
      'https://s3.example.com/presigned-preview-url',
    );
    platformStorageMocks.createCachedPreSignedUrlForPreview.mockResolvedValue(
      'https://s3.example.com/platform-branding-object',
    );
  });

  it('returns 401 for an anonymous request', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
    expect(FileModel.getFileById).not.toHaveBeenCalled();
    expect(fileAccessMocks.resolveFileAccess).not.toHaveBeenCalled();
  });

  it('redirects the owner to a cached presigned URL with private/no-store headers', async () => {
    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://s3.example.com/presigned-preview-url');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(FileModel.getFileById).toHaveBeenCalledWith(db, 'file-id');
    expect(fileAccessMocks.resolveFileAccess).toHaveBeenCalledWith({
      db,
      file: {
        id: 'file-id',
        userId: 'owner-user-id',
        visibility: 'public',
        workspaceId: null,
      },
      viewerUserId: 'owner-user-id',
    });
    expect(FileService).toHaveBeenCalledWith(db, 'owner-user-id');
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).toHaveBeenCalledWith(
      'files/user-id/image.png',
    );
    expect(fileServiceMocks.instance.getFullFileUrl).not.toHaveBeenCalled();
    expect(fileAccessMocks.recordAuditorFileOpen).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated foreign user', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionOf('stranger') as never);
    fileAccessMocks.resolveFileAccess.mockResolvedValue({ allowed: false });

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
    expect(fileAccessMocks.recordAuditorFileOpen).not.toHaveBeenCalled();
  });

  it('redirects an auditor with content_allowed and writes the access log before redirect', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionOf('auditor-id') as never);
    fileAccessMocks.resolveFileAccess.mockResolvedValue({ allowed: true, reason: 'auditor' });

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(fileAccessMocks.recordAuditorFileOpen).toHaveBeenCalledWith(db, {
      actorUserId: 'auditor-id',
      fileId: 'file-id',
    });
    expect(fileAccessMocks.recordAuditorFileOpen.mock.invocationCallOrder[0]).toBeLessThan(
      fileServiceMocks.instance.createCachedPreSignedUrlForPreview.mock.invocationCallOrder[0],
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://s3.example.com/presigned-preview-url');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('returns 403 for an auditor with metadata_only (no body access)', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionOf('auditor-id') as never);
    fileAccessMocks.resolveFileAccess.mockResolvedValue({ allowed: false });

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(403);
    expect(fileAccessMocks.recordAuditorFileOpen).not.toHaveBeenCalled();
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing file', async () => {
    vi.mocked(FileModel.getFileById).mockResolvedValue(undefined);

    const response = await GET(new Request('https://lobehub.com/f/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('File not found');
    expect(fileAccessMocks.resolveFileAccess).not.toHaveBeenCalled();
  });

  it('returns 500 when the auditor access log write fails (fail closed)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionOf('auditor-id') as never);
    fileAccessMocks.resolveFileAccess.mockResolvedValue({ allowed: true, reason: 'auditor' });
    fileAccessMocks.recordAuditorFileOpen.mockRejectedValue(new Error('log write failed'));

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal server error');
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
  });

  it('resolves an opaque ready platform Branding asset without a user-owned file row or session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    platformAssetRows.push({ mimeType: 'image/png', objectKey: 'branding/logo/object.png' });
    const response = await GET(
      new Request('https://lobehub.com/f/pba_11111111-1111-4111-8111-111111111111'),
      {
        params: Promise.resolve({ id: 'pba_11111111-1111-4111-8111-111111111111' }),
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://s3.example.com/platform-branding-object',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(FileModel.getFileById).not.toHaveBeenCalled();
  });

  it('does not fall back to user files for a missing platform asset-shaped ID', async () => {
    const response = await GET(
      new Request('https://lobehub.com/f/pba_22222222-2222-4222-8222-222222222222'),
      {
        params: Promise.resolve({ id: 'pba_22222222-2222-4222-8222-222222222222' }),
      },
    );

    expect(response.status).toBe(404);
    expect(FileModel.getFileById).not.toHaveBeenCalled();
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it('fails closed for malformed or non-canonical IDs in the platform namespace', async () => {
    const response = await GET(
      new Request('https://lobehub.com/f/pba_11111111-1111-4111-8111-11111111111A'),
      {
        params: Promise.resolve({ id: 'pba_11111111-1111-4111-8111-11111111111A' }),
      },
    );

    expect(response.status).toBe(404);
    expect(FileModel.getFileById).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });
});
