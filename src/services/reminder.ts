import { lambdaClient } from '@/libs/trpc/client';

type ReminderRecipientRef = {
  deptId?: string;
  kind: 'department' | 'user';
  staffId?: string;
};

type ReminderRepeatRule = {
  freq: 'daily' | 'monthly' | 'weekly';
  monthDays?: number[];
  time: string;
  until?: string;
  weekdays?: number[];
};

type ReminderStatus = 'canceled' | 'expired' | 'failed' | 'scheduled' | 'sent';

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
    fireAt: string;
    recipients: ReminderRecipientRef[];
    repeat?: ReminderRepeatRule;
    source?: 'tool' | 'ui';
    topicId?: string;
  }) => {
    return lambdaClient.reminder.create.mutate(params);
  };

  listCreated = async (params?: { limit?: number; status?: ReminderStatus }) => {
    return lambdaClient.reminder.listCreated.query(params ?? {});
  };

  listReceived = async (params?: { limit?: number }) => {
    return lambdaClient.reminder.listReceived.query(params ?? {});
  };

  cancel = async (id: string) => {
    return lambdaClient.reminder.cancel.mutate({ id });
  };

  hideReceived = async (deliveryId: string) => {
    return lambdaClient.reminder.hideReceived.mutate({ deliveryId });
  };
}

export const reminderService = new ReminderService();
