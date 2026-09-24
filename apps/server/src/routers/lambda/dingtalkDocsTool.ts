import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  DINGTALK_DOCS_API_NAMES,
  previewDingtalkDocsWrite,
  runDingtalkDocsTool,
} from '@/server/enterprise/services/dingtalkDocs/tool';
import { DingtalkPersonalError } from '@/server/enterprise/services/dingtalkPersonal/errors';

const apiNameSchema = z.enum(DINGTALK_DOCS_API_NAMES);

const toolInput = z
  .object({
    apiName: apiNameSchema,
    args: z.record(z.unknown()).optional(),
  })
  .strict();

const toolProcedure = authedProcedure.use(serverDatabase);

/**
 * Domain failures stay inside the tool result for `callTool`. `preview` is a
 * confirm-card read and surfaces the same codes as dingtalkPersonal.
 */
const TRPC_BY_CODE: Record<string, TRPC_ERROR_CODE_KEY> = {
  DINGTALK_IDENTITY_INACTIVE: 'PRECONDITION_FAILED',
  DINGTALK_IDENTITY_UNBOUND: 'PRECONDITION_FAILED',
  DINGTALK_IDENTITY_UNVERIFIED: 'PRECONDITION_FAILED',
  DINGTALK_PERSONAL_BROKER_UNAVAILABLE: 'INTERNAL_SERVER_ERROR',
  DINGTALK_PERSONAL_CORP_ID_MISSING: 'PRECONDITION_FAILED',
  DINGTALK_PERSONAL_DISABLED: 'FORBIDDEN',
  DINGTALK_PERSONAL_FEATURE_DISABLED: 'FORBIDDEN',
  DINGTALK_PERSONAL_LOGIN_NOT_FOUND: 'NOT_FOUND',
  DINGTALK_PERSONAL_RATE_LIMITED: 'TOO_MANY_REQUESTS',
  DINGTALK_PERSONAL_TIMEOUT: 'INTERNAL_SERVER_ERROR',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readPersonalError = (
  error: unknown,
): { code: string; details?: Record<string, unknown> } | undefined => {
  if (!isRecord(error)) return undefined;
  const named = error instanceof DingtalkPersonalError || error.name === 'DingtalkPersonalError';
  if (!named || typeof error.code !== 'string') return undefined;
  return {
    code: error.code,
    ...(isRecord(error.details) ? { details: error.details } : {}),
  };
};

function mapDingtalkDocsTrpcError(error: unknown, procedure: string): never {
  if (error instanceof TRPCError) throw error;
  const personal = readPersonalError(error);
  if (personal) {
    throw new TRPCError({
      cause: {
        data: { code: personal.code, ...(personal.details ? { details: personal.details } : {}) },
      },
      code: TRPC_BY_CODE[personal.code] ?? 'BAD_REQUEST',
      message: personal.code,
    });
  }
  console.error(`[dingtalkDocs:${procedure}]`, {
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'DINGTALK_PERSONAL_INTERNAL',
  });
}

export const dingtalkDocsRouter = router({
  callTool: toolProcedure.input(toolInput).mutation(async ({ ctx, input }) => {
    return runDingtalkDocsTool(ctx.serverDB, ctx.userId, input.apiName, input.args ?? {}, {
      botPlatform: undefined,
      workspaceId: ctx.workspaceId || undefined,
    });
  }),

  preview: toolProcedure.input(toolInput).query(async ({ ctx, input }) => {
    try {
      return await previewDingtalkDocsWrite(
        ctx.serverDB,
        ctx.userId,
        input.apiName,
        input.args ?? {},
      );
    } catch (error) {
      mapDingtalkDocsTrpcError(error, 'preview');
    }
  }),
});
