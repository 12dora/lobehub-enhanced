'use client';

import { useClientDataSWR } from '@/libs/swr';
import { reminderService } from '@/services/reminder';

import { createdRemindersKey, REMINDER_LIST_LIMIT } from './swrKeys';
import type { CreatedReminderRow } from './types';

/**
 * The server row of one reminder task (`reminder.listCreated`), which is the
 * only place that carries the facts the task record itself does not have:
 * the next planned fire time, the last delivery counts and the RESOLVED
 * recipients (departments with their member count).
 *
 * It shares the 我发起的 cache key (with `includeFinished`, so a completed or
 * canceled reminder still resolves) — opening a reminder task therefore warms
 * the table and vice versa.
 *
 * `taskId` may be either the task id (`task_*`) or the short identifier
 * (`T-7`): the detail store keys tasks by whatever the route carries.
 */
export const useReminderTaskRow = (taskId?: string | null) => {
  const { data, error, isLoading, mutate } = useClientDataSWR<CreatedReminderRow[]>(
    taskId ? createdRemindersKey(true) : null,
    () =>
      reminderService.listCreated({
        includeFinished: true,
        limit: REMINDER_LIST_LIMIT,
      }) as unknown as Promise<CreatedReminderRow[]>,
  );

  return {
    error,
    isLoading,
    mutate,
    row: taskId
      ? data?.find((item) => item.taskId === taskId || item.taskIdentifier === taskId)
      : undefined,
  };
};
