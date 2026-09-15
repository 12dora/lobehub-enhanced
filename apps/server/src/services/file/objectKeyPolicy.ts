import { TRPCError } from '@trpc/server';

import { fileEnv } from '@/envs/file';

export const DEFAULT_CLIENT_UPLOAD_PREFIX = 'files';

/**
 * First path segments the web/CLI clients mint keys under besides the configured
 * file prefix (`src/services/upload.ts` callers). Everything else — sandbox
 * exports, generations, avatars, traces, audit exports — is server-owned.
 */
export const EXTRA_CLIENT_UPLOAD_PREFIXES = [
  'import_config',
  'ragEval',
  'eval-datasets',
  'skills',
] as const;

const MAX_CLIENT_OBJECT_KEY_LENGTH = 512;

export interface AssertClientObjectKeyOptions {
  prefixes: readonly string[];
}

const hasControlChars = (value: string): boolean => {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

function invalidClientObjectKey(): never {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Invalid object key',
  });
}

const stripTrailingSlashes = (prefix: string): string =>
  prefix.replace(/\/+$/, '') || DEFAULT_CLIENT_UPLOAD_PREFIX;

/**
 * Prefixes accepted by `upload.createS3PreSignedUrl` and the OpenAPI upload
 * directory allowlist. Always includes the default `files/` prefix (CLI and
 * heterogeneous-agents hardcode it; SPA may have inlined a different value at
 * build time) plus the configured `NEXT_PUBLIC_S3_FILE_PATH` and the extra
 * client-minted directories.
 */
export const getWideClientUploadPrefixes = (): string[] => {
  const configured = stripTrailingSlashes(
    fileEnv.NEXT_PUBLIC_S3_FILE_PATH || DEFAULT_CLIENT_UPLOAD_PREFIX,
  );

  return [...new Set([DEFAULT_CLIENT_UPLOAD_PREFIX, configured, ...EXTRA_CLIENT_UPLOAD_PREFIXES])];
};

/**
 * Accept only keys that are relative, confined to `options.prefixes`, and free
 * of traversal / encoding. Returns the original pathname (no normalization).
 */
export const assertClientObjectKey = (
  pathname: string,
  options: AssertClientObjectKeyOptions,
): string => {
  if (pathname.length === 0) invalidClientObjectKey();
  if (pathname.length > MAX_CLIENT_OBJECT_KEY_LENGTH) invalidClientObjectKey();
  // Clients never percent-encode keys; a literal `%` is either a malformed
  // filename or an encoding probe. Reject instead of decoding so the stored
  // key matches what the client recorded.
  if (pathname.includes('%') || pathname.includes('\\') || hasControlChars(pathname)) {
    invalidClientObjectKey();
  }
  if (pathname.startsWith('/')) invalidClientObjectKey();

  const segments = pathname.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    invalidClientObjectKey();
  }

  const prefixes = options.prefixes.map((prefix) => `${stripTrailingSlashes(prefix)}/`);
  if (!prefixes.some((prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length)) {
    invalidClientObjectKey();
  }

  return pathname;
};

/**
 * Validate a caller-supplied upload directory. It must be a relative prefix
 * that would produce keys under `options.prefixes`.
 */
export const assertClientObjectDirectory = (
  directory: string,
  options: AssertClientObjectKeyOptions,
): string => {
  if (directory.length === 0) invalidClientObjectKey();
  assertClientObjectKey(`${directory}/x`, options);
  return directory;
};
