import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  REMINDER_NOT_FOUND,
  ReminderService,
  ReminderServiceError,
} from '@/server/enterprise/services/reminder';

const reminderProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      reminderService: new ReminderService(ctx.serverDB, ctx.userId),
    },
  });
});

const recipientSchema = z.object({
  deptId: z.string().min(1).optional(),
  kind: z.enum(['department', 'user']),
  staffId: z.string().min(1).optional(),
});

const repeatSchema = z
  .object({
    freq: z.enum(['daily', 'monthly', 'weekly']),
    monthDays: z.array(z.number().int().min(1).max(31)).optional(),
    time: z.string().regex(/^\d{1,2}:\d{2}$/),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  })
  .optional();

const mapError = (error: unknown, procedure: string): never => {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ReminderServiceError) {
    throw new TRPCError({
      code: error.code === REMINDER_NOT_FOUND ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: error.code,
    });
  }
  console.error(`[reminder:${procedure}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: error instanceof Error ? error.message : 'Reminder request failed',
  });
};

export const reminderRouter = router({
  cancel: reminderProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.reminderService.cancel(input.id);
      } catch (error) {
        mapError(error, 'cancel');
      }
    }),

  create: reminderProcedure
    .input(
      z.object({
        confirmLargeAudience: z.boolean().optional(),
        content: z.string().min(1),
        createdByAgentId: z.string().optional(),
        fireAt: z.string().min(1),
        recipients: z.array(recipientSchema).min(1),
        repeat: repeatSchema,
        source: z.enum(['tool', 'ui']).optional(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.reminderService.create(input);
      } catch (error) {
        mapError(error, 'create');
      }
    }),

  hideReceived: reminderProcedure
    .input(z.object({ deliveryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.reminderService.hideReceived(input.deliveryId);
        return { success: true };
      } catch (error) {
        mapError(error, 'hideReceived');
      }
    }),

  listCreated: reminderProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          status: z.enum(['canceled', 'expired', 'failed', 'scheduled', 'sent']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.reminderService.listCreated(input);
      } catch (error) {
        mapError(error, 'listCreated');
      }
    }),

  listReceived: reminderProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.reminderService.listReceived(input);
      } catch (error) {
        mapError(error, 'listReceived');
      }
    }),

  searchDirectory: reminderProcedure
    .input(
      z.object({
        kind: z.enum(['department', 'user']).optional(),
        q: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.reminderService.searchDirectory(input.q, input.kind);
      } catch (error) {
        mapError(error, 'searchDirectory');
      }
    }),
});

export type ReminderRouter = typeof reminderRouter;
