import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';

import {
  fileExtension,
  ingestDingtalkPersonalFile,
  isParseableFileName,
  mimeTypeForFileName,
  safeFileName,
} from './fileIngest';

const mocks = vi.hoisted(() => ({
  parseFile: vi.fn(),
  uploadFromBuffer: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function FileService(this: unknown) {
    return { uploadFromBuffer: mocks.uploadFromBuffer };
  }),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(function DocumentService(this: unknown) {
    return { parseFile: mocks.parseFile };
  }),
}));

vi.mock('@/utils/uuid', () => ({
  nanoid: () => 'nano123',
}));

const db = { tag: 'db' };

describe('safeFileName', () => {
  it('strips directories and control characters and keeps the extension', () => {
    expect(safeFileName('../../秘密.xlsx')).toBe('秘密.xlsx');
    expect(safeFileName('C:\\temp\\库存.xlsx')).toBe('库存.xlsx');
    expect(safeFileName('报\u0000表.xlsx')).toBe('报表.xlsx');
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName('.xlsx')).toBe('file.xlsx');
  });

  it('caps the name at 120 characters without dropping the extension', () => {
    const name = safeFileName(`${'测'.repeat(200)}.xlsx`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.xlsx')).toBe(true);
    expect(fileExtension(name)).toBe('xlsx');
  });
});

describe('mimeTypeForFileName', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeTypeForFileName('库存.XLSX')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(mimeTypeForFileName('a.csv')).toBe('text/csv');
    expect(mimeTypeForFileName('a.pdf')).toBe('application/pdf');
    expect(mimeTypeForFileName('a.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(mimeTypeForFileName('a.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(mimeTypeForFileName('a.txt')).toBe('text/plain');
    expect(mimeTypeForFileName('a.md')).toBe('text/markdown');
    expect(mimeTypeForFileName('a.png')).toBe('image/png');
    expect(mimeTypeForFileName('a.jpg')).toBe('image/jpeg');
    expect(mimeTypeForFileName('a.jpeg')).toBe('image/jpeg');
    expect(mimeTypeForFileName('a.xls')).toBe('application/vnd.ms-excel');
    expect(mimeTypeForFileName('a.bin')).toBe('application/octet-stream');
    expect(mimeTypeForFileName('noext')).toBe('application/octet-stream');
  });

  it('parses only the contract text extensions', () => {
    for (const ext of ['xlsx', 'xls', 'csv', 'pdf', 'docx', 'pptx', 'txt', 'md']) {
      expect(isParseableFileName(`note.${ext}`)).toBe(true);
    }
    expect(isParseableFileName('pic.PNG')).toBe(false);
    expect(isParseableFileName('pack.zip')).toBe(false);
  });
});

describe('ingestDingtalkPersonalFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadFromBuffer.mockResolvedValue({
      fileId: 'file-1',
      key: 'files/user-1/nano123/库存.xlsx',
      url: 'https://files.example/file-1',
    });
    mocks.parseFile.mockResolvedValue({ content: '| 物料 | 数量 |\n| --- | --- |' });
  });

  it('uploads an xlsx and parses it', async () => {
    const result = await ingestDingtalkPersonalFile({
      buffer: Buffer.from('xlsx-bytes'),
      db: db as never,
      name: 'dir/2026年9月库存日报表.xlsx',
      sizeBytes: 91371,
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(FileService).toHaveBeenCalledWith(db, 'user-1', 'ws-1');
    expect(mocks.uploadFromBuffer).toHaveBeenCalledWith(
      Buffer.from('xlsx-bytes'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'files/user-1/nano123/2026年9月库存日报表.xlsx',
    );
    expect(DocumentService).toHaveBeenCalledWith(db, 'user-1', 'ws-1');
    expect(mocks.parseFile).toHaveBeenCalledWith('file-1');
    expect(result).toMatchObject({
      fileId: 'file-1',
      name: '2026年9月库存日报表.xlsx',
      parseFailed: false,
      parseable: true,
      sizeBytes: 91371,
      text: '| 物料 | 数量 |\n| --- | --- |',
      url: 'https://files.example/file-1',
    });
  });

  it('stores an image without parsing', async () => {
    const result = await ingestDingtalkPersonalFile({
      buffer: Buffer.from('png'),
      db: db as never,
      name: '现场.jpg',
      sizeBytes: 12,
      userId: 'user-1',
    });
    expect(mocks.parseFile).not.toHaveBeenCalled();
    expect(DocumentService).not.toHaveBeenCalled();
    expect(mocks.uploadFromBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/jpeg',
      'files/user-1/nano123/现场.jpg',
    );
    expect(result.parseable).toBe(false);
    expect(result.text).toBeUndefined();
  });

  it('keeps the stored file when parsing throws', async () => {
    mocks.parseFile.mockRejectedValueOnce(new Error('loader exploded'));
    const result = await ingestDingtalkPersonalFile({
      buffer: Buffer.from('pdf'),
      db: db as never,
      name: '说明.pdf',
      userId: 'user-1',
    });
    expect(result).toMatchObject({
      fileId: 'file-1',
      parseFailed: true,
      parseable: true,
      url: 'https://files.example/file-1',
    });
    expect(result.text).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('loader exploded');
  });
});
