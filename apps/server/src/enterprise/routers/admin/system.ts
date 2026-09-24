import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';
import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { preAccessAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  adminSystemAuthSnapshotStatusOutputSchema,
  adminSystemCancelDocumentRenderJobInputSchema,
  adminSystemCancelDocumentRenderJobOutputSchema,
  adminSystemCancelJobInputSchema,
  adminSystemCancelJobOutputSchema,
  adminSystemClearJobsInputSchema,
  adminSystemClearJobsOutputSchema,
  adminSystemGetDocumentRenderSettingsOutputSchema,
  adminSystemGetDocumentRenderStatusOutputSchema,
  adminSystemGetEnterpriseLookupSettingsOutputSchema,
  adminSystemGetInfraSettingsOutputSchema,
  adminSystemGetInstanceRevisionsInputSchema,
  adminSystemGetInstanceRevisionsOutputSchema,
  adminSystemGetJobsInputSchema,
  adminSystemGetJobsOutputSchema,
  adminSystemGetSandboxPackageStatsInputSchema,
  adminSystemGetSandboxPackageStatsOutputSchema,
  adminSystemGetSandboxSettingsOutputSchema,
  adminSystemGetStatusOutputSchema,
  adminSystemListJobsInputSchema,
  adminSystemListJobsOutputSchema,
  adminSystemPrepareRestartInputSchema,
  adminSystemPrepareRestartOutputSchema,
  adminSystemRequestRestartInputSchema,
  adminSystemRequestRestartOutputSchema,
  adminSystemRetryDocumentRenderJobInputSchema,
  adminSystemRetryDocumentRenderJobOutputSchema,
  adminSystemRetryJobInputSchema,
  adminSystemRetryJobOutputSchema,
  adminSystemRunDocumentRenderGcInputSchema,
  adminSystemRunDocumentRenderGcOutputSchema,
  adminSystemTestDependencyInputSchema,
  adminSystemTestDependencyOutputSchema,
  adminSystemTestEnterpriseLookupProviderInputSchema,
  adminSystemTestEnterpriseLookupProviderOutputSchema,
  adminSystemUpdateDocumentRenderSettingsInputSchema,
  adminSystemUpdateDocumentRenderSettingsOutputSchema,
  adminSystemUpdateEnterpriseLookupSettingsInputSchema,
  adminSystemUpdateEnterpriseLookupSettingsOutputSchema,
  adminSystemUpdateInfraSettingsInputSchema,
  adminSystemUpdateInfraSettingsOutputSchema,
  adminSystemUpdateSandboxSettingsInputSchema,
  adminSystemUpdateSandboxSettingsOutputSchema,
} from '../../contracts/adminSystem';
import { withActiveUser } from '../../guards/activeUser';
import { withAdminMutationRateLimit } from '../../guards/adminMutationRateLimit';
import { throwEnterpriseError } from '../../guards/enterpriseErrors';
import { withPlatformPermission } from '../../guards/platformPermission';
import { AUDIT_ACTION } from '../../services/audit/auditActionCatalog';
import {
  cancelDocumentRenderJob,
  enqueueDocumentRenderGcJob,
  retryDocumentRenderJob,
} from '../../services/documentRender';
import { getDocumentRenderSettingsView } from '../../services/documentRenderSettings';
import { PlatformSystemAdminService } from '../../services/platformSystem/adminService';
import { testDocumentRenderDependency } from '../../services/platformSystem/documentRenderProbe';
import { getDocumentRenderStatus } from '../../services/platformSystem/documentRenderStatus';
import { InfraSettingsService } from '../../services/platformSystem/infraSettingsService';
import {
  getSandboxPackageStats,
  getSandboxSettingsView,
  toSandboxSettingsOutput,
} from '../../services/sandboxSettings';
import { isIdentityProviderFeatureEnabled } from './identityProvidersSupport';
import { adminSystemAlertsRouter } from './system.alerts';
import {
  getEnterpriseLookupSettings,
  testEnterpriseLookupProviderHandler,
  updateEnterpriseLookupSettings,
} from './system.enterpriseLookup';
import { createSystemService, execute, executePlatformSystem } from './system.errors';
import { updateInfraSettings } from './system.infra';
import { assertJobMutationReauth, assertRestartReauth } from './system.reauth';
import {
  updateDocumentRenderSettingsHandler,
  updateSandboxSettingsHandler,
} from './system.settings';
import { adminSystemStatusApiRouter } from './system.statusApi';

const systemProcedure = preAccessAuthedProcedure
  .use(({ next }) => {
    if (!isIdentityProviderFeatureEnabled()) {
      throwEnterpriseError({
        code: PLATFORM_ERROR_CODES.PLATFORM_FEATURE_DISABLED,
        httpCode: 'FORBIDDEN',
      });
    }
    return next();
  })
  .use(serverDatabase)
  .use(withActiveUser())
  .use(withAdminMutationRateLimit())
  .use(withPlatformPermission(PLATFORM_PERMISSIONS.OIDC_PUBLISH));

const platformSystemBase = preAccessAuthedProcedure
  .use(serverDatabase)
  .use(withActiveUser())
  .use(withAdminMutationRateLimit());

export const adminSystemRouter = router({
  alerts: adminSystemAlertsRouter,

  cancelDocumentRenderJob: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemCancelDocumentRenderJobInputSchema)
    .output(adminSystemCancelDocumentRenderJobOutputSchema)
    .mutation(({ ctx, input }) =>
      executePlatformSystem(() => cancelDocumentRenderJob(ctx.serverDB, input.jobId)),
    ),

  cancelJob: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemCancelJobInputSchema)
    .output(adminSystemCancelJobOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertJobMutationReauth(ctx, input, AUDIT_ACTION.SYSTEM_JOBS_CANCEL);
      return executePlatformSystem(() =>
        new PlatformSystemAdminService(ctx.serverDB).cancelJob(ctx.userId!, input),
      );
    }),

  getAuthSnapshotStatus: systemProcedure
    .output(adminSystemAuthSnapshotStatusOutputSchema)
    .query(({ ctx }) => execute(() => createSystemService(ctx.serverDB).getAuthSnapshotStatus())),

  getDocumentRenderSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemGetDocumentRenderSettingsOutputSchema)
    .query(() => executePlatformSystem(async () => getDocumentRenderSettingsView())),

  getDocumentRenderStatus: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemGetDocumentRenderStatusOutputSchema)
    .query(({ ctx }) => executePlatformSystem(() => getDocumentRenderStatus(ctx.serverDB))),

  getEnterpriseLookupSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemGetEnterpriseLookupSettingsOutputSchema)
    .query(getEnterpriseLookupSettings),

  getInfraSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemGetInfraSettingsOutputSchema)
    .query(() => executePlatformSystem(async () => new InfraSettingsService().getInfraSettings())),

  getInstanceRevisions: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .input(adminSystemGetInstanceRevisionsInputSchema)
    .output(adminSystemGetInstanceRevisionsOutputSchema)
    .query(({ ctx, input }) =>
      executePlatformSystem(() =>
        new PlatformSystemAdminService(ctx.serverDB).getInstanceRevisions(input),
      ),
    ),

  getJobs: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .input(adminSystemGetJobsInputSchema)
    .output(adminSystemGetJobsOutputSchema)
    .query(({ ctx, input }) =>
      executePlatformSystem(() => new PlatformSystemAdminService(ctx.serverDB).getJobs(input)),
    ),

  jobs: router({
    clear: platformSystemBase
      .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
      .input(adminSystemClearJobsInputSchema)
      .output(adminSystemClearJobsOutputSchema)
      .mutation(({ ctx }) =>
        executePlatformSystem(() =>
          new PlatformSystemAdminService(ctx.serverDB).clearJobs(ctx.userId!),
        ),
      ),

    list: platformSystemBase
      .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
      .input(adminSystemListJobsInputSchema)
      .output(adminSystemListJobsOutputSchema)
      .query(({ ctx, input }) =>
        executePlatformSystem(() => new PlatformSystemAdminService(ctx.serverDB).listJobs(input)),
      ),
  }),

  getSandboxPackageStats: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .input(adminSystemGetSandboxPackageStatsInputSchema)
    .output(adminSystemGetSandboxPackageStatsOutputSchema)
    .query(({ ctx, input }) =>
      executePlatformSystem(() => getSandboxPackageStats(ctx.serverDB, input)),
    ),

  getSandboxSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemGetSandboxSettingsOutputSchema)
    .query(() =>
      executePlatformSystem(async () => toSandboxSettingsOutput(await getSandboxSettingsView())),
    ),

  getStatus: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .output(adminSystemGetStatusOutputSchema)
    .query(({ ctx }) =>
      executePlatformSystem(() => new PlatformSystemAdminService(ctx.serverDB).getStatus()),
    ),

  prepareRestart: systemProcedure
    .input(adminSystemPrepareRestartInputSchema)
    .output(adminSystemPrepareRestartOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertRestartReauth(ctx, input, AUDIT_ACTION.SYSTEM_PREPARE_RESTART);
      return execute(() => createSystemService(ctx.serverDB).prepareRestart(ctx.userId!, input));
    }),

  requestRestart: systemProcedure
    .input(adminSystemRequestRestartInputSchema)
    .output(adminSystemRequestRestartOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertRestartReauth(ctx, input, AUDIT_ACTION.SYSTEM_REQUEST_RESTART);
      return execute(() => createSystemService(ctx.serverDB).requestRestart(ctx.userId!, input));
    }),

  retryDocumentRenderJob: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemRetryDocumentRenderJobInputSchema)
    .output(adminSystemRetryDocumentRenderJobOutputSchema)
    .mutation(({ ctx, input }) =>
      executePlatformSystem(() => retryDocumentRenderJob(ctx.serverDB, input.jobId)),
    ),

  runDocumentRenderGc: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemRunDocumentRenderGcInputSchema)
    .output(adminSystemRunDocumentRenderGcOutputSchema)
    .mutation(({ ctx }) =>
      executePlatformSystem(async () => {
        const result = await enqueueDocumentRenderGcJob(ctx.serverDB, {
          force: true,
          requestedBy: ctx.userId,
        });
        return { jobId: result.jobId, ok: true };
      }),
    ),

  statusApi: adminSystemStatusApiRouter,

  retryJob: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemRetryJobInputSchema)
    .output(adminSystemRetryJobOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertJobMutationReauth(ctx, input, AUDIT_ACTION.SYSTEM_JOBS_RETRY);
      return executePlatformSystem(() =>
        new PlatformSystemAdminService(ctx.serverDB).retryJob(ctx.userId!, input),
      );
    }),

  testDependency: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemTestDependencyInputSchema)
    .output(adminSystemTestDependencyOutputSchema)
    .mutation(({ input }) =>
      executePlatformSystem(async () => {
        if (input.dependency === 'documentRender') return testDocumentRenderDependency();
        return new InfraSettingsService().testDependency({
          ...input,
          dependency: input.dependency,
        });
      }),
    ),

  testEnterpriseLookupProvider: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemTestEnterpriseLookupProviderInputSchema)
    .output(adminSystemTestEnterpriseLookupProviderOutputSchema)
    .mutation(testEnterpriseLookupProviderHandler),

  updateDocumentRenderSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemUpdateDocumentRenderSettingsInputSchema)
    .output(adminSystemUpdateDocumentRenderSettingsOutputSchema)
    .mutation(updateDocumentRenderSettingsHandler),

  updateEnterpriseLookupSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemUpdateEnterpriseLookupSettingsInputSchema)
    .output(adminSystemUpdateEnterpriseLookupSettingsOutputSchema)
    .mutation(updateEnterpriseLookupSettings),

  updateInfraSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemUpdateInfraSettingsInputSchema)
    .output(adminSystemUpdateInfraSettingsOutputSchema)
    .mutation(updateInfraSettings),

  updateSandboxSettings: platformSystemBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminSystemUpdateSandboxSettingsInputSchema)
    .output(adminSystemUpdateSandboxSettingsOutputSchema)
    .mutation(updateSandboxSettingsHandler),
});
