import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadLocalFile } from './uploadLocalFile';

const createClient = () => ({
  file: {
    checkFileHash: { mutate: vi.fn() },
    createFile: { mutate: vi.fn().mockResolvedValue({ id: 'f1', url: '/f/f1' }) },
  },
  upload: {
    createS3PreSignedUrl: { mutate: vi.fn().mockResolvedValue('https://s3/presigned') },
  },
});

const writeTempFile = (contents: string, fileName: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-upload-local-'));
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, contents);
  return { dir, filePath };
};

describe('uploadLocalFile', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const cleanup: string[] = [];

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    for (const dir of cleanup.splice(0)) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it('skips the S3 PUT and omits url when the hash exists', async () => {
    const { dir, filePath } = writeTempFile('dedup me', 'notes.txt');
    cleanup.push(dir);
    const client = createClient();
    client.file.checkFileHash.mutate.mockResolvedValue({ isExist: true });

    await uploadLocalFile(client as any, filePath);

    expect(client.upload.createS3PreSignedUrl.mutate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.file.createFile.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: crypto.createHash('sha256').update('dedup me').digest('hex'),
        metadata: {},
        name: 'notes.txt',
      }),
    );
    expect(client.file.createFile.mutate.mock.calls[0][0]).not.toHaveProperty('url');
  });

  it('mints a unique files/<date>/<hash>-<nanoid>.<ext> key per attempt', async () => {
    const { dir, filePath } = writeTempFile('hello world', 'hello.txt');
    cleanup.push(dir);
    const client = createClient();
    client.file.checkFileHash.mutate.mockResolvedValue({ isExist: false });

    await uploadLocalFile(client as any, filePath);
    await uploadLocalFile(client as any, filePath);

    const first = client.upload.createS3PreSignedUrl.mutate.mock.calls[0][0].pathname as string;
    const second = client.upload.createS3PreSignedUrl.mutate.mock.calls[1][0].pathname as string;
    const hash = crypto.createHash('sha256').update('hello world').digest('hex');
    const key = new RegExp(`^files/\\d{4}-\\d{2}-\\d{2}/${hash}-[\\w-]{8}\\.txt$`);

    expect(first).toMatch(key);
    expect(second).toMatch(key);
    expect(first).not.toBe(second);
    expect(client.file.createFile.mutate.mock.calls[0][0].url).toBe(first);
    expect(client.file.createFile.mutate.mock.calls[1][0].url).toBe(second);
  });

  it('sanitizes the extension so raw names, % and separators never enter the key', async () => {
    const { dir, filePath } = writeTempFile('bytes', 'invoice.Q1 report (50%)');
    cleanup.push(dir);
    const client = createClient();
    client.file.checkFileHash.mutate.mockResolvedValue({ isExist: false });

    await uploadLocalFile(client as any, filePath);

    const pathname = client.upload.createS3PreSignedUrl.mutate.mock.calls[0][0].pathname as string;
    expect(pathname).not.toContain('%');
    expect(pathname).not.toContain(' ');
    expect(pathname).not.toContain('(');
    expect(pathname).not.toMatch(/Q1 report/);
    expect(pathname).toMatch(/\.Q1report50$/);
  });
});
