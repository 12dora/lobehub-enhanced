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
    const { serverDB, userId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for Reminder execution');
    }

    // R2 owns ReminderService. Loaded lazily so unit tests can inject a mock
    // via createReminderRuntime without requiring the service module.
    const { ReminderService } = await import('@/server/enterprise/services/reminder');
    return createReminderRuntime(new ReminderService(serverDB, userId) as IReminderService);
  },
  identifier: ReminderIdentifier,
};
