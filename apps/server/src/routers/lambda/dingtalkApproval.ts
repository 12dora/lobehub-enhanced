import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DingtalkApprovalService } from '@/server/enterprise/services/dingtalkWorkspace/approval';
import { DingtalkApprovalRuleService } from '@/server/enterprise/services/dingtalkWorkspace/approvalRules';
import { DingtalkWorkspaceError } from '@/server/enterprise/services/dingtalkWorkspace/errors';
import { ReminderService } from '@/server/enterprise/services/reminder';

const staffToken = z.string().min(1);

const formValueSchema = z
  .object({
    componentId: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    value: z.string(),
  })
  .strict();

const saveTemplateLeafFieldSchema = z
  .object({
    bizAlias: z.string().optional(),
    componentId: z.string().optional(),
    componentType: z.string().min(1),
    format: z.string().optional(),
    label: z.string().min(1),
    options: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    unit: z.string().optional(),
  })
  .strict();

const saveTemplateFieldSchema = saveTemplateLeafFieldSchema
  .extend({
    children: z.array(saveTemplateLeafFieldSchema).optional(),
  })
  .strict();

const mapSaveTemplateLeaf = (field: z.infer<typeof saveTemplateLeafFieldSchema>) => ({
  bizAlias: field.bizAlias,
  componentId: field.componentId,
  componentType: field.componentType,
  format: field.format,
  label: field.label,
  options: field.options,
  placeholder: field.placeholder,
  required: field.required,
  unit: field.unit,
});

const conditionsSchema = z
  .object({
    fields: z
      .array(
        z
          .object({
            componentId: z.string().min(1),
            label: z.string().min(1),
            op: z.enum(['contains', 'eq', 'gt', 'gte', 'in', 'lt', 'lte', 'ne']),
            value: z.union([z.string(), z.number(), z.array(z.string())]),
          })
          .strict(),
      )
      .optional(),
    match: z.literal('all'),
    originators: z
      .object({
        deptIds: z.array(z.string().min(1)).optional(),
        staffIds: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ruleActionSchema = z.enum(['agree', 'comment', 'redirect', 'refuse']);

const TRPC_BY_DINGTALK_CODE: Record<string, TRPC_ERROR_CODE_KEY> = {
  DINGTALK_AMBIGUOUS: 'BAD_REQUEST',
  DINGTALK_AUTOMATION_OFF: 'FORBIDDEN',
  DINGTALK_FEATURE_DISABLED: 'FORBIDDEN',
  DINGTALK_FORBIDDEN: 'FORBIDDEN',
  DINGTALK_IDENTITY_INACTIVE: 'FORBIDDEN',
  DINGTALK_IDENTITY_UNBOUND: 'FORBIDDEN',
  DINGTALK_IDENTITY_UNVERIFIED: 'FORBIDDEN',
  DINGTALK_INVALID: 'BAD_REQUEST',
  DINGTALK_NOT_APPROVAL_ADMIN: 'FORBIDDEN',
  DINGTALK_NOT_CONFIGURED: 'PRECONDITION_FAILED',
  DINGTALK_NOT_FOUND: 'NOT_FOUND',
  DINGTALK_NOT_ORIGINATOR: 'FORBIDDEN',
  DINGTALK_NOT_TASK_OWNER: 'FORBIDDEN',
  DINGTALK_PREMIUM_REQUIRED: 'FORBIDDEN',
  DINGTALK_RATE_LIMITED: 'TOO_MANY_REQUESTS',
  DINGTALK_RULE_LIMIT: 'BAD_REQUEST',
  DINGTALK_UNAVAILABLE: 'INTERNAL_SERVER_ERROR',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

const isDingtalkWorkspaceError = (
  error: unknown,
): error is DingtalkWorkspaceError & {
  candidates?: unknown;
  hint?: unknown;
  problems?: unknown;
  query?: unknown;
} => {
  if (error instanceof DingtalkWorkspaceError) return true;
  return isRecord(error) && typeof error.code === 'string' && error.code.startsWith('DINGTALK_');
};

const mapDingtalkError: (error: unknown, procedure: string) => never = (error, procedure) => {
  if (error instanceof TRPCError) throw error;

  if (isDingtalkWorkspaceError(error)) {
    const code = error.code;
    const data: Record<string, unknown> = { code };
    if ('candidates' in error && error.candidates !== undefined) {
      data.candidates = error.candidates;
    }
    if ('hint' in error && typeof error.hint === 'string' && error.hint.trim()) {
      data.hint = error.hint.trim().slice(0, 200);
    }
    if ('problems' in error && Array.isArray(error.problems) && error.problems.length > 0) {
      data.problems = error.problems;
    }
    if ('query' in error && error.query !== undefined) {
      data.query = error.query;
    }
    throw new TRPCError({
      cause: { data },
      code: TRPC_BY_DINGTALK_CODE[code] ?? 'BAD_REQUEST',
      message: code,
    });
  }

  console.error(`[dingtalkApproval:${procedure}]`, error);
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'DINGTALK_UNAVAILABLE',
  });
};

const run = async <T>(procedure: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    return mapDingtalkError(error, procedure);
  }
};

const approvalProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      approvalService: new DingtalkApprovalService(ctx.serverDB, ctx.userId),
      reminderService: new ReminderService(ctx.serverDB, ctx.userId),
      ruleService: new DingtalkApprovalRuleService(ctx.serverDB, ctx.userId),
    },
  });
});

export const dingtalkApprovalRouter = router({
  addApprover: approvalProcedure
    .input(
      z
        .object({
          activateType: z.enum(['ALL', 'ONE_BY_ONE']),
          agreeAll: z.boolean().optional(),
          appenderStaffTokens: z.array(staffToken).min(1),
          processInstanceId: z.string().min(1),
          remark: z.string().optional(),
          taskId: z.string().min(1),
          type: z.enum(['after', 'before']),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => run('addApprover', () => ctx.approvalService.appendTask(input))),

  approveTask: approvalProcedure
    .input(
      z
        .object({
          processInstanceId: z.string().min(1),
          remark: z.string().optional(),
          taskId: z.string().min(1),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run('approveTask', () => ctx.approvalService.executeTask({ ...input, result: 'agree' })),
    ),

  commentApproval: approvalProcedure
    .input(
      z
        .object({
          processInstanceId: z.string().min(1),
          text: z.string().min(1),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run('commentApproval', () => ctx.approvalService.addComment(input)),
    ),

  createApprovalRule: approvalProcedure
    .input(
      z
        .object({
          action: ruleActionSchema,
          conditions: conditionsSchema,
          expiresAt: z.string().optional(),
          name: z.string().min(1),
          processCode: z.string().min(1),
          processName: z.string().min(1),
          redirectToStaffToken: staffToken.optional(),
          remark: z.string().optional(),
          topicId: z.string().nullish(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => {
      const { processName: _processName, topicId, ...rest } = input;
      return run('createApprovalRule', () =>
        ctx.ruleService.create({ ...rest, createdByTopicId: topicId ?? undefined }),
      );
    }),

  deleteApprovalRule: approvalProcedure
    .input(z.object({ id: z.string().min(1) }).strict())
    .mutation(({ ctx, input }) =>
      run('deleteApprovalRule', () => ctx.ruleService.remove(input.id)),
    ),

  deleteTemplate: approvalProcedure
    .input(z.object({ processCode: z.string().min(1) }).strict())
    .mutation(({ ctx, input }) =>
      run('deleteTemplate', () => ctx.approvalService.deleteTemplate(input)),
    ),

  getApprovalDetail: approvalProcedure
    .input(z.object({ processInstanceId: z.string().min(1) }).strict())
    .query(({ ctx, input }) =>
      run('getApprovalDetail', () => ctx.approvalService.getInstance(input.processInstanceId)),
    ),

  getTemplateSchema: approvalProcedure
    .input(z.object({ processCode: z.string().min(1) }).strict())
    .query(({ ctx, input }) =>
      run('getTemplateSchema', () => ctx.approvalService.getTemplateSchema(input.processCode)),
    ),

  listApprovalRules: approvalProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).strict().optional())
    .query(({ ctx, input }) =>
      run('listApprovalRules', () =>
        ctx.ruleService.list({ includeDisabled: input?.includeDisabled ?? false }),
      ),
    ),

  listMyApplications: approvalProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
          status: z.enum(['COMPLETED', 'RUNNING', 'TERMINATED']).optional(),
        })
        .strict()
        .optional(),
    )
    .query(({ ctx, input }) =>
      run('listMyApplications', () => ctx.approvalService.listInitiated(input ?? {})),
    ),

  listPendingApprovals: approvalProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
          refresh: z.boolean().optional(),
        })
        .strict()
        .optional(),
    )
    .query(({ ctx, input }) =>
      run('listPendingApprovals', () => ctx.approvalService.listPending(input ?? {})),
    ),

  listTemplates: approvalProcedure
    .input(z.object({ q: z.string().optional() }).strict().optional())
    .query(({ ctx, input }) =>
      run('listTemplates', () => ctx.approvalService.listTemplates(input ?? {})),
    ),

  preview: approvalProcedure
    .input(
      z
        .object({
          apiName: z.string().min(1),
          args: z.record(z.string(), z.unknown()),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => run('preview', () => ctx.approvalService.preview(input))),

  refuseTask: approvalProcedure
    .input(
      z
        .object({
          processInstanceId: z.string().min(1),
          remark: z.string().min(1),
          taskId: z.string().min(1),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run('refuseTask', () => ctx.approvalService.executeTask({ ...input, result: 'refuse' })),
    ),

  returnTask: approvalProcedure
    .input(
      z
        .object({
          processInstanceId: z.string().min(1),
          remark: z.string().min(1),
          revertAction: z.enum(['REVERT_FOR_APPROVAL', 'REVERT_FOR_RESUBMIT']),
          targetActivityId: z.string().min(1),
          taskId: z.string().min(1),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => run('returnTask', () => ctx.approvalService.revertTask(input))),

  saveTemplate: approvalProcedure
    .input(
      z
        .object({
          description: z.string().optional(),
          fields: z.array(saveTemplateFieldSchema).min(1),
          name: z.string().min(1),
          processCode: z.string().min(1).optional(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => {
      const fields = input.fields.map((field) => ({
        ...mapSaveTemplateLeaf(field),
        ...(field.children && field.children.length > 0
          ? { children: field.children.map(mapSaveTemplateLeaf) }
          : {}),
      }));
      return run('saveTemplate', () =>
        ctx.approvalService.saveTemplate({
          description: input.description,
          fields,
          name: input.name,
          processCode: input.processCode,
        }),
      );
    }),

  searchDirectory: approvalProcedure
    .input(
      z
        .object({
          kind: z.enum(['department', 'user']).optional(),
          q: z.string().min(1),
        })
        .strict(),
    )
    .query(({ ctx, input }) =>
      // Same staff:<id> tokens as the reminder tool. Not on DingtalkApprovalService (4.1).
      run('searchDirectory', () => ctx.reminderService.searchDirectory(input.q, input.kind)),
    ),

  submitApproval: approvalProcedure
    .input(
      z
        .object({
          approverStaffTokens: z.array(staffToken).max(20).optional(),
          ccStaffTokens: z.array(staffToken).max(50).optional(),
          deptId: z.number().int().optional(),
          formValues: z.array(formValueSchema).min(1),
          processCode: z.string().min(1),
          targetSelectActioners: z
            .array(
              z
                .object({
                  actionerKey: z.string().min(1),
                  actionerStaffTokens: z.array(staffToken).min(1),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run('submitApproval', () =>
        ctx.approvalService.createInstance({
          approverStaffTokens: input.approverStaffTokens,
          ccStaffTokens: input.ccStaffTokens,
          deptId: input.deptId,
          formValues: input.formValues,
          processCode: input.processCode,
          targetSelectActioners: input.targetSelectActioners?.map((item) => ({
            actionerKey: item.actionerKey,
            staffTokens: item.actionerStaffTokens,
          })),
        }),
      ),
    ),

  transferTask: approvalProcedure
    .input(
      z
        .object({
          processInstanceId: z.string().min(1),
          remark: z.string().optional(),
          taskId: z.string().min(1),
          toStaffToken: staffToken,
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run('transferTask', () => ctx.approvalService.redirectTask(input)),
    ),

  updateApprovalRule: approvalProcedure
    .input(
      z
        .object({
          action: ruleActionSchema.optional(),
          conditions: conditionsSchema.optional(),
          enabled: z.boolean().optional(),
          expiresAt: z.union([z.string(), z.null()]).optional(),
          id: z.string().min(1),
          name: z.string().min(1).optional(),
          processCode: z.string().min(1).optional(),
          processName: z.string().min(1).optional(),
          redirectToStaffToken: staffToken.optional(),
          remark: z.string().optional(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => {
      const { id, processName: _processName, ...patch } = input;
      return run('updateApprovalRule', () => ctx.ruleService.update(id, patch));
    }),

  withdrawApplication: approvalProcedure
    .input(
      z
        .object({
          processInstanceId: z.string().min(1),
          remark: z.string().optional(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run('withdrawApplication', () => ctx.approvalService.terminateInstance(input)),
    ),
});

export type DingtalkApprovalRouter = typeof dingtalkApprovalRouter;
