import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  DingtalkCalendarService,
  isCalendarWriteApiName,
} from '@/server/enterprise/services/dingtalkWorkspace/calendar';
import { DingtalkWorkspaceError } from '@/server/enterprise/services/dingtalkWorkspace/errors';
import {
  DingtalkTodoService,
  isTodoWriteApiName,
} from '@/server/enterprise/services/dingtalkWorkspace/todo';
import { ReminderService } from '@/server/enterprise/services/reminder';

const workspaceProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      calendarService: new DingtalkCalendarService(ctx.serverDB, ctx.userId),
      reminderService: new ReminderService(ctx.serverDB, ctx.userId),
      todoService: new DingtalkTodoService(ctx.serverDB, ctx.userId),
    },
  });
});

const prioritySchema = z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(40)]);
const tokenListSchema = z.array(z.string().min(1)).max(500);
const isoSchema = z.string().min(1);
const argsSchema = z.record(z.unknown()).optional();

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
  DINGTALK_ROOM_UNAVAILABLE: 'BAD_REQUEST',
  DINGTALK_RULE_LIMIT: 'BAD_REQUEST',
  DINGTALK_UNAVAILABLE: 'INTERNAL_SERVER_ERROR',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

const isDingtalkWorkspaceError = (
  error: unknown,
): error is DingtalkWorkspaceError & {
  candidates?: unknown;
  roomIssues?: unknown;
  timeApplied?: boolean;
} => {
  if (error instanceof DingtalkWorkspaceError) return true;
  return isRecord(error) && typeof error.code === 'string' && error.code.startsWith('DINGTALK_');
};

const mapError: (error: unknown, procedure: string) => never = (error, procedure) => {
  if (error instanceof TRPCError) throw error;
  if (isDingtalkWorkspaceError(error)) {
    const data: Record<string, unknown> = { code: error.code };
    if (error.candidates !== undefined) data.candidates = error.candidates;
    if (error.roomIssues !== undefined) data.roomIssues = error.roomIssues;
    if (error.timeApplied === true) data.timeApplied = true;
    throw new TRPCError({
      cause: { data },
      code: TRPC_BY_DINGTALK_CODE[error.code] ?? 'BAD_REQUEST',
      message: error.code,
    });
  }
  console.error(`[dingtalkWorkspace:${procedure}]`, {
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'DINGTALK_UNAVAILABLE',
  });
};

const todoRouter = router({
  completeTodo: workspaceProcedure
    .input(z.object({ taskId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.todoService.completeTodo(input);
      } catch (error) {
        mapError(error, 'todo.completeTodo');
      }
    }),

  createTodo: workspaceProcedure
    .input(
      z
        .object({
          description: z.string().max(4096).optional(),
          dueTime: isoSchema.optional(),
          executorTokens: tokenListSchema.max(100).optional(),
          priority: prioritySchema.optional(),
          subject: z.string().trim().min(1).max(1024),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.todoService.createTodo(input);
      } catch (error) {
        mapError(error, 'todo.createTodo');
      }
    }),

  deleteTodo: workspaceProcedure
    .input(z.object({ taskId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.todoService.deleteTodo(input);
      } catch (error) {
        mapError(error, 'todo.deleteTodo');
      }
    }),

  listTodos: workspaceProcedure
    .input(z.object({ done: z.boolean().optional() }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.todoService.listTodos(input);
      } catch (error) {
        mapError(error, 'todo.listTodos');
      }
    }),

  updateTodo: workspaceProcedure
    .input(
      z
        .object({
          description: z.string().max(4096).optional(),
          done: z.boolean().optional(),
          dueTime: isoSchema.nullable().optional(),
          executorTokens: z.array(z.string().min(1)).max(1000).optional(),
          priority: prioritySchema.optional(),
          subject: z.string().trim().min(1).max(1024).optional(),
          taskId: z.string().min(1),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.todoService.updateTodo(input);
      } catch (error) {
        mapError(error, 'todo.updateTodo');
      }
    }),
});

const reminderSchema = z.union([
  z.number().int().min(0),
  z
    .object({
      method: z.string().min(1).optional(),
      minutes: z.number().int().min(0),
    })
    .strict(),
]);

const calendarRouter = router({
  createEvent: workspaceProcedure
    .input(
      z
        .object({
          attendeeTokens: tokenListSchema.optional(),
          description: z.string().max(5000).optional(),
          end: isoSchema,
          isAllDay: z.boolean().optional(),
          location: z.string().max(2048).optional(),
          onlineMeeting: z.boolean().optional(),
          reminders: z.array(reminderSchema).optional(),
          roomIds: z.array(z.string().min(1)).max(5).optional(),
          start: isoSchema,
          summary: z.string().trim().min(1).max(2048),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.calendarService.createEvent(input);
      } catch (error) {
        mapError(error, 'calendar.createEvent');
      }
    }),

  deleteEvent: workspaceProcedure
    .input(z.object({ eventId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.calendarService.deleteEvent(input);
      } catch (error) {
        mapError(error, 'calendar.deleteEvent');
      }
    }),

  getEvent: workspaceProcedure
    .input(z.object({ eventId: z.string().min(1) }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.calendarService.getEvent(input);
      } catch (error) {
        mapError(error, 'calendar.getEvent');
      }
    }),

  listEvents: workspaceProcedure
    .input(z.object({ from: isoSchema, to: isoSchema }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.calendarService.listEvents(input);
      } catch (error) {
        mapError(error, 'calendar.listEvents');
      }
    }),

  listMeetingRooms: workspaceProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.calendarService.listMeetingRooms();
    } catch (error) {
      mapError(error, 'calendar.listMeetingRooms');
    }
  }),

  queryFreeBusy: workspaceProcedure
    .input(
      z
        .object({
          from: isoSchema,
          staffTokens: z.array(z.string().min(1)).min(1).max(20),
          to: isoSchema,
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.calendarService.queryFreeBusy(input);
      } catch (error) {
        mapError(error, 'calendar.queryFreeBusy');
      }
    }),

  respondEvent: workspaceProcedure
    .input(
      z
        .object({
          eventId: z.string().min(1),
          responseStatus: z.enum(['needsAction', 'accepted', 'declined', 'tentative']),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.calendarService.respondEvent(input);
      } catch (error) {
        mapError(error, 'calendar.respondEvent');
      }
    }),

  updateEvent: workspaceProcedure
    .input(
      z
        .object({
          attendeeTokens: tokenListSchema.optional(),
          description: z.string().max(5000).optional(),
          end: isoSchema.optional(),
          eventId: z.string().min(1),
          isAllDay: z.boolean().optional(),
          location: z.string().max(2048).optional(),
          onlineMeeting: z.boolean().optional(),
          reminders: z.array(reminderSchema).optional(),
          roomIds: z.array(z.string().min(1)).max(5).optional(),
          start: isoSchema.optional(),
          summary: z.string().trim().min(1).max(2048).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.calendarService.updateEvent(input);
      } catch (error) {
        mapError(error, 'calendar.updateEvent');
      }
    }),
});

export const dingtalkWorkspaceRouter = router({
  calendar: calendarRouter,
  preview: workspaceProcedure
    .input(z.object({ apiName: z.string().min(1), args: argsSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        if (isTodoWriteApiName(input.apiName)) {
          return await ctx.todoService.preview(input);
        }
        if (isCalendarWriteApiName(input.apiName)) {
          return await ctx.calendarService.preview(input);
        }
        throw new DingtalkWorkspaceError('DINGTALK_INVALID');
      } catch (error) {
        mapError(error, 'preview');
      }
    }),
  // Same staff:<id> tokens as the reminder tool.
  searchDirectory: workspaceProcedure
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
  todo: todoRouter,
});

export type DingtalkWorkspaceRouter = typeof dingtalkWorkspaceRouter;
