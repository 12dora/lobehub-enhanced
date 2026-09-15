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

type FileUploadServiceWithMetadata = FileUploadService & {
  generateFileMetadata: (file: { name: string }, directory?: string) => FileMetadata;
};

describe('FileUploadService.generateFileMetadata directory policy', () => {
  const file = { name: 'photo.png' };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const createService = () =>
    new FileUploadService({} as LobeChatDatabase, 'user-1') as FileUploadServiceWithMetadata;

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
