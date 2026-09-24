// @vitest-environment node
import type { FileMetadata } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { FileUploadService } from './file.service';

vi.mock('@/const/rbac', () => ({
  ALL_SCOPE: 'all',
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {},
}));

vi.mock('@/database/models/file', () => ({
  FileModel: class {},
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: class {},
}));

vi.mock('@/database/models/chunk', () => ({
  ChunkModel: class {},
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: class {},
}));

vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: class {},
}));

vi.mock('@/database/schemas', () => ({
  agentsToSessions: {},
  files: {},
  filesToSessions: {},
  knowledgeBaseFiles: {},
  knowledgeBases: {},
  users: {},
}));

vi.mock('@/server/modules/S3', () => ({
  FileS3: class {},
  S3: class {},
}));

vi.mock('@/server/services/file', () => ({
  FileService: class {},
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {},
}));

vi.mock('@/utils/rbac', () => ({
  getScopePermissions: vi.fn(() => []),
}));

vi.mock('@/utils/isChunkingUnsupported', () => ({
  isChunkingUnsupported: vi.fn(() => false),
}));

// `generateFileMetadata` is private; reach it through a structural type instead of the class.
type FileUploadServiceWithMetadata = {
  generateFileMetadata: (file: { name: string }, directory?: string) => FileMetadata;
};

describe('FileUploadService.generateFileMetadata directory policy', () => {
  const file = { name: 'photo.png' };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const createService = () =>
    new FileUploadService(
      {} as LobeChatDatabase,
      'user-1',
    ) as unknown as FileUploadServiceWithMetadata;

  it('defaults to files/ and accepts allowlisted directories', () => {
    const service = createService();

    const defaultMeta = service.generateFileMetadata(file);
    expect(defaultMeta.dirname).toBe('files');
    expect(defaultMeta.path).toMatch(/^files\/\d{4}-\d{2}-\d{2}\/.+_photo\.png$/);

    const skillsMeta = service.generateFileMetadata(file, 'skills');
    expect(skillsMeta.dirname).toBe('skills');
    expect(skillsMeta.path).toMatch(/^skills\/\d{4}-\d{2}-\d{2}\/.+_photo\.png$/);
  });

  it('rejects directories outside the client upload allowlist', () => {
    const service = createService();

    const rejected = [
      'user/avatar',
      '../secrets',
      '/files',
      'files/..',
      'files/%2e%2e',
      'uploads',
      '',
    ];

    for (const directory of rejected) {
      try {
        service.generateFileMetadata(file, directory);
        expect.unreachable(`expected ${directory} to be rejected`);
      } catch (error) {
        expect(error).toMatchObject({
          message: 'Invalid upload directory',
          name: 'ValidationError',
        });
      }
    }
  });
});

describe('FileUploadService.deleteFile', () => {
  const createService = () => {
    const service = new FileUploadService({} as LobeChatDatabase, 'user-1');
    const fileModel = { delete: vi.fn() };
    const coreFileService = { deleteFile: vi.fn() };
    const target = service as unknown as {
      coreFileService: typeof coreFileService;
      fileModel: typeof fileModel;
      findFileByIdWithPermission: (fileId: string) => Promise<{ id: string; url: string }>;
      resolveOperationPermission: () => Promise<{ isPermitted: boolean }>;
    };
    target.fileModel = fileModel;
    target.coreFileService = coreFileService;
    target.resolveOperationPermission = vi.fn(async () => ({ isPermitted: true }));
    target.findFileByIdWithPermission = vi.fn(async () => ({
      id: 'file-1',
      url: 'files/shared.txt',
    }));
    return { coreFileService, fileModel, service };
  };

  it('deletes the object only after the global file row is removed', async () => {
    const { coreFileService, fileModel, service } = createService();
    fileModel.delete.mockResolvedValue({ url: 'files/shared.txt' });

    await service.deleteFile('file-1');

    expect(fileModel.delete).toHaveBeenCalledWith('file-1');
    expect(coreFileService.deleteFile).toHaveBeenCalledWith('files/shared.txt');
    expect(fileModel.delete.mock.invocationCallOrder[0]).toBeLessThan(
      coreFileService.deleteFile.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the object when the blob is still referenced', async () => {
    const { coreFileService, fileModel, service } = createService();
    fileModel.delete.mockResolvedValue(undefined);

    await service.deleteFile('file-1');

    expect(fileModel.delete).toHaveBeenCalledWith('file-1');
    expect(coreFileService.deleteFile).not.toHaveBeenCalled();
  });
});

describe('FileUploadService.uploadFile dedupe', () => {
  const createService = () => {
    const execute = vi.fn(async () => undefined);
    const trx = { execute };
    const db = {
      transaction: vi.fn(async (callback: (client: typeof trx) => Promise<unknown>) =>
        callback(trx),
      ),
    };
    const service = new FileUploadService(db as unknown as LobeChatDatabase, 'user-1');
    const touch = vi.fn(async () => true);
    const create = vi.fn(async () => ({ id: 'file-1' }));
    const target = service as unknown as {
      fileModel: {
        checkHash: (hash: string) => Promise<{ isExist: boolean; metadata: object; url: string }>;
        create: typeof create;
        touchGlobalFileAccessedAt: typeof touch;
      };
      findExistingUserFile: (hash: string) => Promise<null>;
      getFileDetail: (id: string) => Promise<{ id: string }>;
      resolveOperationPermission: () => Promise<{ isPermitted: boolean }>;
    };
    target.fileModel = {
      checkHash: vi.fn(async () => ({
        isExist: true,
        metadata: { path: 'files/a.txt' },
        url: 'files/a.txt',
      })),
      create,
      touchGlobalFileAccessedAt: touch,
    };
    target.resolveOperationPermission = vi.fn(async () => ({ isPermitted: true }));
    target.findExistingUserFile = vi.fn(async () => null);
    target.getFileDetail = vi.fn(async (id: string) => ({ id }));
    return { create, execute, service, touch, trx };
  };

  const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });

  it('bumps accessed_at under the hash lock when the global row is still there', async () => {
    const { create, execute, service, touch, trx } = createService();

    await service.uploadFile(file, { skipCheckFileType: true });

    expect(execute).toHaveBeenCalled();
    expect(touch).toHaveBeenCalledWith(expect.any(String), trx);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'files/a.txt' }),
      false,
      trx,
    );
  });

  it('reinserts the global file when the bump matches no row', async () => {
    const { create, execute, service, touch, trx } = createService();
    touch.mockResolvedValue(false);

    await service.uploadFile(file, { skipCheckFileType: true });

    expect(execute).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: 'files/a.txt' }), true, trx);
    expect(touch.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
  });
});
