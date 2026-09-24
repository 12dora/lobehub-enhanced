import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { preAccessAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  adminSystemStatusApiRevokeInputSchema,
  adminSystemStatusApiRevokeOutputSchema,
  adminSystemStatusApiRotateInputSchema,
  adminSystemStatusApiRotateOutputSchema,
  adminSystemStatusApiViewSchema,
} from '../../contracts/adminSystem';
import { withActiveUser } from '../../guards/activeUser';
import { withAdminMutationRateLimit } from '../../guards/adminMutationRateLimit';
import { withPlatformPermission } from '../../guards/platformPermission';
import { assertDangerousReauthWithAudit } from '../../guards/reauth';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../services/audit/auditActionCatalog';
import {
  getStatusApiView,
  revokeStatusApiToken,
  rotateStatusApiToken,
} from '../../services/platformSystem/statusApi';
import { executePlatformSystem } from './system.errors';
import type { SystemHandlerCtx } from './system.reauth';

const platformSystemBase = preAccessAuthedProcedure
  .use(serverDatabase)
  .use(withActiveUser())
  .use(withAdminMutationRateLimit());

const assertStatusApiReauth = (
  ctx: SystemHandlerCtx,
  input: { reason?: string | null },
  action:
    typeof AUDIT_ACTION.SYSTEM_STATUS_API_ROTATE | typeof AUDIT_ACTION.SYSTEM_STATUS_API_REVOKE,
) =>
  assertDangerousReauthWithAudit({
    authenticatedAt: ctx.authenticatedAt,
    authMethod: ctx.authMethod,
    serverDB: ctx.serverDB,
    denied: {
      action,
      actorUserId: ctx.userId!,
      reason: input.reason,
      targetId: 'status_api',
      targetType: AUDIT_TARGET_TYPE.SYSTEM,
    },
  });

export const adminSystemStatusApiRouter = router({
  get: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemStatusApiViewSchema)
    .query(({ ctx }) => executePlatformSystem(() => getStatusApiView(ctx.serverDB))),

  revoke: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemStatusApiRevokeInputSchema)
    .output(adminSystemStatusApiRevokeOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertStatusApiReauth(ctx, input, AUDIT_ACTION.SYSTEM_STATUS_API_REVOKE);
      return executePlatformSystem(() =>
        revokeStatusApiToken(ctx.serverDB, ctx.userId!, input.reason),
      );
    }),

  rotate: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemStatusApiRotateInputSchema)
    .output(adminSystemStatusApiRotateOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertStatusApiReauth(ctx, input, AUDIT_ACTION.SYSTEM_STATUS_API_ROTATE);
      return executePlatformSystem(() =>
        rotateStatusApiToken(ctx.serverDB, ctx.userId!, input.reason),
      );
    }),
});
