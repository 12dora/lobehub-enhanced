import type { IReminderService } from '@lobechat/builtin-tool-reminder/executionRuntime';
import {
  createReminderRuntime,
  ReminderExecutionRuntime,
} from '@lobechat/builtin-tool-reminder/executionRuntime';
import { ReminderIdentifier } from '@lobechat/builtin-tool-reminder/manifest';

import type { ReminderStatus } from '@/database/schemas/reminder';

import type { ServerRuntimeRegistration } from './types';

const toReminderStatus = (status: string | undefined): ReminderStatus | undefined => {
  switch (status) {
    case 'canceled':
    case 'expired':
    case 'failed':
    case 'scheduled':
    case 'sent': {
      return status;
    }
    default: {
      return undefined;
    }
  }
};

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
    const service = new ReminderService(serverDB, userId);
    return createReminderRuntime({
      cancel: (id) => service.cancel(id),
      create: async (input) => {
        const result = await service.create(input);
        if ('needsConfirmation' in result && result.needsConfirmation) {
          return result;
        }
        return result;
      },
      listCreated: (opts) =>
        service.listCreated(
          opts === undefined
            ? undefined
            : { limit: opts.limit, status: toReminderStatus(opts.status) },
        ),
      listReceived: (opts) => service.listReceived(opts),
      searchDirectory: (q, kind) => service.searchDirectory(q, kind),
    });
  },
  identifier: ReminderIdentifier,
};
