import type { IReminderService } from '@lobechat/builtin-tool-reminder/executionRuntime';
import {
  createReminderRuntime,
  ReminderExecutionRuntime,
} from '@lobechat/builtin-tool-reminder/executionRuntime';
import { ReminderIdentifier } from '@lobechat/builtin-tool-reminder/manifest';
import { and, desc, eq } from 'drizzle-orm';

import { messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  formatReminderScheduleParseError,
  reminderRecipientsSchema,
  reminderScheduleSchema,
} from '@/server/enterprise/services/reminder/scheduleSchema';

import { stripPromptQuoteEnvelopes } from './stripPromptQuoteEnvelopes';
import type { ServerRuntimeRegistration } from './types';

export { createReminderRuntime, ReminderExecutionRuntime };
export type { IReminderService };

/**
 * Latest user-authored message in this topic, scoped to the calling user.
 * Used only as createReminderTask `contextText` — never a tool argument.
 */
export const loadLatestUserMessageText = async (
  db: LobeChatDatabase,
  userId: string,
  topicId?: string | null,
): Promise<string | undefined> => {
  if (!topicId) return undefined;

  const [row] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(eq(messages.topicId, topicId), eq(messages.role, 'user'), eq(messages.userId, userId)),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const content = row?.content ? stripPromptQuoteEnvelopes(row.content) : undefined;
  return content || undefined;
};

export const reminderRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { agentId, serverDB, topicId, userId, workspaceId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for Reminder execution');
    }

    // G1a owns ReminderTaskService. Loaded lazily so unit tests can inject a mock
    // via createReminderRuntime without requiring the service module.
    const [{ ReminderService }, { ReminderTaskService }] = await Promise.all([
      import('@/server/enterprise/services/reminder'),
      import('@/server/enterprise/services/reminder/taskReminder'),
    ]);
    const directory = new ReminderService(serverDB, userId);
    const tasks = new ReminderTaskService(serverDB, userId, workspaceId);

    return createReminderRuntime({
      cancel: (taskId) => tasks.cancel(taskId),
      create: async (input) => {
        const recipients = reminderRecipientsSchema.parse(input.recipients);
        const parsed = reminderScheduleSchema.safeParse(input.schedule);
        if (!parsed.success) {
          throw new Error(formatReminderScheduleParseError(parsed.error));
        }
        const contextText = await loadLatestUserMessageText(serverDB, userId, topicId);
        return tasks.createReminderTask({
          content: input.content,
          createdByAgentId: input.createdByAgentId ?? agentId ?? null,
          recipients,
          schedule: parsed.data,
          topicId: input.topicId ?? topicId ?? null,
          ...(input.confirmLargeAudience === undefined
            ? {}
            : { confirmLargeAudience: input.confirmLargeAudience }),
          ...(contextText ? { contextText } : {}),
          ...(input.title === undefined ? {} : { title: input.title }),
        });
      },
      listCreated: (opts) => tasks.listCreated(opts),
      listReceived: (opts) => tasks.listReceived(opts),
      searchDirectory: (q, kind) => directory.searchDirectory(q, kind),
    });
  },
  identifier: ReminderIdentifier,
};
