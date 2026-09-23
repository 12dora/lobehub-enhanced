import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  createTarFileExtractStream,
  extractTar,
  extractTarFile,
  packTarFile,
  packTarFiles,
} from './tarArchive';

describe('tarArchive', () => {
  it('round-trips a packed file', () => {
    const tar = packTarFile('hello.txt', 'hello sandbox');
    expect(extractTarFile(tar, 'hello.txt').toString('utf8')).toBe('hello sandbox');
  });

  it('streams a single file out of a tar without buffering the archive', async () => {
    const payload = Buffer.from('streamed-export');
    const tar = packTarFile('out.txt', payload);
    const extract = createTarFileExtractStream({
      basename: 'out.txt',
      expectedSize: payload.length,
    });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      extract.on('data', (chunk: Buffer) => chunks.push(chunk));
      extract.on('end', () => resolve());
      extract.on('error', reject);
      Readable.from(tar).pipe(extract);
    });
    expect(Buffer.concat(chunks).toString('utf8')).toBe('streamed-export');
  });

  it('packs multiple files with parent directory entries', () => {
    const tar = packTarFiles([
      { content: Buffer.from('a'), name: 'uploads/a.txt' },
      { content: Buffer.alloc(0), name: '.lobe-files-initialized' },
    ]);
    const entries = extractTar(tar);
    expect(entries.map((entry) => `${entry.type}:${entry.name}`)).toEqual(
      expect.arrayContaining([
        'directory:uploads',
        'file:uploads/a.txt',
        'file:.lobe-files-initialized',
      ]),
    );
    expect(extractTarFile(tar, 'uploads/a.txt').toString('utf8')).toBe('a');
  });

  it('round-trips a 40-character CJK name via a PAX path header', () => {
    const name = `${'测'.repeat(40)}.txt`;
    expect(Buffer.byteLength(name, 'utf8')).toBeGreaterThan(100);

    const tar = packTarFile(name, 'hello-cjk');
    const files = extractTar(tar).filter((entry) => entry.type === 'file');

    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe(name);
    expect(files[0]?.content.toString('utf8')).toBe('hello-cjk');
    expect(extractTarFile(tar, name).toString('utf8')).toBe('hello-cjk');
  });

  it('streams a file whose real name is only in a PAX path record', async () => {
    const filename = 'AI助手使用培训_员工版.pptx';
    const realPath = `mnt/data/ai_training/${filename}`;
    const payload = Buffer.from('pptx-bytes');
    const tar = buildPaxTar({
      fileName: 'export.pptx',
      path: realPath,
      payload,
    });

    const extract = createTarFileExtractStream({
      basename: filename,
      expectedSize: payload.length,
    });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      extract.on('data', (chunk: Buffer) => chunks.push(chunk));
      extract.on('end', () => resolve());
      extract.on('error', reject);
      Readable.from(tar).pipe(extract);
    });

    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it('keeps a collision-preventing suffix on a CJK upload basename', () => {
    const name = `uploads/${'测'.repeat(40)}-file-1.pdf`;
    const tar = packTarFiles([{ content: Buffer.from('pdf'), name }]);
    const files = extractTar(tar).filter((entry) => entry.type === 'file');

    expect(files.map((entry) => entry.name)).toEqual([name]);
    expect(files[0]?.content.toString('utf8')).toBe('pdf');
  });
});

const BLOCK = 512;

const writeOctal = (header: Buffer, offset: number, length: number, value: number) => {
  const body = value.toString(8).padStart(length - 1, '0');
  header.write(body, offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
};

const paxRecord = (key: string, value: string) => {
  const suffix = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(suffix, 'utf8') + 1;
  let record = `${length}${suffix}`;
  while (Buffer.byteLength(record, 'utf8') !== length) {
    length = Buffer.byteLength(record, 'utf8');
    record = `${length}${suffix}`;
  }
  return Buffer.from(record, 'utf8');
};

const header = (fields: { name: string; size: number; typeflag: string }) => {
  const block = Buffer.alloc(BLOCK);
  block.write(fields.name, 0, 'utf8');
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, fields.size);
  writeOctal(block, 136, 12, 0);
  block.write(fields.typeflag, 156, 1, 'ascii');
  block.write('ustar', 257, 5, 'ascii');
  block.write('00', 263, 2, 'ascii');
  return block;
};

const pad = (size: number) => {
  const rem = size % BLOCK;
  return rem === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - rem);
};

/**
 * ustar archive whose file header name is an ASCII placeholder. The real
 * non-ASCII path lives only in the preceding PAX extended header, which is
 * how Docker writes names that are not plain ustar.
 */
const buildPaxTar = (input: { fileName: string; path: string; payload: Buffer }) => {
  const body = paxRecord('path', input.path);
  return Buffer.concat([
    header({ name: 'PaxHeaders.0/file', size: body.length, typeflag: 'x' }),
    body,
    pad(body.length),
    header({ name: input.fileName, size: input.payload.length, typeflag: '0' }),
    input.payload,
    pad(input.payload.length),
    Buffer.alloc(BLOCK * 2),
  ]);
};
