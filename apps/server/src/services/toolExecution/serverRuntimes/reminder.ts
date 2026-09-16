import type { IReminderService } from '@lobechat/builtin-tool-reminder/executionRuntime';
import {
  createReminderRuntime,
  ReminderExecutionRuntime,
} from '@lobechat/builtin-tool-reminder/executionRuntime';
import { ReminderIdentifier } from '@lobechat/builtin-tool-reminder/manifest';

import type { ServerRuntimeRegistration } from './types';

export { createReminderRuntime, ReminderExecutionRuntime };
export type { IReminderService };

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
      create: (input) =>
        tasks.createReminderTask({
          ...input,
          createdByAgentId: input.createdByAgentId ?? agentId ?? null,
          topicId: input.topicId ?? topicId ?? null,
        }),
      listCreated: (opts) => tasks.listCreated(opts),
      listReceived: (opts) => tasks.listReceived(opts),
      searchDirectory: (q, kind) => directory.searchDirectory(q, kind),
    });
  },
  identifier: ReminderIdentifier,
};
