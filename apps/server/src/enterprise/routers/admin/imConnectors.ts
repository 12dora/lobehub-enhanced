import { TRPCError } from '@trpc/server';

import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';
import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { preAccessAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  adminImConnectorBindingItemSchema,
  adminImConnectorBindingsListInputSchema,
  adminImConnectorBindingsListOutputSchema,
  adminImConnectorBindingsRemoveInputSchema,
  adminImConnectorBindingsRemoveOutputSchema,
  adminImConnectorBindingsUpsertInputSchema,
  adminImConnectorGetInputSchema,
  adminImConnectorListOutputSchema,
  adminImConnectorTestInputSchema,
  adminImConnectorTestOutputSchema,
  adminImConnectorUpsertInputSchema,
  adminImConnectorViewSchema,
} from '../../contracts/adminImConnectors';
import { withActiveUser } from '../../guards/activeUser';
import { withAdminMutationRateLimit } from '../../guards/adminMutationRateLimit';
import { throwEnterpriseError } from '../../guards/enterpriseErrors';
import { withPlatformPermission } from '../../guards/platformPermission';
import {
  ImConnectorBindingUserNotFoundError,
  ImConnectorPlatformUserAlreadyBoundError,
  PLATFORM_USER_ALREADY_BOUND,
} from '../../services/imConnectors/bindings';
import { ImConnectorsAdminService } from '../../services/imConnectors/service';
import { executePlatformSystem } from './system.errors';

const platformSystemBase = preAccessAuthedProcedure
  .use(serverDatabase)
  .use(withActiveUser())
  .use(withAdminMutationRateLimit());

const executeImConnectors = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof ImConnectorPlatformUserAlreadyBoundError) {
      throw new TRPCError({
        cause: {
          data: {
            code: PLATFORM_USER_ALREADY_BOUND,
            details: {
              boundUserEmail: error.boundUser.email,
              boundUserId: error.boundUser.id,
              boundUserName: error.boundUser.name,
              boundVia: error.boundUser.boundVia,
            },
            message: `DingTalk user is already bound to ${error.boundUser.email ?? error.boundUser.id}`,
          },
        },
        code: 'CONFLICT',
        message: PLATFORM_USER_ALREADY_BOUND,
      });
    }
    if (error instanceof ImConnectorBindingUserNotFoundError) {
      return throwEnterpriseError({
        code: PLATFORM_ERROR_CODES.PLATFORM_NOT_FOUND,
        httpCode: 'NOT_FOUND',
      });
    }
    return executePlatformSystem(() => Promise.reject(error));
  }
};

export const adminImConnectorsRouter = router({
  bindings: router({
    list: platformSystemBase
      .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
      .input(adminImConnectorBindingsListInputSchema)
      .output(adminImConnectorBindingsListOutputSchema)
      .query(({ ctx, input }) =>
        executeImConnectors(() => new ImConnectorsAdminService(ctx.serverDB).listBindings(input)),
      ),

    remove: platformSystemBase
      .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
      .input(adminImConnectorBindingsRemoveInputSchema)
      .output(adminImConnectorBindingsRemoveOutputSchema)
      .mutation(({ ctx, input }) =>
        executeImConnectors(() =>
          new ImConnectorsAdminService(ctx.serverDB).removeBinding({
            actorUserId: ctx.userId!,
            input,
          }),
        ),
      ),

    upsert: platformSystemBase
      .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
      .input(adminImConnectorBindingsUpsertInputSchema)
      .output(adminImConnectorBindingItemSchema)
      .mutation(({ ctx, input }) =>
        executeImConnectors(() =>
          new ImConnectorsAdminService(ctx.serverDB).upsertBinding({
            actorUserId: ctx.userId!,
            input,
          }),
        ),
      ),
  }),

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
