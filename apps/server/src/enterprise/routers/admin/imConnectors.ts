import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { preAccessAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  adminImConnectorGetInputSchema,
  adminImConnectorListOutputSchema,
  adminImConnectorTestInputSchema,
  adminImConnectorTestOutputSchema,
  adminImConnectorUpsertInputSchema,
  adminImConnectorViewSchema,
} from '../../contracts/adminImConnectors';
import { withActiveUser } from '../../guards/activeUser';
import { withAdminMutationRateLimit } from '../../guards/adminMutationRateLimit';
import { withPlatformPermission } from '../../guards/platformPermission';
import { ImConnectorsAdminService } from '../../services/imConnectors/service';
import { executePlatformSystem } from './system.errors';

const platformSystemBase = preAccessAuthedProcedure
  .use(serverDatabase)
  .use(withActiveUser())
  .use(withAdminMutationRateLimit());

export const adminImConnectorsRouter = router({
  get: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .input(adminImConnectorGetInputSchema)
    .output(adminImConnectorViewSchema)
    .query(({ ctx, input }) =>
      executePlatformSystem(() => new ImConnectorsAdminService(ctx.serverDB).get(input.platform)),
    ),

  list: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminImConnectorListOutputSchema)
    .query(({ ctx }) =>
      executePlatformSystem(() => new ImConnectorsAdminService(ctx.serverDB).list()),
    ),

  test: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminImConnectorTestInputSchema)
    .output(adminImConnectorTestOutputSchema)
    .mutation(({ ctx, input }) =>
      executePlatformSystem(() => new ImConnectorsAdminService(ctx.serverDB).test(input)),
    ),

  upsert: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminImConnectorUpsertInputSchema)
    .output(adminImConnectorViewSchema)
    .mutation(({ ctx, input }) =>
      executePlatformSystem(() =>
        new ImConnectorsAdminService(ctx.serverDB).upsert({
          actorUserId: ctx.userId!,
          input,
        }),
      ),
    ),
});
