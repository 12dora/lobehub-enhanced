import { Buffer } from 'buffer.js';
import debug from 'debug';

import { resolveMimeTypeFromBytes } from './imageMimeType';
import { resolveBoundOwnDeploymentOrigins } from './ownDeploymentOriginsBinding';
import type { OwnDeploymentOrigins } from './url';
import {
  isOwnDeploymentFileUrl,
  isOwnDeploymentStorageObjectUrl,
  resolveOwnDeploymentFetchUrl,
  sanitizedUrlHost,
} from './url';

const log = debug('lobe-utils:imageToBase64');

/** Codex chat image inlining cap. Callers must pass this explicitly as `maxBytes`. */
export const DEFAULT_IMAGE_INLINE_MAX_BYTES = 20 * 1024 * 1024;

/** Responses `input_file` / document inlining cap. Callers must pass this explicitly. */
export const DEFAULT_FILE_INLINE_MAX_BYTES = 32 * 1024 * 1024;

const OWN_ORIGIN_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class AttachmentInlineLimitError extends Error {
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(maxBytes: number, byteLength: number) {
    super(`Attachment exceeds the ${maxBytes} byte inlining limit`);
    this.name = 'AttachmentInlineLimitError';
    this.byteLength = byteLength;
    this.maxBytes = maxBytes;
  }
}

export class AttachmentFetchError extends Error {
  readonly status?: number;

  constructor(host: string, status?: number) {
    super(
      status === undefined
        ? `failed to download attachment from ${host}`
        : `failed to download attachment from ${host}: status=${status}`,
    );
    this.name = 'AttachmentFetchError';
    this.status = status;
  }
}

export interface ImageUrlToBase64Options {
  maxBytes?: number;
  /**
   * Fail closed unless the URL (and every redirect) is an allowlisted
   * deployment file origin + file route. ChatGPT/Codex must pass this.
   */
  ownOriginOnly?: boolean;
  /**
   * Immutable origin/path rules resolved server-side from the effective
   * storage snapshot. Required when `ownOriginOnly` is set.
   */
  ownOrigins?: OwnDeploymentOrigins | Promise<OwnDeploymentOrigins>;
}

const BASE64_BODY = /^[A-Z0-9+/]*={0,2}$/i;

/**
 * Floor-aware decoded byte length of a base64 payload. Does not allocate the
 * decoded buffer. Unpadded payloads (length % 4 !== 0) are valid; `YWI` is 2
 * bytes, not 2.25.
 */
export const decodedBase64ByteLength = (base64: string): number => {
  const compact = base64.replaceAll(/\s/g, '');
  if (!compact) return 0;
  if (!BASE64_BODY.test(compact)) {
    throw new TypeError('Invalid base64 payload');
  }

  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  if (padding > 0 && compact.length % 4 !== 0) {
    throw new TypeError('Invalid base64 payload');
  }
  if (padding === 0 && compact.length % 4 === 1) {
    throw new TypeError('Invalid base64 payload');
  }

  return Math.floor(((compact.length - padding) * 3) / 4);
};

export const assertDecodedBase64WithinLimit = (base64: string, maxBytes: number): void => {
  const byteLength = decodedBase64ByteLength(base64);
  if (byteLength > maxBytes) {
    throw new AttachmentInlineLimitError(maxBytes, byteLength);
  }
};

export const imageToBase64 = ({
  size,
  img,
  type = 'image/webp',
}: {
  img: HTMLImageElement;
  size: number;
  type?: string;
}) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let startX = 0;
  let startY = 0;

  if (img.width > img.height) {
    startX = (img.width - img.height) / 2;
  } else {
    startY = (img.height - img.width) / 2;
  }

  canvas.width = size;
  canvas.height = size;

  ctx.drawImage(
    img,
    startX,
    startY,
    Math.min(img.width, img.height),
    Math.min(img.width, img.height),
    0,
    0,
    size,
    size,
  );

  return canvas.toDataURL(type);
};

const isRedirect = (status: number): boolean => REDIRECT_STATUSES.has(status);

const ownOriginFetchSsrfOptions = {
  allowPrivateIPAddress: true,
  maxRedirects: 0,
  redactErrors: true,
} as const;

const resolveOriginsForFetch = async (
  options: ImageUrlToBase64Options | undefined,
  ownOriginOnly: boolean,
): Promise<OwnDeploymentOrigins | undefined> => {
  if (options?.ownOrigins !== undefined) {
    return options.ownOrigins;
  }
  // Fail-closed ownOriginOnly callers must keep today's "no rules" behaviour
  // when they omit `ownOrigins`. The process-wide binding is only for default
  // callers (LLM vision, over-cap fallbacks) that did not opt into ownOriginOnly.
  if (ownOriginOnly) return undefined;
  return resolveBoundOwnDeploymentOrigins();
};

const fetchAttachment = async (
  imageUrl: string,
  options: ImageUrlToBase64Options | undefined,
  isServer: boolean,
  ownOriginFetch: boolean,
): Promise<Response> => {
  const maxBytes = options?.maxBytes;
  const ssrfOptions = {
    ...(ownOriginFetch ? ownOriginFetchSsrfOptions : {}),
    ...(maxBytes !== undefined ? { maxContentLength: maxBytes + 1 } : {}),
  };
  const requestInit: RequestInit | undefined = ownOriginFetch ? { redirect: 'manual' } : undefined;
  const hasSsrfOptions = Object.keys(ssrfOptions).length > 0;

  if (isServer) {
    const { ssrfSafeFetch } = await import('@lobechat/ssrf-safe-fetch');
    return ssrfSafeFetch(imageUrl, requestInit ?? {}, hasSsrfOptions ? ssrfOptions : undefined);
  }

  return requestInit ? fetch(imageUrl, requestInit) : fetch(imageUrl);
};

const resolveRedirectLocation = (currentUrl: string, response: Response): string => {
  const location = response.headers.get('location');
  if (!location) {
    throw new AttachmentFetchError(sanitizedUrlHost(currentUrl), response.status);
  }
  return new URL(location, currentUrl).href;
};

/**
 * Convert image URL to base64.
 * Uses SSRF-safe fetch on server-side. Defaults match the historical helper:
 * no size cap, `SSRF_ALLOW_PRIVATE_IP_ADDRESS` honored, no own-origin rewrite.
 * ChatGPT callers pass `{ maxBytes, ownOriginOnly: true }`.
 */
export const imageUrlToBase64 = async (
  imageUrl: string,
  options?: ImageUrlToBase64Options,
): Promise<{ base64: string; mimeType: string }> => {
  const ownOriginOnly = options?.ownOriginOnly === true;
  const maxBytes = options?.maxBytes;
  const isServer = typeof window === 'undefined';
  let ownOriginFetch = ownOriginOnly;

  try {
    const origins = await resolveOriginsForFetch(options, ownOriginOnly);
    // Binding / explicit origins: own-origin mechanics only when this URL is a
    // storage object of this deployment (never app routes on a shared domain,
    // never arbitrary private hosts). `ownOriginOnly` callers keep the wider
    // app-file + storage allowlist because they only ever receive own links.
    const matchesOwn = (url: string) =>
      ownOriginOnly
        ? isOwnDeploymentFileUrl(url, origins)
        : isOwnDeploymentStorageObjectUrl(url, origins);
    ownOriginFetch = ownOriginOnly || matchesOwn(imageUrl);
    let currentUrl = ownOriginFetch ? resolveOwnDeploymentFetchUrl(imageUrl, origins) : imageUrl;

    let res: Response | undefined;
    for (let hop = 0; hop <= OWN_ORIGIN_MAX_REDIRECTS; hop += 1) {
      if (ownOriginFetch && !matchesOwn(currentUrl)) {
        throw new AttachmentFetchError(sanitizedUrlHost(currentUrl));
      }

      res = await fetchAttachment(currentUrl, options, isServer, ownOriginFetch);

      if (ownOriginFetch && isRedirect(res.status)) {
        currentUrl = resolveRedirectLocation(currentUrl, res);
        continue;
      }
      break;
    }

    if (!res || (ownOriginFetch && isRedirect(res.status))) {
      throw new AttachmentFetchError(sanitizedUrlHost(currentUrl));
    }

    if (!res.ok) {
      throw new AttachmentFetchError(sanitizedUrlHost(currentUrl), res.status);
    }

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    if (maxBytes !== undefined && arrayBuffer.byteLength > maxBytes) {
      throw new AttachmentInlineLimitError(maxBytes, arrayBuffer.byteLength);
    }
    const mimeType = await resolveMimeTypeFromBytes(blob.type, arrayBuffer);

    const base64 = isServer
      ? Buffer.from(arrayBuffer).toString('base64')
      : btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
        );

    return { base64, mimeType };
  } catch (error) {
    if (error instanceof AttachmentInlineLimitError) throw error;
    if (error instanceof AttachmentFetchError) {
      log(
        'inline failed: host=%s error=%s status=%s',
        sanitizedUrlHost(imageUrl),
        error.name,
        error.status ?? '-',
      );
      throw error;
    }
    if (ownOriginFetch) {
      const host = sanitizedUrlHost(imageUrl);
      log('inline failed: host=%s error=%s status=-', host, 'AttachmentFetchError');
      throw new AttachmentFetchError(host);
    }
    throw error;
  }
};
