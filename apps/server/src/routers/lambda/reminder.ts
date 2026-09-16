import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  REMINDER_NOT_FOUND,
  ReminderService,
  ReminderServiceError,
} from '@/server/enterprise/services/reminder';
import { ReminderTaskService } from '@/server/enterprise/services/reminder/taskReminder';

const reminderProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      reminderService: new ReminderService(ctx.serverDB, ctx.userId),
      reminderTaskService: new ReminderTaskService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

const timeSchema = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'HH:mm');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const scheduleSchema = z
  .object({
    date: dateSchema.optional(),
    kind: z.enum(['daily', 'monthly', 'once', 'weekly']),
    monthDays: z.array(z.number().int().min(1).max(31)).optional(),
    time: timeSchema,
    until: dateSchema.optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  })
  .strict();

const reminderErrorCode = (error: unknown): string | undefined => {
  if (error instanceof ReminderServiceError) return error.code;
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('REMINDER_')) return code;
  }
  return undefined;
};

const mapError = (error: unknown, procedure: string): never => {
  if (error instanceof TRPCError) throw error;
  const code = reminderErrorCode(error);
  if (code) {
    throw new TRPCError({
      code: code === REMINDER_NOT_FOUND ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: code,
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
    .input(z.object({ taskId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.reminderTaskService.cancel(input.taskId);
        return { success: true };
      } catch (error) {
        mapError(error, 'cancel');
      }
    }),

  create: reminderProcedure
    .input(
      z
        .object({
          confirmLargeAudience: z.boolean().optional(),
          content: z.string().min(1),
          createdByAgentId: z.string().optional(),
          recipients: z.array(z.string().min(1)).min(1),
          schedule: scheduleSchema,
          topicId: z.string().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.reminderTaskService.createReminderTask(input);
      } catch (error) {
        mapError(error, 'create');
      }
    }),

  fireNow: reminderProcedure
    .input(z.object({ taskId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.reminderTaskService.fireNow(input.taskId);
      } catch (error) {
        mapError(error, 'fireNow');
      }
    }),

  hideReceived: reminderProcedure
    .input(z.object({ deliveryId: z.string().min(1) }).strict())
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
          includeFinished: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict()
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.reminderTaskService.listCreated(input);
      } catch (error) {
        mapError(error, 'listCreated');
      }
    }),

  listReceived: reminderProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(200).optional() })
        .strict()
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.reminderTaskService.listReceived(input);
      } catch (error) {
        mapError(error, 'listReceived');
      }
    }),

  saveTask: reminderProcedure
    .input(
      z
        .object({
          editorData: z.unknown().optional(),
          instruction: z.string().min(1),
          taskId: z.string().min(1),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.reminderTaskService.saveReminderTask(input);
      } catch (error) {
        mapError(error, 'saveTask');
      }
    }),

  searchDirectory: reminderProcedure
    .input(
      z
        .object({
          kind: z.enum(['department', 'user']).optional(),
          q: z.string().min(1),
        })
        .strict(),
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
