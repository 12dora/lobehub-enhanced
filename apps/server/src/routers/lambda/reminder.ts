import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { withModule } from '@/server/enterprise/guards/moduleGuard';
import {
  REMINDER_NOT_FOUND,
  REMINDER_SCHEDULE_INVALID,
  ReminderService,
  ReminderServiceError,
} from '@/server/enterprise/services/reminder';
import {
  reminderRecipientsSchema,
  reminderScheduleSchema,
} from '@/server/enterprise/services/reminder/scheduleSchema';
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

/** create / fireNow / saveTask schedule or send a DingTalk delivery. */
const reminderDeliveryProcedure = authedProcedure
  .use(serverDatabase)
  .use(withModule('dingtalkNotify'))
  .use(async (opts) => {
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

const EDITOR_DATA_MAX_BYTES = 256 * 1024;

const reminderEditorDataSchema = z
  .unknown()
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'editorData must be an object',
      });
      return;
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'editorData is not serialisable',
      });
      return;
    }
    if (new TextEncoder().encode(serialized).byteLength > EDITOR_DATA_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'editorData exceeds 256 KB',
      });
    }
  });

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
      message: code === REMINDER_SCHEDULE_INVALID ? REMINDER_SCHEDULE_INVALID : code,
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

  create: reminderDeliveryProcedure
    .input(
      z
        .object({
          confirmLargeAudience: z.boolean().optional(),
          content: z.string().min(1),
          createdByAgentId: z.string().optional(),
          recipients: reminderRecipientsSchema,
          schedule: reminderScheduleSchema,
          title: z.string().trim().max(12).optional(),
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

  fireNow: reminderDeliveryProcedure
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

  saveTask: reminderDeliveryProcedure
    .input(
      z
        .object({
          editorData: reminderEditorDataSchema,
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
