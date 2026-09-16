import type { ReminderScheduleInput } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Client access to the 定时提醒 (scheduled reminder) lambda router.
 * Mirrors `src/services/messenger.ts`: thin wrappers over `lambdaClient`.
 */
class ReminderService {
  searchDirectory = async (params: { kind?: 'department' | 'user'; q: string }) => {
    return lambdaClient.reminder.searchDirectory.query(params);
  };

  create = async (params: {
    confirmLargeAudience?: boolean;
    content: string;
    createdByAgentId?: string;
    recipients: string[];
    schedule: ReminderScheduleInput;
    title?: string;
    topicId?: string;
  }) => {
    return lambdaClient.reminder.create.mutate(params);
  };

  saveTask = async (params: { editorData?: unknown; instruction: string; taskId: string }) => {
    return lambdaClient.reminder.saveTask.mutate(params);
  };

  listCreated = async (params?: { includeFinished?: boolean; limit?: number }) => {
    return lambdaClient.reminder.listCreated.query(params ?? {});
  };

  listReceived = async (params?: { limit?: number }) => {
    return lambdaClient.reminder.listReceived.query(params ?? {});
  };

  cancel = async (taskId: string) => {
    return lambdaClient.reminder.cancel.mutate({ taskId });
  };

  fireNow = async (taskId: string) => {
    return lambdaClient.reminder.fireNow.mutate({ taskId });
  };

  hideReceived = async (deliveryId: string) => {
    return lambdaClient.reminder.hideReceived.mutate({ deliveryId });
  };
}

export const reminderService = new ReminderService();
