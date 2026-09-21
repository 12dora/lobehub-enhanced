import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DingtalkApprovalRuleService } from '@/server/enterprise/services/dingtalkWorkspace/approvalRules';
import { DingtalkWorkspaceError } from '@/server/enterprise/services/dingtalkWorkspace/errors';

const conditionsSchema = z
  .object({
    fields: z
      .array(
        z
          .object({
            componentId: z.string().min(1),
            label: z.string(),
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

const expiresAtSchema = z.union([z.string().min(1), z.coerce.date(), z.null()]).optional();

const createInputSchema = z
  .object({
    action: z.enum(['agree', 'comment', 'redirect', 'refuse']),
    conditions: conditionsSchema,
    createdByTopicId: z.string().min(1).nullable().optional(),
    expiresAt: expiresAtSchema,
    name: z.string().trim().min(1).max(80),
    processCode: z.string().min(1),
    redirectToStaffToken: z.string().min(1).optional(),
    remark: z.string().max(1000).nullable().optional(),
  })
  .strict();

const updateInputSchema = z
  .object({
    action: z.enum(['agree', 'comment', 'redirect', 'refuse']).optional(),
    conditions: conditionsSchema.optional(),
    enabled: z.boolean().optional(),
    expiresAt: expiresAtSchema,
    id: z.string().min(1),
    name: z.string().trim().min(1).max(80).optional(),
    processCode: z.string().min(1).optional(),
    redirectToStaffToken: z.string().min(1).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
  })
  .strict();

const workspaceCode = (error: unknown): string | undefined => {
  if (error instanceof DingtalkWorkspaceError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('DINGTALK_')) return code;
  }
  return undefined;
};

const trpcCodeFor = (code: string): TRPCError['code'] => {
  switch (code) {
    case 'DINGTALK_NOT_FOUND': {
      return 'NOT_FOUND';
    }
    case 'DINGTALK_RATE_LIMITED': {
      return 'TOO_MANY_REQUESTS';
    }
    case 'DINGTALK_FORBIDDEN':
    case 'DINGTALK_FEATURE_DISABLED':
    case 'DINGTALK_AUTOMATION_OFF':
    case 'DINGTALK_IDENTITY_UNBOUND':
    case 'DINGTALK_IDENTITY_UNVERIFIED':
    case 'DINGTALK_IDENTITY_INACTIVE':
    case 'DINGTALK_NOT_TASK_OWNER':
    case 'DINGTALK_NOT_APPROVAL_ADMIN': {
      return 'FORBIDDEN';
    }
    case 'DINGTALK_UNAVAILABLE': {
      return 'INTERNAL_SERVER_ERROR';
    }
    case 'DINGTALK_INVALID': {
      return 'BAD_REQUEST';
    }
    default: {
      return 'BAD_REQUEST';
    }
  }
};

const mapError = (error: unknown, procedure: string): never => {
  if (error instanceof TRPCError) throw error;
  const code = workspaceCode(error);
  if (code) {
    throw new TRPCError({
      code: trpcCodeFor(code),
      message: code,
    });
  }
  console.error(`[dingtalkApprovalRule:${procedure}]`, {
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'DingTalk approval rule request failed',
  });
};

const ruleProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      approvalRuleService: new DingtalkApprovalRuleService(ctx.serverDB, ctx.userId),
    },
  });
});

export const dingtalkApprovalRuleRouter = router({
  create: ruleProcedure.input(createInputSchema).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.approvalRuleService.create(input);
    } catch (error) {
      mapError(error, 'create');
    }
  }),

  get: ruleProcedure
    .input(z.object({ id: z.string().min(1) }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.approvalRuleService.get(input.id);
      } catch (error) {
        mapError(error, 'get');
      }
    }),

  list: ruleProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).strict().optional())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.approvalRuleService.list(input);
      } catch (error) {
        mapError(error, 'list');
      }
    }),

  listRuns: ruleProcedure
    .input(
      z
        .object({
          id: z.string().min(1),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.approvalRuleService.listRuns(input.id, { limit: input.limit });
      } catch (error) {
        mapError(error, 'listRuns');
      }
    }),

  remove: ruleProcedure
    .input(z.object({ id: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.approvalRuleService.remove(input.id);
      } catch (error) {
        mapError(error, 'remove');
      }
    }),

  setEnabled: ruleProcedure
    .input(z.object({ enabled: z.boolean(), id: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.approvalRuleService.setEnabled(input.id, input.enabled);
      } catch (error) {
        mapError(error, 'setEnabled');
      }
    }),

  update: ruleProcedure.input(updateInputSchema).mutation(async ({ ctx, input }) => {
    try {
      const { id, ...patch } = input;
      return await ctx.approvalRuleService.update(id, patch);
    } catch (error) {
      mapError(error, 'update');
    }
  }),
});

export type DingtalkApprovalRuleRouter = typeof dingtalkApprovalRuleRouter;
