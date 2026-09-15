import type { OpenAIChatMessage, UserMessageContentPart } from '@lobechat/model-runtime';
import { isFileUrlPart } from '@lobechat/model-runtime';
import type { OwnDeploymentOrigins } from '@lobechat/utils';
import { isOwnDeploymentFileUrl, sanitizedUrlHost } from '@lobechat/utils';
import { DEFAULT_IMAGE_INLINE_MAX_BYTES } from '@lobechat/utils/imageToBase64';
import debug from 'debug';

import type {
  OwnOriginAttachmentBytes,
  OwnOriginAttachmentResolver,
} from './attachmentInlinerTypes';

const log = debug('lobe-server:attachment-inliner');

const INLINE_RESOLVE_CONCURRENCY = 4;
const FILE_PROXY_PATH = /^\/f\/([^/]+)$/;
const ATTACHMENT_MESSAGE_ROLES = new Set(['assistant', 'user']);
const filesInfoBlockRe = () => /<files_info>([\s\S]*?)<\/files_info>/g;

export type AttachmentUrlKind = 'audio' | 'file' | 'image' | 'video';

export const isImageUrlPart = (
  part: UserMessageContentPart,
): part is Extract<UserMessageContentPart, { type: 'image_url' }> =>
  part.type === 'image_url' && typeof part.image_url?.url === 'string';

export const isVideoUrlPart = (
  part: UserMessageContentPart,
): part is Extract<UserMessageContentPart, { type: 'video_url' }> =>
  part.type === 'video_url' && typeof part.video_url?.url === 'string';

export const isAudioUrlPart = (
  part: UserMessageContentPart,
): part is Extract<UserMessageContentPart, { type: 'audio_url' }> =>
  part.type === 'audio_url' && typeof part.audio_url?.url === 'string';

export const countImageUrlParts = (message: OpenAIChatMessage | undefined): number => {
  if (!message || !Array.isArray(message.content)) return 0;
  return message.content.filter(isImageUrlPart).length;
};

export const setAttachmentPartUrl = (part: UserMessageContentPart, url: string): void => {
  if (isImageUrlPart(part)) part.image_url.url = url;
  else if (isFileUrlPart(part)) part.file_url.url = url;
  else if (isVideoUrlPart(part)) part.video_url.url = url;
  else if (isAudioUrlPart(part)) part.audio_url.url = url;
};

/**
 * Walk user/assistant structured parts that carry an HTTP(S) or data URL
 * (`image_url`, `file_url`, `video_url`, `audio_url`). Shared by inline and
 * rewrite-only modes. Callers that byte-fetch must skip `video`/`audio`.
 */
export const visitAttachmentPartUrls = (
  messages: OpenAIChatMessage[],
  visitor: (part: UserMessageContentPart, url: string, kind: AttachmentUrlKind) => void,
): void => {
  for (const message of messages) {
    if (!ATTACHMENT_MESSAGE_ROLES.has(message.role) || !Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (isImageUrlPart(part)) visitor(part, part.image_url.url, 'image');
      else if (isFileUrlPart(part)) visitor(part, part.file_url.url, 'file');
      else if (isVideoUrlPart(part)) visitor(part, part.video_url.url, 'video');
      else if (isAudioUrlPart(part)) visitor(part, part.audio_url.url, 'audio');
    }
  }
};

export const isDataUri = (url: unknown): boolean =>
  typeof url === 'string' && url.startsWith('data:');

export const toDataUri = (mimeType: string, bytes: Uint8Array): string =>
  `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;

export const normalizeMime = (mimeType: string | undefined): string =>
  mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
export const extractFileProxyId = (url: string): string | undefined => {
  try {
    const match = FILE_PROXY_PATH.exec(new URL(url).pathname);
    return match?.[1];
  } catch {
    return undefined;
  }
};

export const collectFileUrlFileIds = (parts: UserMessageContentPart[]): Set<string> => {
  const ids = new Set<string>();
  for (const part of parts) {
    if (!isFileUrlPart(part)) continue;
    const fileId = part.file_url.fileId ?? extractFileProxyId(part.file_url.url);
    if (fileId) ids.add(fileId);
  }
  return ids;
};

/** Only APP_URL / INTERNAL_APP_URL `/f/<id>` rules — never S3 endpoint or public-domain URLs. */
export const appFileOrigins = (origins: OwnDeploymentOrigins): OwnDeploymentOrigins => ({
  rewrite: origins.rewrite,
  rules: origins.rules.filter((rule) => rule.path.type === 'app-file'),
});

export const isResolvableAppFileUrl = (url: string, origins: OwnDeploymentOrigins): boolean =>
  Boolean(extractFileProxyId(url)) && isOwnDeploymentFileUrl(url, appFileOrigins(origins));

export const stripOwnOriginUrlAttributes = (text: string, origins: OwnDeploymentOrigins): string =>
  text.replaceAll(/ url="([^"]+)"/g, (matched, url: string) =>
    isOwnDeploymentFileUrl(url, origins) ? '' : matched,
  );

/**
 * Own-origin `url="…"` attributes are injected only inside `<files_info>` blocks
 * (`packages/prompts/src/prompts/files/index.ts`). Never rewrite ordinary user text.
 */
export const stripOwnOriginUrlAttributesInFilesInfo = (
  text: string,
  origins: OwnDeploymentOrigins,
): string => {
  if (!text.includes('<files_info>')) return text;

  return text.replaceAll(filesInfoBlockRe(), (_block, inner: string) => {
    const stripped = stripOwnOriginUrlAttributes(inner, origins);
    return `<files_info>${stripped}</files_info>`;
  });
};

/**
 * Rewrite `url="…/f/<id>"` attributes inside `<files_info>` to machine-readable
 * object URLs. Unresolved / foreign URLs are left in place. Ordinary user text
 * outside the block is never touched.
 */
export const rewriteOwnOriginUrlAttributesInFilesInfo = (
  text: string,
  rewrittenByUrl: ReadonlyMap<string, string>,
): string => {
  if (!text.includes('<files_info>') || rewrittenByUrl.size === 0) return text;

  return text.replaceAll(filesInfoBlockRe(), (_block, inner: string) => {
    const rewritten = inner.replaceAll(/ url="([^"]+)"/g, (matched, url: string) => {
      const next = rewrittenByUrl.get(url);
      return next ? ` url="${next}"` : matched;
    });
    return `<files_info>${rewritten}</files_info>`;
  });
};

const collectFilesInfoAppFileUrls = (
  messages: OpenAIChatMessage[],
  origins: OwnDeploymentOrigins,
  into: Set<string>,
): void => {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const texts: string[] = [];
    if (typeof message.content === 'string') texts.push(message.content);
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text') texts.push(part.text);
      }
    }
    for (const text of texts) {
      if (!text.includes('<files_info>')) continue;
      for (const block of text.matchAll(filesInfoBlockRe())) {
        const inner = block[1] ?? '';
        for (const attr of inner.matchAll(/ url="([^"]+)"/g)) {
          const url = attr[1];
          if (typeof url !== 'string' || isDataUri(url) || !isResolvableAppFileUrl(url, origins)) {
            continue;
          }
          into.add(url);
        }
      }
    }
  }
};

const applyFilesInfoUrlRewrites = (
  messages: OpenAIChatMessage[],
  rewrittenByUrl: ReadonlyMap<string, string>,
): void => {
  if (rewrittenByUrl.size === 0) return;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') {
      message.content = rewriteOwnOriginUrlAttributesInFilesInfo(message.content, rewrittenByUrl);
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'text') {
        part.text = rewriteOwnOriginUrlAttributesInFilesInfo(part.text, rewrittenByUrl);
      }
    }
  }
};

export const hasDocumentPageImageMarkers = (messages: OpenAIChatMessage[]): boolean => {
  for (const message of messages) {
    const { content } = message;
    if (typeof content === 'string' && content.includes('<document_page_image')) return true;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'text' && part.text.includes('<document_page_image')) return true;
    }
  }
  return false;
};
export const hasAttachmentCandidates = (messages: OpenAIChatMessage[]): boolean => {
  if (hasDocumentPageImageMarkers(messages)) return true;

  for (const message of messages) {
    const { content } = message;
    if (typeof content === 'string') {
      if (message.role === 'user' && content.includes('<files_info>')) return true;
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (part.type === 'text' && message.role === 'user' && part.text.includes('<files_info>')) {
        return true;
      }
      if (!ATTACHMENT_MESSAGE_ROLES.has(message.role)) continue;
      if (isImageUrlPart(part) && part.image_url.url && !isDataUri(part.image_url.url)) return true;
      if (isFileUrlPart(part) && !isDataUri(part.file_url.url)) return true;
      if (isVideoUrlPart(part) && part.video_url.url && !isDataUri(part.video_url.url)) return true;
      if (isAudioUrlPart(part) && part.audio_url.url && !isDataUri(part.audio_url.url)) return true;
    }
  }

  return false;
};

export const collectOwnOriginAttachmentUrls = (
  messages: OpenAIChatMessage[],
  origins: OwnDeploymentOrigins,
  caps: { fileMaxBytes: number; imageMaxBytes: number },
): Map<string, number> => {
  const maxBytesByUrl = new Map<string, number>();

  const add = (url: string, maxBytes: number) => {
    if (isDataUri(url) || !isResolvableAppFileUrl(url, origins)) return;
    const previous = maxBytesByUrl.get(url);
    maxBytesByUrl.set(url, previous === undefined ? maxBytes : Math.max(previous, maxBytes));
  };

  visitAttachmentPartUrls(messages, (_part, url, kind) => {
    // Video/audio stay on the presign fallback — byte-inlining them is an OOM risk
    // and providers rarely accept those data URIs.
    if (kind === 'video' || kind === 'audio') return;
    add(url, kind === 'image' ? caps.imageMaxBytes : caps.fileMaxBytes);
  });

  return maxBytesByUrl;
};

/** Own-origin video/audio `/f/<id>` URLs that should be presigned, never byte-fetched. */
export const collectPreviewOnlyOwnOriginUrls = (
  messages: OpenAIChatMessage[],
  origins: OwnDeploymentOrigins,
): string[] => {
  const urls: string[] = [];
  visitAttachmentPartUrls(messages, (_part, url, kind) => {
    if (kind !== 'video' && kind !== 'audio') return;
    if (isDataUri(url) || !isResolvableAppFileUrl(url, origins)) return;
    urls.push(url);
  });
  return urls;
};

const collectOwnOriginUrlSet = (
  urls: Iterable<unknown>,
  origins: OwnDeploymentOrigins,
): Set<string> => {
  const unique = new Set<string>();
  for (const url of urls) {
    if (typeof url !== 'string' || isDataUri(url) || !isResolvableAppFileUrl(url, origins)) {
      continue;
    }
    unique.add(url);
  }
  return unique;
};

export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index] as T);
      }
    }),
  );

  return results;
};

export const safeResolve = async (
  url: string,
  maxBytes: number,
  resolver: OwnOriginAttachmentResolver,
): Promise<OwnOriginAttachmentBytes | null> => {
  try {
    return await resolver(url, maxBytes);
  } catch (error) {
    log(
      'failed to resolve attachment host=%s error=%s',
      sanitizedUrlHost(url),
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/** Drop over-cap buffers immediately so they are not retained in the memo map. */
export const takeIfWithinCap = (
  url: string,
  resolved: OwnOriginAttachmentBytes | null,
  maxBytes: number,
): OwnOriginAttachmentBytes | null => {
  if (!resolved) return null;
  if (resolved.bytes.byteLength > maxBytes) {
    log(
      'skip inlining over-cap attachment host=%s size=%d max=%d',
      sanitizedUrlHost(url),
      resolved.bytes.byteLength,
      maxBytes,
    );
    return null;
  }

  return resolved;
};

export const applyInlinedUrl = (
  url: string,
  resolved: OwnOriginAttachmentBytes | null,
  maxBytes: number,
  previewUrl?: string | null,
): string => {
  const usable = takeIfWithinCap(url, resolved, maxBytes);
  if (!usable) return previewUrl || url;
  return toDataUri(usable.mimeType || 'application/octet-stream', usable.bytes);
};

export const resolveUniqueUrls = async (
  maxBytesByUrl: Map<string, number>,
  resolver: OwnOriginAttachmentResolver,
): Promise<Map<string, OwnOriginAttachmentBytes | null>> => {
  const resolvedByUrl = new Map<string, OwnOriginAttachmentBytes | null>();
  const entries = [...maxBytesByUrl.entries()];

  await mapWithConcurrency(entries, INLINE_RESOLVE_CONCURRENCY, async ([url, maxBytes]) => {
    const resolved = await safeResolve(url, maxBytes, resolver);
    resolvedByUrl.set(url, takeIfWithinCap(url, resolved, maxBytes));
  });

  return resolvedByUrl;
};

/**
 * Rewrite own-deployment app-file URLs in an image-edit `imageUrls` list to data
 * URIs. Foreign URLs, data URIs, and S3/presigned URLs are left unchanged. When
 * inlining fails (over-cap, fetch error) and `resolvePreviewUrl` is provided, the
 * leftover `/f/<id>` is replaced with a machine-readable object URL.
 * Does not mutate `urls`.
 */
export const inlineOwnOriginImageUrls = async (
  urls: readonly string[],
  resolver: OwnOriginAttachmentResolver,
  origins: OwnDeploymentOrigins,
  imageMaxBytes: number = DEFAULT_IMAGE_INLINE_MAX_BYTES,
  resolvePreviewUrl?: (url: string) => Promise<string | null>,
  prefetchUrls?: (urls: readonly string[]) => Promise<void>,
): Promise<string[]> => {
  const maxBytesByUrl = new Map<string, number>();
  for (const url of urls) {
    if (typeof url !== 'string' || isDataUri(url) || !isResolvableAppFileUrl(url, origins)) {
      continue;
    }
    maxBytesByUrl.set(url, imageMaxBytes);
  }
  if (maxBytesByUrl.size === 0) return urls as string[];

  await prefetchUrls?.([...maxBytesByUrl.keys()]);
  const resolvedByUrl = await resolveUniqueUrls(maxBytesByUrl, resolver);
  const previewUrlByUrl = await resolvePreviewUrlsForFailures(resolvedByUrl, resolvePreviewUrl);

  return urls.map((url) => {
    if (!resolvedByUrl.has(url)) return url;
    return applyInlinedUrl(
      url,
      resolvedByUrl.get(url) ?? null,
      imageMaxBytes,
      previewUrlByUrl.get(url),
    );
  });
};

export const resolvePreviewUrlMap = async (
  urls: Iterable<string>,
  resolvePreviewUrl: (url: string) => Promise<string | null>,
): Promise<Map<string, string>> => {
  const previewUrlByUrl = new Map<string, string>();
  const list = [...urls];
  if (list.length === 0) return previewUrlByUrl;

  await mapWithConcurrency(list, INLINE_RESOLVE_CONCURRENCY, async (url) => {
    try {
      const preview = await resolvePreviewUrl(url);
      if (preview) {
        previewUrlByUrl.set(url, preview);
        return;
      }
      log('leave inaccessible own-origin url untouched host=%s', sanitizedUrlHost(url));
    } catch (error) {
      log(
        'failed to resolve preview url host=%s error=%s',
        sanitizedUrlHost(url),
        error instanceof Error ? error.message : error,
      );
    }
  });

  return previewUrlByUrl;
};

export const resolvePreviewUrlsForFailures = async (
  resolvedByUrl: Map<string, OwnOriginAttachmentBytes | null>,
  resolvePreviewUrl?: (url: string) => Promise<string | null>,
): Promise<Map<string, string>> => {
  if (!resolvePreviewUrl) return new Map();

  const failedUrls = [...resolvedByUrl.entries()]
    .filter(([, resolved]) => !resolved)
    .map(([url]) => url);
  return resolvePreviewUrlMap(failedUrls, resolvePreviewUrl);
};

/**
 * Rewrite-only: replace own-deployment `/f/<id>` URLs with machine-readable
 * object URLs. No byte fetch, no size cap. Inaccessible ids stay as-is.
 */
export const rewriteOwnOriginAttachmentUrls = async (
  messages: OpenAIChatMessage[],
  origins: OwnDeploymentOrigins,
  resolvePreviewUrl: (url: string) => Promise<string | null>,
  prefetchUrls?: (urls: readonly string[]) => Promise<void>,
): Promise<void> => {
  const urls = new Set<string>();
  visitAttachmentPartUrls(messages, (_part, url) => {
    if (isDataUri(url) || !isResolvableAppFileUrl(url, origins)) return;
    urls.add(url);
  });
  collectFilesInfoAppFileUrls(messages, origins, urls);
  if (urls.size === 0) return;

  await prefetchUrls?.([...urls]);
  const rewrittenByUrl = await resolvePreviewUrlMap(urls, resolvePreviewUrl);
  if (rewrittenByUrl.size === 0) return;

  visitAttachmentPartUrls(messages, (part, url) => {
    const next = rewrittenByUrl.get(url);
    if (next) setAttachmentPartUrl(part, next);
  });
  applyFilesInfoUrlRewrites(messages, rewrittenByUrl);
};

/**
 * Rewrite-only counterpart of {@link inlineOwnOriginImageUrls}: map own-origin
 * `/f/<id>` entries to presigned/public object URLs. Does not mutate `urls`.
 */
export const rewriteOwnOriginUrls = async (
  urls: readonly string[],
  origins: OwnDeploymentOrigins,
  resolvePreviewUrl: (url: string) => Promise<string | null>,
  prefetchUrls?: (urls: readonly string[]) => Promise<void>,
): Promise<string[]> => {
  const unique = collectOwnOriginUrlSet(urls, origins);
  if (unique.size === 0) return urls as string[];

  await prefetchUrls?.([...unique]);
  const rewrittenByUrl = await resolvePreviewUrlMap(unique, resolvePreviewUrl);
  if (rewrittenByUrl.size === 0) return urls as string[];
  return urls.map((url) => rewrittenByUrl.get(url) ?? url);
};
