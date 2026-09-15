import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileService } from './index';

const { mockGetDocumentById, mockGetFileItemById, mockCheckFileHash, mockCreateFile } = vi.hoisted(
  () => ({
    mockCheckFileHash: vi.fn(),
    mockCreateFile: vi.fn(),
    mockGetDocumentById: vi.fn(),
    mockGetFileItemById: vi.fn(),
  }),
);

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    document: {
      getDocumentById: { query: mockGetDocumentById },
    },
    file: {
      checkFileHash: { mutate: mockCheckFileHash },
      createFile: { mutate: mockCreateFile },
      getFileItemById: { query: mockGetFileItemById },
    },
  },
}));

describe('FileService.getKnowledgeItem', () => {
  const service = new FileService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the backing file metadata when resolving a file-backed PDF document', async () => {
    mockGetDocumentById.mockResolvedValue({
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      fileId: 'file_pdf',
      fileType: 'custom/document',
      filename: 'PDF title without extension',
      id: 'docs_pdf',
      source: 'https://app.lobehub.com/f/file_pdf',
      sourceType: 'file',
      title: 'PDF title without extension',
      totalCharCount: 12_345,
      updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    });
    mockGetFileItemById.mockResolvedValue({
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      fileType: 'application/pdf',
      id: 'file_pdf',
      name: 'original.pdf',
      size: 98_765,
      sourceType: 'file',
      updatedAt: new Date('2026-07-22T00:00:00.000Z'),
      url: 'https://app.lobehub.com/f/file_pdf',
    });

    const result = await service.getKnowledgeItem('docs_pdf');

    expect(result).toMatchObject({
      fileId: 'file_pdf',
      fileType: 'application/pdf',
      id: 'docs_pdf',
      name: 'original.pdf',
      size: 98_765,
      sourceType: 'document',
      url: 'https://app.lobehub.com/f/file_pdf',
    });
  });

  it('keeps native documents as pages without requesting backing file metadata', async () => {
    mockGetDocumentById.mockResolvedValue({
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      fileId: null,
      fileType: 'custom/document',
      filename: 'Native page',
      id: 'docs_page',
      source: 'page',
      sourceType: 'api',
      title: 'Native page',
      totalCharCount: 100,
      updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    });

    const result = await service.getKnowledgeItem('docs_page');

    expect(mockGetFileItemById).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      fileId: null,
      fileType: 'custom/document',
      id: 'docs_page',
      name: 'Native page',
      sourceType: 'document',
    });
  });
});

describe('FileService.checkFileHash / createFile', () => {
  const service = new FileService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes checkFileHash through and returns the hash-existence result', async () => {
    mockCheckFileHash.mockResolvedValue({ fileType: 'image/png', isExist: true, size: 12 });

    await expect(service.checkFileHash('abc')).resolves.toEqual({
      fileType: 'image/png',
      isExist: true,
      size: 12,
    });
    expect(mockCheckFileHash).toHaveBeenCalledWith({ hash: 'abc' });
  });

  it('forwards createFile without a url when the caller omits it', async () => {
    mockCreateFile.mockResolvedValue({ id: 'file_1', url: '/f/file_1' });

    await expect(
      service.createFile({
        fileType: 'image/png',
        hash: 'abc',
        metadata: {},
        name: 'generated.png',
        size: 12,
      }),
    ).resolves.toEqual({ id: 'file_1', url: '/f/file_1' });

    expect(mockCreateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileType: 'image/png',
        hash: 'abc',
        name: 'generated.png',
        size: 12,
      }),
    );
    expect(mockCreateFile.mock.calls[0][0]).not.toHaveProperty('url');
  });
});
