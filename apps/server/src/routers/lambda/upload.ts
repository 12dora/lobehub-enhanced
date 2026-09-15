import { isRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { createFileS3 } from '@/server/modules/S3';
import {
  assertClientObjectKey,
  getWideClientUploadPrefixes,
} from '@/server/services/file/objectKeyPolicy';

/**
 * HeadObject of a missing key returns 403 when the identity lacks `s3:ListBucket`.
 * This deployment uses full-access bucket creds, so 404 / NotFound / NoSuchKey is
 * the expected missing-key shape. Any other error must fail closed.
 */
const isS3NotFoundError = (error: unknown): boolean => {
  if (!isRecord(error)) return false;
  if (error.name === 'NotFound' || error.name === 'NoSuchKey') return true;
  const metadata = error.$metadata;
  if (!isRecord(metadata)) return false;
  return metadata.httpStatusCode === 404;
};

export const uploadRouter = router({
  createS3PreSignedUrl: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input }) => {
      const key = assertClientObjectKey(input.pathname, {
        prefixes: getWideClientUploadPrefixes(),
      });
      const s3 = await createFileS3();

      let exists = true;
      try {
        await s3.getFileMetadata(key);
      } catch (error) {
        if (!isS3NotFoundError(error)) {
          throw new TRPCError({
            cause: error,
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to check object',
          });
        }
        exists = false;
      }

      if (exists) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Object already exists',
        });
      }

      return await s3.createPreSignedUrl(key);
    }),
});

export type FileRouter = typeof uploadRouter;
