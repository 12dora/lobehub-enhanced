import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { createFileS3 } from '@/server/modules/S3';
import { assertClientObjectKey } from '@/server/services/file/objectKeyPolicy';

export const uploadRouter = router({
  createS3PreSignedUrl: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input }) => {
      const key = assertClientObjectKey(input.pathname);
      const s3 = await createFileS3();

      try {
        await s3.getFileMetadata(key);
      } catch {
        return await s3.createPreSignedUrl(key);
      }

      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Object already exists',
      });
    }),
});

export type FileRouter = typeof uploadRouter;
