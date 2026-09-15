import debug from 'debug';
import { and, eq, isNull } from 'drizzle-orm';

import { auth } from '@/auth';
import { FileModel } from '@/database/models/file';
import { platformBrandingAssets } from '@/database/schemas/platform';
import { getServerDB } from '@/database/server';
import { assertUserActiveCached } from '@/libs/oidc-provider/userActiveCache';
import { isPlatformBrandingAssetId } from '@/server/enterprise/contracts/adminBranding';
import { FileService } from '@/server/services/file';
import { recordAuditorFileOpen, resolveFileAccess } from '@/server/services/file/fileAccess';
import { createFileServiceModule } from '@/server/services/file/impls';

const log = debug('lobe-file:proxy');

const cacheHeaders = {
  'Cache-Control': 'private, no-store',
  'Vary': 'Cookie',
} as const;

const redirectToObject = (location: string, mimeType: string): Response =>
  new Response(null, {
    headers: {
      ...cacheHeaders,
      'Content-Type': mimeType,
      'Location': location,
      'X-Content-Type-Options': 'nosniff',
    },
    status: 302,
  });

const textResponse = (body: string, status: number): Response =>
  new Response(body, { headers: cacheHeaders, status });

type Params = Promise<{ id: string }>;

const isUnauthorizedAuthError = (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === 'UNAUTHORIZED';

const unauthorized = () => textResponse('Unauthorized', 401);

/**
 * File proxy service
 * GET /f/:id
 *
 * Session-authorized file proxy. Browser clients send Better Auth cookies
 * (same-origin `<img>` / download). Machine consumers (LLM providers,
 * server-side fetchers) must not call this endpoint — they receive short-lived
 * presigned object URLs or data URIs from FileService instead.
 *
 * Platform branding assets (`pba_*`) remain public (login chrome, emails).
 *
 * Access: file owner, workspace member (public/NULL visibility), topic
 * link-share attachment, or auditor with conversation body access. Success is a
 * 302 to a cached S3 presigned URL with private/no-store headers.
 */
export const GET = async (req: Request, segmentData: { params: Params }) => {
  try {
    const params = await segmentData.params;
    const { id } = params;

    log('File proxy request: %s', id);

    const db = await getServerDB();

    if (id.startsWith('pba_')) {
      if (!isPlatformBrandingAssetId(id)) return textResponse('File not found', 404);
      const [asset] = await db
        .select({
          mimeType: platformBrandingAssets.mimeType,
          objectKey: platformBrandingAssets.objectKey,
        })
        .from(platformBrandingAssets)
        .where(
          and(
            eq(platformBrandingAssets.id, id),
            eq(platformBrandingAssets.status, 'ready'),
            isNull(platformBrandingAssets.objectDeletedAt),
          ),
        )
        .limit(1);
      if (!asset) return textResponse('File not found', 404);
      const redirectUrl = await createFileServiceModule(db).createCachedPreSignedUrlForPreview(
        asset.objectKey,
      );
      return redirectToObject(redirectUrl, asset.mimeType);
    }

    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session?.user?.id) {
      return unauthorized();
    }

    const userId = session.user.id;
    const rawCreatedAt = session.session?.createdAt;
    const sessionCreatedAt =
      rawCreatedAt instanceof Date ? rawCreatedAt : rawCreatedAt ? new Date(rawCreatedAt) : null;
    const credentialIssuedAt =
      sessionCreatedAt && !Number.isNaN(sessionCreatedAt.getTime()) ? sessionCreatedAt : null;
    const sessionId = typeof session.session?.id === 'string' ? session.session.id : null;

    try {
      await assertUserActiveCached(db, userId, { credentialIssuedAt, sessionId });
    } catch (error) {
      if (isUnauthorizedAuthError(error)) return unauthorized();
      throw error;
    }

    const file = await FileModel.getFileById(db, id);

    if (!file) {
      log('File not found: %s', id);
      return textResponse('File not found', 404);
    }

    const access = await resolveFileAccess({
      db,
      file: {
        id: file.id,
        userId: file.userId,
        visibility: file.visibility,
        workspaceId: file.workspaceId,
      },
      viewerUserId: userId,
    });

    if (!access.allowed) {
      return textResponse('Forbidden', 403);
    }

    if (access.reason === 'auditor') {
      await recordAuditorFileOpen(db, { actorUserId: userId, fileId: file.id });
    }

    const fileService = new FileService(db, file.userId);

    const redirectUrl = await fileService.createCachedPreSignedUrlForPreview(file.url);
    log('Web S3 presigned URL generated');

    return redirectToObject(redirectUrl, file.fileType || 'application/octet-stream');
  } catch (error) {
    console.error('File proxy error:', error);
    return textResponse('Internal server error', 500);
  }
};
