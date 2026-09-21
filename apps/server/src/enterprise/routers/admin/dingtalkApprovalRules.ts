import { TRPCError } from '@trpc/server';

import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';
import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import type { DingtalkApprovalRuleAdminListItem } from '@/database/models/dingtalkApprovalRule';
import { DingtalkApprovalRuleModel } from '@/database/models/dingtalkApprovalRule';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  type AdminDingtalkApprovalRuleItem,
  adminDingtalkApprovalRulesDisableInputSchema,
  adminDingtalkApprovalRulesDisableOutputSchema,
  adminDingtalkApprovalRulesListInputSchema,
  adminDingtalkApprovalRulesListOutputSchema,
} from '../../contracts/adminDingtalkApprovalRules';
import { withActiveUser } from '../../guards/activeUser';
import { withAdminMutationRateLimit } from '../../guards/adminMutationRateLimit';
import { throwEnterpriseError } from '../../guards/enterpriseErrors';
import { withPlatformPermission } from '../../guards/platformPermission';
import { AUDIT_ACTION } from '../../services/audit/auditActionCatalog';
import {
  pickOriginatorLabels,
  resolveOriginatorLabels,
} from '../../services/dingtalkWorkspace/approvalRules/labels';
import { PlatformAuditService } from '../../services/platformAudit';

const rulesBase = authedProcedure
  .use(serverDatabase)
  .use(withActiveUser())
  .use(withAdminMutationRateLimit());

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
};

const toDateOnly = (value: Date | string | null | undefined): string | null => {
  const iso = toIso(value);
  return iso ? iso.slice(0, 10) : null;
};

export const toAdminDingtalkApprovalRuleItem = (
  row: DingtalkApprovalRuleAdminListItem,
  originatorLabels: Record<string, string> = {},
): AdminDingtalkApprovalRuleItem => ({
  action: row.action,
  conditions: row.conditions,
  createdAt: toIso(row.createdAt) ?? '',
  dailyCount: row.dailyCount,
  dailyCountDate: toDateOnly(row.dailyCountDate),
  disabledReason: row.disabledReason ?? null,
  enabled: row.enabled,
  expiresAt: toIso(row.expiresAt),
  id: row.id,
  lastRunAt: toIso(row.lastRunAt),
  name: row.name,
  originatorLabels,
  processCode: row.processCode,
  processName: row.processName,
  redirectToName: row.redirectToName ?? null,
  staffId: row.staffId,
  updatedAt: toIso(row.updatedAt) ?? '',
  userDisplayName: row.userDisplayName ?? null,
  userEmail: row.userEmail ?? null,
  userId: row.userId,
});

const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error('[admin.dingtalkApprovalRules]', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'DingTalk approval rules are temporarily unavailable',
    });
  }
};

export const adminDingtalkApprovalRulesRouter = router({
  disable: rulesBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_OPERATE))
    .input(adminDingtalkApprovalRulesDisableInputSchema)
    .output(adminDingtalkApprovalRulesDisableOutputSchema)
    .mutation(({ ctx, input }) =>
      execute(async () => {
        const row = await DingtalkApprovalRuleModel.adminDisable(ctx.serverDB, input.ruleId);
        if (!row) {
          return throwEnterpriseError({
            code: PLATFORM_ERROR_CODES.PLATFORM_NOT_FOUND,
            httpCode: 'NOT_FOUND',
          });
        }
        const reasonCode = input.reason ?? null;
        await new PlatformAuditService(ctx.serverDB).append({
          action: AUDIT_ACTION.SYSTEM_DINGTALK_APPROVAL_RULE_DISABLE,
          actorUserId: ctx.userId!,
          afterDiff: { enabled: false, name: row.name, reasonCode },
          reason: reasonCode,
          result: 'success',
          targetId: row.userId,
          targetType: 'user',
        });
        const labels = await resolveOriginatorLabels(ctx.serverDB, [row.conditions]);
        return toAdminDingtalkApprovalRuleItem(
          {
            ...row,
            userDisplayName: null,
            userEmail: null,
          },
          pickOriginatorLabels(row.conditions, labels),
        );
      }),
    ),

  list: rulesBase
    .use(withPlatformPermission(PLATFORM_PERMISSIONS.SYSTEM_READ))
    .input(adminDingtalkApprovalRulesListInputSchema.optional())
    .output(adminDingtalkApprovalRulesListOutputSchema)
    .query(({ ctx, input }) =>
      execute(async () => {
        const result = await DingtalkApprovalRuleModel.adminList(ctx.serverDB, {
          page: input?.page,
          pageSize: input?.pageSize,
          q: input?.q,
        });
        const labels = await resolveOriginatorLabels(
          ctx.serverDB,
          result.items.map((item) => item.conditions),
        );
        return {
          items: result.items.map((item) =>
            toAdminDingtalkApprovalRuleItem(item, pickOriginatorLabels(item.conditions, labels)),
          ),
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
        };
      }),
    ),
});
