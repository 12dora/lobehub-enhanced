import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertClientObjectDirectory,
  assertClientObjectKey,
  getWideClientUploadPrefixes,
} from './objectKeyPolicy';

const fileEnvState = vi.hoisted(() => ({
  NEXT_PUBLIC_S3_FILE_PATH: 'files',
}));

vi.mock('@/envs/file', () => ({
  fileEnv: fileEnvState,
}));

const validKey = 'files/12345/abc-def.png';
const wide = () => ({ prefixes: getWideClientUploadPrefixes() });

describe('assertClientObjectKey', () => {
  afterEach(() => {
    fileEnvState.NEXT_PUBLIC_S3_FILE_PATH = 'files';
  });

  it('accepts a relative key under the default files/ prefix', () => {
    expect(assertClientObjectKey(validKey, wide())).toBe(validKey);
  });

  it('rejects any key containing percent-encoding instead of normalizing it', () => {
    expect(() => assertClientObjectKey('files/hour/hello%20world.txt', wide())).toThrow(TRPCError);
  });

  it('rejects a leading slash', () => {
    expect(() => assertClientObjectKey('/files/12345/abc.png', wide())).toThrow(TRPCError);
    try {
      assertClientObjectKey('/files/12345/abc.png', wide());
    } catch (error) {
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    }
  });

  it('rejects parent-directory segments', () => {
    expect(() => assertClientObjectKey('files/../secrets/key.txt', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour/../../etc/passwd', wide())).toThrow(TRPCError);
  });

  it('rejects percent-encoded parent-directory segments', () => {
    expect(() => assertClientObjectKey('files/%2e%2e/secrets.txt', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/%2E%2E/%2e%2e/etc/passwd', wide())).toThrow(
      TRPCError,
    );
  });

  it('rejects backslashes', () => {
    expect(() => assertClientObjectKey('files\\hour\\abc.png', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour%5cabc.png', wide())).toThrow(TRPCError);
  });

  it('rejects control characters', () => {
    expect(() => assertClientObjectKey('files/hour/abc\u0000.png', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour/abc\n.png', wide())).toThrow(TRPCError);
  });

  it('rejects keys longer than 512 characters', () => {
    const tooLong = `files/${'a'.repeat(510)}`;
    expect(tooLong.length).toBeGreaterThan(512);
    expect(() => assertClientObjectKey(tooLong, wide())).toThrow(TRPCError);
  });

  it('rejects keys outside the client upload prefix', () => {
    expect(() => assertClientObjectKey('user/avatar/user_1/photo.png', wide())).toThrow(TRPCError);
    expect(() =>
      assertClientObjectKey('code-interpreter-exports/2026-09-15/default/x.pptx', wide()),
    ).toThrow(TRPCError);
    expect(() => assertClientObjectKey('generations/images/raw.jpg', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('import_config', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('filesfoo/bar.txt', wide())).toThrow(TRPCError);
  });

  it('accepts the other client-minted prefixes (import, eval, skills) on the wide set', () => {
    expect(assertClientObjectKey('import_config/data.json', wide())).toBe(
      'import_config/data.json',
    );
    expect(assertClientObjectKey('ragEval/1/a.jsonl', wide())).toBe('ragEval/1/a.jsonl');
    expect(assertClientObjectKey('eval-datasets/1/a.csv', wide())).toBe('eval-datasets/1/a.csv');
    expect(assertClientObjectKey('skills/1/a.zip', wide())).toBe('skills/1/a.zip');
  });

  it('accepts files/generations (and other files/ server-minted keys) on the wide set only', () => {
    const generations = 'files/generations/images/raw.jpg';
    const mcp = 'files/mcp/2026/x.bin';
    const userScoped = 'files/user_abc/nanoid/name.png';

    expect(assertClientObjectKey(generations, wide())).toBe(generations);
    expect(assertClientObjectKey(mcp, wide())).toBe(mcp);
    expect(assertClientObjectKey(userScoped, wide())).toBe(userScoped);

    expect(() => assertClientObjectKey(generations, { prefixes: ['import_config'] })).toThrow(
      TRPCError,
    );
    expect(() => assertClientObjectKey(generations, { prefixes: ['ragEval'] })).toThrow(TRPCError);
    expect(() => assertClientObjectKey(generations, { prefixes: ['eval-datasets'] })).toThrow(
      TRPCError,
    );
  });

  it('rejects empty segments and current-directory segments', () => {
    expect(() => assertClientObjectKey('files//abc.png', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/./abc.png', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectKey('files/hour/', wide())).toThrow(TRPCError);
  });

  it('always accepts the default files/ prefix in addition to a configured NEXT_PUBLIC_S3_FILE_PATH', () => {
    fileEnvState.NEXT_PUBLIC_S3_FILE_PATH = 'uploads';
    expect(assertClientObjectKey('uploads/hour/abc.png', wide())).toBe('uploads/hour/abc.png');
    expect(assertClientObjectKey(validKey, wide())).toBe(validKey);
  });
});

describe('assertClientObjectDirectory', () => {
  afterEach(() => {
    fileEnvState.NEXT_PUBLIC_S3_FILE_PATH = 'files';
  });

  it('accepts allowlisted directories and rejects traversal / foreign prefixes', () => {
    expect(assertClientObjectDirectory('files', wide())).toBe('files');
    expect(assertClientObjectDirectory('import_config', wide())).toBe('import_config');
    expect(assertClientObjectDirectory('skills', wide())).toBe('skills');

    expect(() => assertClientObjectDirectory('', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectDirectory('/files', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectDirectory('user/avatar', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectDirectory('..', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectDirectory('files/..', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectDirectory('files/%2e%2e', wide())).toThrow(TRPCError);
    expect(() => assertClientObjectDirectory('files\\hour', wide())).toThrow(TRPCError);
  });
});
