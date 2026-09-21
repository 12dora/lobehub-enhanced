import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  ENTERPRISE_LOOKUP_INTERNAL,
  ENTERPRISE_LOOKUP_NOT_CONFIGURED,
  EnterpriseLookupService,
  EnterpriseLookupServiceError,
  formatEnterpriseLookupClientError,
  isEnterpriseLookupErrorCode,
  QCC_CATEGORIES,
} from '@/server/enterprise/services/enterpriseLookup';

const enterpriseLookupProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      enterpriseLookupService: new EnterpriseLookupService(ctx.serverDB, ctx.userId),
    },
  });
});

const providerSchema = z.enum(['qcc', 'tianyancha']);
const categorySchema = z.union([z.enum(QCC_CATEGORIES), z.literal('default')]);

const mapError = (error: unknown, procedure: string): never => {
  if (error instanceof TRPCError) throw error;
  if (error instanceof EnterpriseLookupServiceError) {
    throw new TRPCError({
      cause: {
        data: {
          code: error.code,
          ...(error.fallbackProvider ? { fallbackProvider: error.fallbackProvider } : {}),
        },
      },
      code: error.code === ENTERPRISE_LOOKUP_NOT_CONFIGURED ? 'PRECONDITION_FAILED' : 'BAD_REQUEST',
      message: formatEnterpriseLookupClientError(error),
    });
  }
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (isEnterpriseLookupErrorCode(code)) {
      const fallback = (error as { fallbackProvider?: unknown }).fallbackProvider;
      throw new TRPCError({
        cause: {
          data: {
            code,
            ...(fallback === 'qcc' || fallback === 'tianyancha'
              ? { fallbackProvider: fallback }
              : {}),
          },
        },
        code: code === ENTERPRISE_LOOKUP_NOT_CONFIGURED ? 'PRECONDITION_FAILED' : 'BAD_REQUEST',
        message: code,
      });
    }
  }
  console.error(
    `[enterpriseLookup:${procedure}]`,
    error instanceof Error ? error.name : 'UnknownError',
  );
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: ENTERPRISE_LOOKUP_INTERNAL,
  });
};

export const enterpriseLookupRouter = router({
  listCapabilities: enterpriseLookupProcedure
    .input(
      z
        .object({
          category: categorySchema.optional(),
          provider: providerSchema.optional(),
        })
        .strict()
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.enterpriseLookupService.listCapabilities(input ?? {});
      } catch (error) {
        return mapError(error, 'listCapabilities');
      }
    }),

  query: enterpriseLookupProcedure
    .input(
      z
        .object({
          arguments: z.record(z.string(), z.unknown()).optional().default({}),
          capability: z.string().min(1),
          category: categorySchema.optional(),
          provider: providerSchema.optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.enterpriseLookupService.query(input);
      } catch (error) {
        return mapError(error, 'query');
      }
    }),

  status: enterpriseLookupProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.enterpriseLookupService.status();
    } catch (error) {
      return mapError(error, 'status');
    }
  }),
});

export type EnterpriseLookupRouter = typeof enterpriseLookupRouter;
