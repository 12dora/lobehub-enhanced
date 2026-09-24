import type {
  AdminSystemTestEnterpriseLookupProviderInput,
  AdminSystemUpdateEnterpriseLookupSettingsInput,
} from '../../contracts/adminSystem/enterpriseLookup';
import { assertDangerousReauthWithAudit } from '../../guards/reauth';
import { AUDIT_ACTION } from '../../services/audit/auditActionCatalog';
import {
  enterpriseLookupSecretChanged,
  EnterpriseLookupSettingsService,
  invalidateEnterpriseLookupRuntimeConfig,
  summarizeEnterpriseLookupAfterDiff,
  testEnterpriseLookupProvider,
} from '../../services/enterpriseLookup/settings';
import { INFRA_SETTINGS_AUDIT_TARGET_TYPE } from '../../services/infraSettings';
import { assertModuleEnabled } from '../../services/moduleSettings';
import { PlatformAuditService } from '../../services/platformAudit';
import { executePlatformSystem } from './system.errors';
import type { SystemHandlerCtx } from './system.reauth';

const TARGET_ID = 'enterprise_lookup';

export const getEnterpriseLookupSettings = async ({ ctx }: { ctx: SystemHandlerCtx }) => {
  await assertModuleEnabled('enterpriseLookup');
  return executePlatformSystem(() => new EnterpriseLookupSettingsService(ctx.serverDB).get());
};

export const updateEnterpriseLookupSettings = async ({
  ctx,
  input,
}: {
  ctx: SystemHandlerCtx;
  input: AdminSystemUpdateEnterpriseLookupSettingsInput;
}) => {
  await assertModuleEnabled('enterpriseLookup');
  await assertDangerousReauthWithAudit({
    authenticatedAt: ctx.authenticatedAt,
    authMethod: ctx.authMethod,
    serverDB: ctx.serverDB,
    denied: {
      action: AUDIT_ACTION.SYSTEM_INFRA_ENTERPRISE_LOOKUP_UPDATE,
      actorUserId: ctx.userId!,
      reason: input.reason,
      targetId: TARGET_ID,
      targetType: INFRA_SETTINGS_AUDIT_TARGET_TYPE,
    },
  });

  return executePlatformSystem(async () => {
    const view = await ctx.serverDB.transaction(async (tx) => {
      const applied = await new EnterpriseLookupSettingsService(tx).update({
        config: input.config,
        expectedRevision: input.expectedRevision,
        updatedBy: ctx.userId!,
      });
      await new PlatformAuditService(tx).append({
        action: AUDIT_ACTION.SYSTEM_INFRA_ENTERPRISE_LOOKUP_UPDATE,
        actorUserId: ctx.userId!,
        afterDiff: summarizeEnterpriseLookupAfterDiff(
          applied.row.config,
          enterpriseLookupSecretChanged(applied.previous, applied.row.config),
        ),
        configRevision: applied.row.revision,
        reason: input.reason,
        result: 'success',
        targetId: TARGET_ID,
        targetType: INFRA_SETTINGS_AUDIT_TARGET_TYPE,
      });
      return applied.view;
    });
    invalidateEnterpriseLookupRuntimeConfig();
    return view;
  });
};

export const testEnterpriseLookupProviderHandler = async ({
  ctx,
  input,
}: {
  ctx: SystemHandlerCtx;
  input: AdminSystemTestEnterpriseLookupProviderInput;
}) => {
  await assertModuleEnabled('enterpriseLookup');
  return executePlatformSystem(() => testEnterpriseLookupProvider(ctx.serverDB, input));
};
