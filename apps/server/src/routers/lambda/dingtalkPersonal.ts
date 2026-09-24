import { isRecord } from '@lobechat/utils/object';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  DingtalkPersonalError,
  isDingtalkPersonalErrorCode,
} from '@/server/enterprise/services/dingtalkPersonal/errors';
import { DingtalkPersonalService } from '@/server/enterprise/services/dingtalkPersonal/service';

import { dingtalkPersonalToolProcedures } from './dingtalkPersonalTool';

const personalProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      personalService: new DingtalkPersonalService(ctx.serverDB, ctx.userId),
    },
  });
});

const jobIdSchema = z.object({ jobId: z.string().min(1).max(64) }).strict();

const TRPC_BY_CODE: Record<string, TRPC_ERROR_CODE_KEY> = {
  DINGTALK_IDENTITY_INACTIVE: 'PRECONDITION_FAILED',
  DINGTALK_IDENTITY_UNBOUND: 'PRECONDITION_FAILED',
  DINGTALK_IDENTITY_UNVERIFIED: 'PRECONDITION_FAILED',
  DINGTALK_PERSONAL_BROKER_UNAVAILABLE: 'INTERNAL_SERVER_ERROR',
  DINGTALK_PERSONAL_CORP_ID_MISSING: 'PRECONDITION_FAILED',
  DINGTALK_PERSONAL_DISABLED: 'FORBIDDEN',
  DINGTALK_PERSONAL_EXPIRED: 'BAD_REQUEST',
  DINGTALK_PERSONAL_FEATURE_DISABLED: 'FORBIDDEN',
  DINGTALK_PERSONAL_FILE_TOO_LARGE: 'BAD_REQUEST',
  DINGTALK_PERSONAL_INTERNAL: 'INTERNAL_SERVER_ERROR',
  DINGTALK_PERSONAL_INVALID_ARGS: 'BAD_REQUEST',
  DINGTALK_PERSONAL_LOGIN_NOT_FOUND: 'NOT_FOUND',
  DINGTALK_PERSONAL_ORG_POLICY_DENIED: 'BAD_REQUEST',
  DINGTALK_PERSONAL_OUTPUT_TOO_LARGE: 'BAD_REQUEST',
  DINGTALK_PERSONAL_PAT_REQUIRED: 'BAD_REQUEST',
  DINGTALK_PERSONAL_RATE_LIMITED: 'TOO_MANY_REQUESTS',
  DINGTALK_PERSONAL_REVOKE_FAILED: 'INTERNAL_SERVER_ERROR',
  DINGTALK_PERSONAL_TIMEOUT: 'INTERNAL_SERVER_ERROR',
  DINGTALK_PERSONAL_UNAUTHORIZED: 'BAD_REQUEST',
  DINGTALK_PERSONAL_UPSTREAM: 'BAD_REQUEST',
};

const isPersonalError = (error: unknown): error is DingtalkPersonalError => {
  if (error instanceof DingtalkPersonalError) return true;
  return isRecord(error) && isDingtalkPersonalErrorCode(error.code);
};

export function mapDingtalkPersonalError(error: unknown, procedure: string): never {
  if (error instanceof TRPCError) throw error;
  if (isPersonalError(error)) {
    const data: Record<string, unknown> = { code: error.code };
    if (isRecord(error.details)) data.details = error.details;
    throw new TRPCError({
      cause: { data },
      code: TRPC_BY_CODE[error.code] ?? 'BAD_REQUEST',
      message: error.code,
    });
  }
  console.error(`[dingtalkPersonal:${procedure}]`, {
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'DINGTALK_PERSONAL_INTERNAL',
  });
}

export const dingtalkPersonalRouter = router({
  cancelLogin: personalProcedure.input(jobIdSchema).mutation(async ({ ctx, input }) => {
    try {
      await ctx.personalService.cancelLogin(input.jobId);
      return { ok: true as const };
    } catch (error) {
      mapDingtalkPersonalError(error, 'cancelLogin');
    }
  }),

  checkStatus: personalProcedure.mutation(async ({ ctx }) => {
    try {
      return await ctx.personalService.checkStatus();
    } catch (error) {
      mapDingtalkPersonalError(error, 'checkStatus');
    }
  }),

  getLoginJob: personalProcedure.input(jobIdSchema).query(async ({ ctx, input }) => {
    try {
      return await ctx.personalService.getLoginJob(input.jobId);
    } catch (error) {
      mapDingtalkPersonalError(error, 'getLoginJob');
    }
  }),

  getStatus: personalProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.personalService.getStatus();
    } catch (error) {
      mapDingtalkPersonalError(error, 'getStatus');
    }
  }),

  revoke: personalProcedure.mutation(async ({ ctx }) => {
    try {
      await ctx.personalService.revoke();
      return { ok: true as const };
    } catch (error) {
      mapDingtalkPersonalError(error, 'revoke');
    }
  }),

  startLogin: personalProcedure.mutation(async ({ ctx }) => {
    try {
      return await ctx.personalService.startLogin();
    } catch (error) {
      mapDingtalkPersonalError(error, 'startLogin');
    }
  }),

  ...dingtalkPersonalToolProcedures,
});
