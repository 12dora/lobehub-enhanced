import { TRPCError } from '@trpc/server';

import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';
import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { PLATFORM_STATUS_SETTINGS_ID } from '@/database/models/platform/statusSettings';
import type { LobeChatDatabase } from '@/database/type';
import { preAccessAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type {
  StatusAlertRobotSecretInput,
  StatusAlertRobotWebhookInput,
} from '@/types/platform/statusAlerts';

import {
  adminSystemAlertsGetOutputSchema,
  adminSystemAlertsTestInputSchema,
  adminSystemAlertsTestOutputSchema,
  adminSystemAlertsUpdateInputSchema,
  adminSystemAlertsUpdateOutputSchema,
} from '../../contracts/adminSystem/alerts';
import { withActiveUser } from '../../guards/activeUser';
import { withAdminMutationRateLimit } from '../../guards/adminMutationRateLimit';
import { throwEnterpriseError } from '../../guards/enterpriseErrors';
import { withPlatformPermission } from '../../guards/platformPermission';
import type { AuditAction } from '../../services/audit/auditActionCatalog';
import { PlatformAuditService } from '../../services/platformAudit';
import { sendStoredStatusAlertTest } from '../../services/platformSystem/statusAlerts';
import {
  encryptRobotSecret,
  StatusAlertSettingsService,
} from '../../services/platformSystem/statusAlertSettings';
import { executePlatformSystem } from './system.errors';

const ALERTS_TEST_ACTION = 'admin.system.alerts.test' as AuditAction;

const platformSystemBase = preAccessAuthedProcedure
  .use(serverDatabase)
  .use(withActiveUser())
  .use(withAdminMutationRateLimit());

const encryptOrReject = async (
  plaintext: string,
  failure: 'secret' | 'webhook',
): Promise<string> => {
  try {
    return await encryptRobotSecret(plaintext);
  } catch (error) {
    console.error('[status-alert] robot credential encrypt failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      failure,
    });
    return throwEnterpriseError({
      code: PLATFORM_ERROR_CODES.PLATFORM_INVALID_INPUT,
      httpCode: 'BAD_REQUEST',
      message: failure === 'secret' ? '无法保存群机器人密钥' : '无法保存群机器人 Webhook',
    });
  }
};

const resolveRobotSecretCiphertext = async (
  robotSecret: StatusAlertRobotSecretInput | undefined,
): Promise<string | null | undefined> => {
  if (!robotSecret || robotSecret.action === 'keep') return undefined;
  if (robotSecret.action === 'clear') return null;
  return encryptOrReject(robotSecret.value, 'secret');
};

const resolveRobotWebhookCiphertext = async (
  robotWebhook: StatusAlertRobotWebhookInput | undefined,
): Promise<string | null | undefined> => {
  if (!robotWebhook || robotWebhook.action === 'keep') return undefined;
  if (robotWebhook.action === 'clear') return null;
  return encryptOrReject(robotWebhook.value, 'webhook');
};

const auditAlertTest = async (
  db: LobeChatDatabase,
  actorUserId: string,
  afterDiff: Record<string, unknown>,
  result: 'failure' | 'success',
) => {
  try {
    await new PlatformAuditService(db).append({
      action: ALERTS_TEST_ACTION,
      actorUserId,
      afterDiff,
      result,
      targetId: PLATFORM_STATUS_SETTINGS_ID,
      targetType: 'system',
    });
  } catch (error) {
    console.error('[status-alert] test audit failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }
};

export const adminSystemAlertsRouter = router({
  get: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemAlertsGetOutputSchema)
    .query(({ ctx }) =>
      executePlatformSystem(() => new StatusAlertSettingsService(ctx.serverDB).getView()),
    ),

  test: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemAlertsTestInputSchema)
    .output(adminSystemAlertsTestOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const outcome = await executePlatformSystem(() =>
          sendStoredStatusAlertTest(ctx.serverDB, input.channel),
        );
        await auditAlertTest(
          ctx.serverDB,
          ctx.userId!,
          { channel: input.channel, delivered: outcome.delivered, ok: outcome.ok },
          outcome.ok ? 'success' : 'failure',
        );
        return outcome;
      } catch (error) {
        await auditAlertTest(
          ctx.serverDB,
          ctx.userId!,
          {
            channel: input.channel,
            error:
              error instanceof TRPCError
                ? error.code
                : error instanceof Error
                  ? error.name
                  : 'UnknownError',
          },
          'failure',
        );
        if (error instanceof TRPCError) throw error;
        return executePlatformSystem(() => Promise.reject(error));
      }
    }),

  update: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemAlertsUpdateInputSchema)
    .output(adminSystemAlertsUpdateOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const robotSecretCiphertext = await resolveRobotSecretCiphertext(input.robotSecret);
      const robotWebhookCiphertext = await resolveRobotWebhookCiphertext(input.robotWebhook);
      return executePlatformSystem(() =>
        new StatusAlertSettingsService(ctx.serverDB).update({
          actorUserId: ctx.userId!,
          expectedRevision: input.expectedRevision,
          robotSecret: input.robotSecret,
          robotSecretCiphertext,
          robotWebhook: input.robotWebhook,
          robotWebhookCiphertext,
          settings: input.settings,
        }),
      );
    }),
});
