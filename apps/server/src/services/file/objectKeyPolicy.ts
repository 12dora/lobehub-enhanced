import { TRPCError } from '@trpc/server';

import { getFileConfig } from '@/envs/file';

const DEFAULT_CLIENT_UPLOAD_PREFIX = 'files';
/**
 * First path segments the web/CLI clients mint keys under besides the configured
 * file prefix (`src/services/upload.ts` callers). Everything else — sandbox
 * exports, generations, avatars, traces, audit exports — is server-owned.
 */
const EXTRA_CLIENT_UPLOAD_PREFIXES = [
  'import_config',
  'ragEval',
  'eval-datasets',
  'skills',
] as const;
const MAX_CLIENT_OBJECT_KEY_LENGTH = 512;
const MAX_PERCENT_DECODE_ROUNDS = 4;

const hasControlChars = (value: string): boolean => {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const invalidClientObjectKey = (): never => {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Invalid object key',
  });
};

const getClientUploadPrefix = (): string => {
  // Re-read at call time so tests can stub NEXT_PUBLIC_S3_FILE_PATH.
  const configured =
    process.env.NEXT_PUBLIC_S3_FILE_PATH ||
    getFileConfig().NEXT_PUBLIC_S3_FILE_PATH ||
    DEFAULT_CLIENT_UPLOAD_PREFIX;

  return configured.replace(/\/+$/, '') || DEFAULT_CLIENT_UPLOAD_PREFIX;
};

const percentDecode = (value: string): string => {
  let decoded = value;

  for (let round = 0; round < MAX_PERCENT_DECODE_ROUNDS; round += 1) {
    if (!decoded.includes('%')) return decoded;

    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return invalidClientObjectKey();
    }

    if (next === decoded) return decoded;
    decoded = next;
  }

  return decoded;
};

/**
 * Normalize a client-supplied object-storage key and accept only keys that are
 * relative, confined to the client-upload prefixes, and free of traversal.
 */
export const assertClientObjectKey = (pathname: string): string => {
  if (typeof pathname !== 'string' || pathname.length === 0) invalidClientObjectKey();
  if (pathname.length > MAX_CLIENT_OBJECT_KEY_LENGTH) invalidClientObjectKey();
  if (pathname.includes('\\') || hasControlChars(pathname)) invalidClientObjectKey();

  const normalized = percentDecode(pathname);
  if (normalized.length === 0 || normalized.length > MAX_CLIENT_OBJECT_KEY_LENGTH) {
    invalidClientObjectKey();
  }
  if (normalized.includes('\\') || hasControlChars(normalized)) invalidClientObjectKey();
  if (normalized.startsWith('/')) invalidClientObjectKey();

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    invalidClientObjectKey();
  }

  const prefixes = [getClientUploadPrefix(), ...EXTRA_CLIENT_UPLOAD_PREFIXES].map((p) => `${p}/`);
  if (
    !prefixes.some((prefix) => normalized.startsWith(prefix) && normalized.length > prefix.length)
  ) {
    invalidClientObjectKey();
  }

  return normalized;
};

export const isClientObjectKey = (pathname: string): boolean => {
  try {
    assertClientObjectKey(pathname);
    return true;
  } catch {
    return false;
  }
};
