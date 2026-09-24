import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { nanoid } from '@/utils/uuid';

const log = debug('lobe-server:dingtalk-personal');

const MAX_NAME_LENGTH = 120;
const MAX_EXT_LENGTH = 16;

/** Extensions DocumentService can turn into markdown. Contract §4.3 addendum. */
const PARSEABLE_EXTENSIONS = new Set(['csv', 'docx', 'md', 'pdf', 'pptx', 'txt', 'xls', 'xlsx']);

const MIME_BY_EXTENSION: Record<string, string> = {
  bmp: 'image/bmp',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  zip: 'application/zip',
};

const DEFAULT_MIME = 'application/octet-stream';

export const fileExtension = (name: string): string => {
  const base =
    String(name ?? '')
      .split(/[/\\]/)
      .pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
};

export const mimeTypeForFileName = (name: string): string =>
  MIME_BY_EXTENSION[fileExtension(name)] ?? DEFAULT_MIME;

export const isParseableFileName = (name: string): boolean =>
  PARSEABLE_EXTENSIONS.has(fileExtension(name));

/**
 * Basename only: drop path separators and control characters, keep a short
 * extension, and cap the whole name at 120 characters.
 */
export const safeFileName = (input: string): string => {
  const base =
    String(input ?? '')
      .split(/[/\\]/)
      .pop() ?? '';
  // eslint-disable-next-line no-control-regex -- reject control characters in user input
  let name = base.replaceAll(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!name || name === '.' || name === '..') name = 'file';
  if (/^\.[A-Z0-9]+$/i.test(name)) name = `file${name}`;
  if (name.length <= MAX_NAME_LENGTH) return name;

  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const safeExt =
    ext.length > 1 && ext.length <= MAX_EXT_LENGTH && /^\.[A-Z0-9]+$/i.test(ext) ? ext : '';
  if (!safeExt) return name.slice(0, MAX_NAME_LENGTH);
  const stem = name
    .slice(0, name.length - safeExt.length)
    .slice(0, MAX_NAME_LENGTH - safeExt.length);
  return `${stem || 'file'}${safeExt}`;
};

export interface IngestedDingtalkFile {
  fileId: string;
  mimeType: string;
  name: string;
  parseable: boolean;
  parseFailed: boolean;
  sizeBytes: number;
  text?: string;
  url: string;
}

export interface IngestDingtalkFileInput {
  buffer: Buffer;
  db: LobeChatDatabase;
  name: string;
  sizeBytes?: number;
  userId: string;
  workspaceId?: string;
}

/**
 * Persist a downloaded group file and, for text-like extensions, parse it.
 * Parse failures still return the stored file; the caller tells the model.
 */
export const ingestDingtalkPersonalFile = async (
  input: IngestDingtalkFileInput,
): Promise<IngestedDingtalkFile> => {
  const name = safeFileName(input.name);
  const mimeType = mimeTypeForFileName(name);
  const pathname = `files/${input.userId}/${nanoid()}/${name}`;
  const fileService = new FileService(input.db, input.userId, input.workspaceId);
  const uploaded = await fileService.uploadFromBuffer(input.buffer, mimeType, pathname);
  const sizeBytes =
    typeof input.sizeBytes === 'number' && Number.isFinite(input.sizeBytes) && input.sizeBytes >= 0
      ? input.sizeBytes
      : input.buffer.length;
  const stored = {
    fileId: uploaded.fileId,
    mimeType,
    name,
    sizeBytes,
    url: uploaded.url,
  };

  if (!isParseableFileName(name)) {
    return { ...stored, parseFailed: false, parseable: false };
  }

  try {
    const documentService = new DocumentService(input.db, input.userId, input.workspaceId);
    const document = await documentService.parseFile(uploaded.fileId);
    const text = typeof document.content === 'string' ? document.content : undefined;
    return {
      ...stored,
      parseFailed: false,
      parseable: true,
      ...(text !== undefined ? { text } : {}),
    };
  } catch (error) {
    log('parse downloaded file failed %s', error instanceof Error ? error.name : 'UnknownError');
    return { ...stored, parseFailed: true, parseable: true };
  }
};
