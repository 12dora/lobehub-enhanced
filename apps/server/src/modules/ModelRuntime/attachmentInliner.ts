import type { ModelRuntimeHooks } from '@lobechat/model-runtime';
import { DOCUMENT_RENDER_DEFAULTS } from '@lobechat/types';
import { DEFAULT_IMAGE_INLINE_MAX_BYTES } from '@lobechat/utils/imageToBase64';
import debug from 'debug';

import { IMAGE_ONLY_PDF_MAX_IMAGES_PER_MESSAGE } from './attachmentInlinerPdf';
import { inlineOwnOriginAttachments } from './attachmentInlinerPipeline';
import { createFileServiceResolvers } from './attachmentInlinerResolvers';
import type {
  CreateOwnOriginAttachmentInlineHooksInput,
  CreateOwnOriginAttachmentRewriteHooksInput,
} from './attachmentInlinerTypes';
import {
  hasAttachmentCandidates,
  inlineOwnOriginImageUrls,
  isDataUri,
  rewriteOwnOriginAttachmentUrls,
  rewriteOwnOriginUrls,
} from './attachmentInlinerUrls';

export { inlineOwnOriginAttachments } from './attachmentInlinerPipeline';
export type {
  CreateOwnOriginAttachmentInlineHooksInput,
  CreateOwnOriginAttachmentRewriteHooksInput,
  InlineOwnOriginAttachmentsOptions,
  OwnOriginAttachmentBytes,
  OwnOriginAttachmentResolver,
  OwnOriginFileIdResolver,
} from './attachmentInlinerTypes';
export {
  inlineOwnOriginImageUrls,
  rewriteOwnOriginAttachmentUrls,
  rewriteOwnOriginUrls,
} from './attachmentInlinerUrls';

const log = debug('lobe-server:attachment-inliner');

const resolveMaybeLazy = async <T>(value: T | Promise<T> | (() => T | Promise<T>)): Promise<T> =>
  typeof value === 'function' ? (value as () => T | Promise<T>)() : value;

const isHttpCreateImageUrl = (url: unknown): url is string =>
  typeof url === 'string' && url.length > 0 && !isDataUri(url);

const createImageParamsHaveHttpUrls = (params: {
  imageUrl?: string;
  imageUrls?: string[];
}): boolean =>
  isHttpCreateImageUrl(params.imageUrl) ||
  Boolean(params.imageUrls?.some((url) => isHttpCreateImageUrl(url)));

const rewriteCreateImageParams = async (
  params: { imageUrl?: string; imageUrls?: string[] },
  rewriteUrls: (urls: readonly string[]) => Promise<string[]>,
): Promise<void> => {
  if (isHttpCreateImageUrl(params.imageUrl)) {
    const [next] = await rewriteUrls([params.imageUrl]);
    params.imageUrl = next;
  }
  if (params.imageUrls?.some((url) => isHttpCreateImageUrl(url))) {
    params.imageUrls = await rewriteUrls(params.imageUrls);
  }
};

export const createOwnOriginAttachmentInlineHooks = (
  input: CreateOwnOriginAttachmentInlineHooksInput,
): ModelRuntimeHooks => {
  const imageMaxBytes = input.imageMaxBytes ?? DEFAULT_IMAGE_INLINE_MAX_BYTES;
  const tools = input.tools ?? true;

  const resolveLimits = async () => {
    const fallback = {
      imageMaxCount: input.imageMaxCount ?? IMAGE_ONLY_PDF_MAX_IMAGES_PER_MESSAGE,
      maxDocsPerRequest: input.maxDocsPerRequest ?? DOCUMENT_RENDER_DEFAULTS.maxDocsPerRequest,
    };
    if (!input.resolveFeedLimits) return fallback;
    try {
      return await input.resolveFeedLimits();
    } catch (error) {
      log('feed limits failed: %s', error instanceof Error ? error.message : error);
      console.error('document-render feed limits failed', error);
      return fallback;
    }
  };

  return {
    beforeChat: async (payload) => {
      try {
        if (!payload.messages?.length || !hasAttachmentCandidates(payload.messages)) return;

        const limits = await resolveLimits();
        const origins = await resolveMaybeLazy(input.ownOrigins);
        const resolvers = createFileServiceResolvers(input, origins);
        await inlineOwnOriginAttachments(payload.messages, resolvers.resolveByUrl, origins, {
          authorizeFile: resolvers.authorizeFile,
          imageMaxBytes,
          imageMaxCount: limits.imageMaxCount,
          loadArtifact: resolvers.loadArtifact,
          loadRender: resolvers.loadRender,
          loadTextIndex: resolvers.loadTextIndex,
          maxDocsPerRequest: limits.maxDocsPerRequest,
          resolveByFileId: resolvers.resolveByFileId,
          resolvePreviewUrl: resolvers.resolvePreviewUrl,
          tools,
        });
      } catch (error) {
        log(
          'own-origin attachment inline failed: %s',
          error instanceof Error ? error.message : error,
        );
      }
    },
    beforeCreateImage: async (payload) => {
      try {
        if (!createImageParamsHaveHttpUrls(payload.params)) return;

        const origins = await resolveMaybeLazy(input.ownOrigins);
        const resolvers = createFileServiceResolvers(input, origins);
        await rewriteCreateImageParams(payload.params, (urls) =>
          inlineOwnOriginImageUrls(
            urls,
            resolvers.resolveByUrl,
            origins,
            imageMaxBytes,
            resolvers.resolvePreviewUrl,
          ),
        );
      } catch (error) {
        log(
          'own-origin imageUrls inline failed: %s',
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
};

/**
 * Rewrite-only hooks for providers that fetch image/file/video URLs over HTTP.
 * Own-deployment `/f/<id>` is replaced with a short-lived object URL; bytes are
 * never inlined. Missing `userId` is a no-op (no unscoped FileModel lookup).
 */
export const createOwnOriginAttachmentRewriteHooks = (
  input: CreateOwnOriginAttachmentRewriteHooksInput,
): ModelRuntimeHooks => {
  return {
    beforeChat: async (payload) => {
      try {
        if (!input.userId) {
          log('skip rewrite (no userId)');
          return;
        }
        if (!payload.messages?.length || !hasAttachmentCandidates(payload.messages)) return;

        const origins = await resolveMaybeLazy(input.ownOrigins);
        const resolvers = createFileServiceResolvers(input, origins);
        await rewriteOwnOriginAttachmentUrls(
          payload.messages,
          origins,
          resolvers.resolvePreviewUrl,
        );
      } catch (error) {
        log(
          'own-origin attachment rewrite failed: %s',
          error instanceof Error ? error.message : error,
        );
      }
    },
    beforeCreateImage: async (payload) => {
      try {
        if (!input.userId) {
          log('skip rewrite (no userId)');
          return;
        }
        if (!createImageParamsHaveHttpUrls(payload.params)) return;

        const origins = await resolveMaybeLazy(input.ownOrigins);
        const resolvers = createFileServiceResolvers(input, origins);
        await rewriteCreateImageParams(payload.params, (urls) =>
          rewriteOwnOriginUrls(urls, origins, resolvers.resolvePreviewUrl),
        );
      } catch (error) {
        log(
          'own-origin imageUrls rewrite failed: %s',
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
};
