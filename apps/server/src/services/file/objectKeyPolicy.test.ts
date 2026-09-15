import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it } from 'vitest';

import { assertClientObjectKey, isClientObjectKey } from './objectKeyPolicy';

const validKey = 'files/12345/abc-def.png';

describe('assertClientObjectKey', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_S3_FILE_PATH;
  });

  it('accepts a relative key under the default files/ prefix', () => {
    expect(assertClientObjectKey(validKey)).toBe(validKey);
  });

  it('returns the percent-decoded key when encoding is benign', () => {
    expect(assertClientObjectKey('files/hour/hello%20world.txt')).toBe(
      'files/hour/hello world.txt',
    );
  });

  it('rejects a leading slash', () => {
    expect(() => assertClientObjectKey('/files/12345/abc.png')).toThrow(TRPCError);
    try {
      assertClientObjectKey('/files/12345/abc.png');
    } catch (error) {
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    }
  });

  it('rejects parent-directory segments', () => {
    expect(() => assertClientObjectKey('files/../secrets/key.txt')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour/../../etc/passwd')).toThrow(TRPCError);
  });

  it('rejects percent-encoded parent-directory segments', () => {
    expect(() => assertClientObjectKey('files/%2e%2e/secrets.txt')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/%2E%2E/%2e%2e/etc/passwd')).toThrow(TRPCError);
  });

  it('rejects backslashes', () => {
    expect(() => assertClientObjectKey('files\\hour\\abc.png')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour%5cabc.png')).toThrow(TRPCError);
  });

  it('rejects control characters', () => {
    expect(() => assertClientObjectKey('files/hour/abc\u0000.png')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour/abc\n.png')).toThrow(TRPCError);
  });

  it('rejects keys longer than 512 characters', () => {
    const tooLong = `files/${'a'.repeat(510)}`;
    expect(tooLong.length).toBeGreaterThan(512);
    expect(() => assertClientObjectKey(tooLong)).toThrow(TRPCError);
  });

  it('rejects keys outside the client upload prefix', () => {
    expect(() => assertClientObjectKey('user/avatar/user_1/photo.png')).toThrow(TRPCError);
    expect(() =>
      assertClientObjectKey('code-interpreter-exports/2026-09-15/default/x.pptx'),
    ).toThrow(TRPCError);
    expect(() => assertClientObjectKey('generations/images/raw.jpg')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('import_config')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('filesfoo/bar.txt')).toThrow(TRPCError);
  });

  it('accepts the other client-minted prefixes (import, eval, skills)', () => {
    expect(assertClientObjectKey('import_config/data.json')).toBe('import_config/data.json');
    expect(assertClientObjectKey('ragEval/1/a.jsonl')).toBe('ragEval/1/a.jsonl');
    expect(assertClientObjectKey('eval-datasets/1/a.csv')).toBe('eval-datasets/1/a.csv');
    expect(assertClientObjectKey('skills/1/a.zip')).toBe('skills/1/a.zip');
  });

  it('rejects empty segments and current-directory segments', () => {
    expect(() => assertClientObjectKey('files//abc.png')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/./abc.png')).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour/')).toThrow(TRPCError);
  });

  it('reads NEXT_PUBLIC_S3_FILE_PATH at call time so tests can override it', () => {
    process.env.NEXT_PUBLIC_S3_FILE_PATH = 'uploads';
    expect(assertClientObjectKey('uploads/hour/abc.png')).toBe('uploads/hour/abc.png');
    expect(() => assertClientObjectKey(validKey)).toThrow(TRPCError);
  });
});

describe('isClientObjectKey', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_S3_FILE_PATH;
  });

  it('returns true for an accepted key and false otherwise', () => {
    expect(isClientObjectKey(validKey)).toBe(true);
    expect(isClientObjectKey('../files/abc.png')).toBe(false);
    expect(isClientObjectKey('/files/abc.png')).toBe(false);
    expect(isClientObjectKey('')).toBe(false);
  });
});
